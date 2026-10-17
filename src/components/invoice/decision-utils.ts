/**
 * Lecturas derivadas de un DecisionRecord para la pantalla de detalle. Funciones puras: no deciden
 * nada, solo ordenan lo que el motor y la guardia ya dejaron registrado.
 */
import { CHECK_BY_CODE, CHECK_CATALOG } from "@/core/checks";
import type { Agreement, CheckCode, CheckResult, Decision, DecisionRecord, Outcome, Vendor } from "@/core/schemas";

/** Prefijo del ancla de cada comprobación no cumplida: #comprobacion-1, #comprobacion-2… */
export const CHECK_ANCHOR_PREFIX = "comprobacion";

/** Efecto de una comprobación: null si cumple; si no, lo que produce. */
export function effectOf(check: CheckResult): Exclude<Outcome, "PAGAR"> | null {
  if (check.status === "pass") return null;
  if (check.status === "not_evaluable") return "ESCALAR";
  return check.outcomeIfFail;
}

type NoteSource = Pick<Decision, "summary" | "checks" | "outcome">;

const CATALOG_INDEX = new Map<CheckCode, number>(CHECK_CATALOG.map((c, i) => [c.code, i]));

/**
 * Dónde nombra la frase del porqué a cada comprobación que no se cumple:
 *   - FRENAR: la frase es la explicación de la primera que frena → nota al final;
 *   - ESCALAR: las que cita por su «Título» → nota tras el título; si dice que "no se pudieron
 *     evaluar", las que no tienen datos → nota al final;
 *   - si no nombra ninguna, todas al final.
 * Las demás no llevan superíndice en la frase (siguen en las notas, con su número).
 */
function namedInSummary({ summary, checks, outcome }: NoteSource): { code: CheckCode; at: number }[] {
  const failing = (checks ?? []).filter((c) => c.status !== "pass");
  const endAt = /[.]\s*$/.test(summary) ? summary.replace(/\s+$/, "").length - 1 : summary.length;
  const out: { code: CheckCode; at: number }[] = [];
  if (outcome === "FRENAR") {
    const first = failing.find((c) => effectOf(c) === "FRENAR");
    if (first) out.push({ code: first.code, at: endAt });
  } else {
    for (const c of failing) {
      const title = CHECK_BY_CODE[c.code]?.title;
      const quoted = title ? `«${title}»` : null;
      const idx = quoted ? summary.indexOf(quoted) : -1;
      if (quoted && idx >= 0) out.push({ code: c.code, at: idx + quoted.length });
    }
    if (/no se pudieron evaluar/i.test(summary)) {
      for (const c of failing) {
        if (c.status === "not_evaluable" && !out.some((o) => o.code === c.code)) out.push({ code: c.code, at: endAt });
      }
    }
  }
  if (out.length === 0) for (const c of failing) out.push({ code: c.code, at: endAt });
  return out.sort((a, b) => a.at - b.at || (CATALOG_INDEX.get(a.code) ?? 0) - (CATALOG_INDEX.get(b.code) ?? 0));
}

/**
 * Número de nota de cada comprobación que no se cumple: primero las que nombra la frase (en el
 * orden en que aparecen), luego las demás que no se cumplen y al final las que no tenían datos.
 * Así la causa principal es siempre la nota 1.
 */
export function noteNumbering(source: NoteSource): Map<CheckCode, number> {
  const out = new Map<CheckCode, number>();
  for (const { code } of namedInSummary(source)) if (!out.has(code)) out.set(code, out.size + 1);
  const rest = (source.checks ?? []).filter((c) => c.status !== "pass" && !out.has(c.code));
  for (const c of rest.filter((c) => c.status === "fail")) out.set(c.code, out.size + 1);
  for (const c of rest.filter((c) => c.status === "not_evaluable")) out.set(c.code, out.size + 1);
  return out;
}

export type SummaryPart = { kind: "text"; text: string } | { kind: "notes"; numbers: number[] };

/** Pone los superíndices en la frase del porqué, donde la frase nombra cada comprobación. */
export function summaryWithNotes(source: NoteSource): SummaryPart[] {
  const { summary } = source;
  const numbering = noteNumbering(source);
  const inserts = new Map<number, number[]>();
  for (const { code, at } of namedInSummary(source)) {
    const n = numbering.get(code);
    if (n != null) inserts.set(at, [...(inserts.get(at) ?? []), n]);
  }
  const points = [...inserts.keys()].sort((a, b) => a - b);
  const parts: SummaryPart[] = [];
  let cursor = 0;
  for (const at of points) {
    if (at > cursor) parts.push({ kind: "text", text: summary.slice(cursor, at) });
    parts.push({ kind: "notes", numbers: (inserts.get(at) ?? []).sort((a, b) => a - b) });
    cursor = at;
  }
  if (cursor < summary.length) parts.push({ kind: "text", text: summary.slice(cursor) });
  return parts;
}

/** Proveedor emparejado, tal como estaba en la ficha al decidir. */
export function matchedVendor(record: DecisionRecord): Vendor | null {
  const id = record.decision.vendorId;
  if (!id) return null;
  return record.companySnapshot?.vendors?.find((v) => v.id === id) ?? null;
}

export function matchedAgreement(record: DecisionRecord, vendor: Vendor | null): Agreement | null {
  const id = record.decision.agreementId;
  if (!id || !vendor) return null;
  return vendor.agreements.find((a) => a.id === id) ?? null;
}

/** Resultado que propuso el motor (antes de la guardia). */
export function engineOutcome(record: DecisionRecord): Outcome {
  return record.decision.guardOverride ? "PAGAR" : record.decision.outcome;
}

/** Nombre que se muestra: el de la ficha si hay proveedor; si no, el leído. */
export function displayVendorName(record: DecisionRecord): string | null {
  return matchedVendor(record)?.name ?? record.reading?.data?.vendorName ?? null;
}

/** Instrucciones sospechosas únicas (modelo y heurística pueden repetir el mismo texto). */
export function uniqueSuspicious(record: DecisionRecord): { text: string; reason: string; sources: string[] }[] {
  const list = record.reading?.signals?.suspiciousInstructions ?? [];
  const byText = new Map<string, { text: string; reason: string; sources: string[] }>();
  for (const s of list) {
    const key = s.text.replace(/\s+/g, " ").trim().toLowerCase();
    const prev = byText.get(key);
    if (prev) {
      if (!prev.sources.includes(s.source)) prev.sources.push(s.source);
    } else {
      byText.set(key, { text: s.text, reason: s.reason, sources: [s.source] });
    }
  }
  return [...byText.values()];
}
