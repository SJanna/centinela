/**
 * Motor de reglas: evalúa las 15 comprobaciones (todas, sin cortocircuito, en el orden del
 * catálogo) y decide PAGAR / FRENAR / ESCALAR. Función pura y determinista.
 */
import { CHECK_BY_CODE, CHECK_CATALOG } from "../core/checks";
import type { CheckResult, Decision, DecisionContext, EngineInput, Outcome } from "../core/schemas";
import { EVALUATORS } from "./checks";
import { buildFacts, type Facts } from "./facts";
import { formatUsdCents, lowerFirst, money, stripFinalPeriod, unique } from "./text";

/** Lo que produce una comprobación: pass → nada; fail → su outcomeIfFail; not_evaluable → ESCALAR. */
export function effectOf(check: Pick<CheckResult, "status" | "outcomeIfFail">): Outcome {
  if (check.status === "pass") return "PAGAR";
  if (check.status === "not_evaluable") return "ESCALAR";
  return check.outcomeIfFail;
}

/** Alguna FRENAR → FRENAR; si no, alguna ESCALAR → ESCALAR; si no → PAGAR. */
export function aggregateOutcome(checks: readonly Pick<CheckResult, "status" | "outcomeIfFail">[]): Outcome {
  const effects = checks.map(effectOf);
  if (effects.includes("FRENAR")) return "FRENAR";
  if (effects.includes("ESCALAR")) return "ESCALAR";
  return "PAGAR";
}

/** Cuántas comprobaciones sin datos se nombran una por una en el resumen antes de agruparlas. */
const MAX_LISTED_NOT_EVALUABLE = 3;

function quoteTitle(check: CheckResult): string {
  return `«${CHECK_BY_CODE[check.code].title}»`;
}

function joinTitles(checks: readonly CheckResult[]): string {
  const titles = checks.map(quoteTitle);
  if (titles.length <= 1) return titles.join("");
  return `${titles.slice(0, -1).join(", ")} y ${titles[titles.length - 1]}`;
}

interface Evaluated {
  check: CheckResult;
  action: string | null;
  derived: boolean;
}

/** Quita el punto doble que deja un nombre terminado en punto ("S.A.S."). */
function tidy(text: string): string {
  return text.replace(/\.{2,}$/, ".");
}

function buildSummary(outcome: Outcome, evaluated: readonly Evaluated[], facts: Facts): string {
  const checks = evaluated.map((x) => x.check);
  if (outcome === "PAGAR") {
    const usd = facts.usd;
    const vendorName = facts.vendor?.name ?? "el proveedor";
    if (!usd.ok) return `Se paga a ${vendorName}. Cumple las ${CHECK_CATALOG.length} comprobaciones.`;
    const usdPart = usd.currency === "USD" ? "" : ` (≈ ${formatUsdCents(usd.amountUsdCents)})`;
    return `Se paga a ${vendorName}: ${money(usd.total, usd.currency)}${usdPart}. Cumple las ${CHECK_CATALOG.length} comprobaciones.`;
  }
  if (outcome === "FRENAR") {
    const first = checks.find((c) => effectOf(c) === "FRENAR");
    const why = first ? lowerFirst(stripFinalPeriod(first.explanation)) : "una comprobación frena el pago";
    return `Se frena: ${why}.`;
  }
  const failed = checks.filter((c) => c.status === "fail");
  // Las que quedaron sin evaluar solo por otra que ya no pasó no se nombran: el resumen va a la causa.
  const missing = evaluated.filter((x) => x.check.status === "not_evaluable" && !x.derived).map((x) => x.check);
  const parts: string[] = [];
  if (failed.length > 0) parts.push(`no cumple ${joinTitles(failed)}`);
  if (missing.length > 0) {
    if (missing.length <= MAX_LISTED_NOT_EVALUABLE) {
      parts.push(`sin datos para evaluar ${joinTitles(missing)}`);
    } else {
      const others = failed.length > 0 ? "otras " : "";
      parts.push(`${others}${missing.length} comprobaciones no se pudieron evaluar por falta de datos`);
    }
  }
  if (parts.length === 0) parts.push("hay comprobaciones sin evaluar");
  return `Se escala a una persona: ${parts.join("; ")}.`;
}

/**
 * Evalúa la factura contra las reglas de la empresa. Nunca mueve dinero ni hace E/S.
 * Devuelve guard: null y guardOverride: false (la guardia la aplica el pipeline).
 */
export function decide(input: EngineInput, ctx: DecisionContext): Decision {
  const facts = buildFacts(input, ctx);
  const evaluated: Evaluated[] = CHECK_CATALOG.map((def) => {
    const e = EVALUATORS[def.code](facts, input, ctx);
    const check: CheckResult = {
      code: def.code,
      status: e.status,
      outcomeIfFail: def.outcomeIfFail,
      explanation: tidy(e.explanation),
      params: e.params,
    };
    return { check, action: e.action, derived: e.derived };
  });
  const checks = evaluated.map((x) => x.check);
  const outcome = aggregateOutcome(checks);

  const humanAction =
    outcome === "ESCALAR"
      ? unique(
          evaluated
            .filter((x) => x.check.status !== "pass" && !x.derived && x.action != null)
            .map((x) => x.action as string),
        ).join(" ") || "Revisar la factura a mano antes de decidir."
      : null;

  return {
    invoiceId: input.invoiceId,
    outcome,
    checks,
    summary: buildSummary(outcome, evaluated, facts),
    humanAction,
    vendorId: facts.vendor?.id ?? null,
    agreementId: facts.agreement?.id ?? null,
    agreementPeriod: facts.period,
    amountUsd: facts.usd.ok ? facts.usd.amountUsdCents / 100 : null,
    guard: null,
    guardOverride: false,
  };
}
