/**
 * Traza de la decisión: los pasos deterministas que llevaron al resultado, armados solo con lo que
 * quedó registrado (sin texto de un modelo). Función pura: sirve para la pantalla y para copiar.
 */
import { CHECK_CATALOG } from "@/core/checks";
import type { DecisionRecord, Outcome, ReaderResult } from "@/core/schemas";
import { effectOf, engineOutcome, uniqueSuspicious } from "./decision-utils";
import { FIELD_NAME, formatInteger, formatStampUtc, READER_ERROR_LABEL, shortHash } from "./format";

export type TraceTone = "ok" | "warn" | "bad" | "muted";

export interface TraceLine {
  text: string;
  tone?: TraceTone;
}

export interface TraceStep {
  n: string;
  label: string;
  /** Línea principal del paso. */
  head: TraceLine[];
  /** Detalle, una línea por elemento. */
  details: TraceLine[];
}

const OUTCOME_TONE: Record<Outcome, TraceTone> = { PAGAR: "ok", FRENAR: "bad", ESCALAR: "warn" };

const MODE: Record<DecisionRecord["readingMode"], string> = { live: "real", cache: "guardada", simulated: "simulada" };

function readerStep(n: string, label: string, result: ReaderResult | null): TraceStep {
  if (!result) {
    return { n, label, head: [{ text: "no disponible", tone: "warn" }], details: [] };
  }
  const base = `${result.readerId} · ${result.model} · prompt ${result.promptVersion}`;
  if (!result.ok) {
    return {
      n,
      label,
      head: [{ text: base }, { text: ` · error: ${READER_ERROR_LABEL[result.error] ?? result.error}`, tone: "bad" }],
      details: [],
    };
  }
  const head: TraceLine[] = [{ text: base }, { text: " · ok", tone: "ok" }];
  if (result.usage) {
    head.push({ text: ` · ${formatInteger(result.usage.inputTokens)} → ${formatInteger(result.usage.outputTokens)} tokens`, tone: "muted" });
  }
  const e = result.extraction;
  const filled = [e.vendorName, e.invoiceNumber, e.currency, e.total, e.payment?.accountNumber].filter((f) => f?.value != null).length;
  const lines = e.lineItems?.length ?? 0;
  return {
    n,
    label,
    head,
    details: [{ text: `${filled} de 5 datos críticos con valor · ${lines === 1 ? "1 línea" : `${lines} líneas`}`, tone: "muted" }],
  };
}

export function buildTrace(record: DecisionRecord): TraceStep[] {
  const { reading, decision } = record;
  const s = reading.signals;
  const steps: TraceStep[] = [];

  steps.push({
    n: "01",
    label: "Archivo recibido",
    head: [{ text: record.filename }],
    details: [{ text: `huella sha256 ${shortHash(record.fileHash)}… · factura ${record.invoiceId}`, tone: "muted" }],
  });

  steps.push(readerStep("02", "Lectura A", reading.primary));
  steps.push(readerStep("03", "Lectura B", reading.secondary));

  const disagree = s.readersDisagreeOn.filter((f) => f !== "segunda_lectura_no_disponible");
  const suspicious = uniqueSuspicious(record);
  // Registros anteriores a estas señales no las traen: se cuentan como vacías.
  const paidMarkers = Array.isArray(s.paidDocumentMarkers) ? s.paidDocumentMarkers : [];
  const ingestWarnings = Array.isArray(s.ingestWarnings) ? s.ingestWarnings : [];
  const counts: [string, number][] = [
    ["faltantes", s.missingCriticalFields.length],
    ["ilegibles", s.illegibleCriticalFields.length],
    ["desacuerdos", disagree.length],
    ["aritmética", s.arithmeticIssues.length],
    ["instrucciones", suspicious.length],
    ["citas no halladas", s.evidenceNotFound.length],
    ["ya pagado", paidMarkers.length],
    ["avisos de entrada", ingestWarnings.length],
  ];
  const verifyDetails: TraceLine[] = [];
  if (s.missingCriticalFields.length > 0)
    verifyDetails.push({ text: `faltan: ${s.missingCriticalFields.map((f) => FIELD_NAME[f] ?? f).join(", ")}`, tone: "warn" });
  if (s.illegibleCriticalFields.length > 0)
    verifyDetails.push({ text: `ilegibles: ${s.illegibleCriticalFields.map((f) => FIELD_NAME[f] ?? f).join(", ")}`, tone: "warn" });
  if (s.readersDisagreeOn.includes("segunda_lectura_no_disponible"))
    verifyDetails.push({ text: "segunda lectura no disponible", tone: "warn" });
  if (disagree.length > 0) verifyDetails.push({ text: `no coinciden en: ${disagree.map((f) => FIELD_NAME[f] ?? f).join(", ")}`, tone: "warn" });
  for (const issue of s.arithmeticIssues) verifyDetails.push({ text: issue, tone: "warn" });
  for (const ins of suspicious) {
    const by = ins.sources.map((src) => (src === "model" ? "lector" : "regla de texto")).join(" y ");
    verifyDetails.push({ text: `instrucción «${ins.text}» · detectada por ${by} · no se siguió`, tone: "bad" });
  }
  for (const quote of s.evidenceNotFound) verifyDetails.push({ text: `cita no hallada en el texto: «${quote}»`, tone: "warn" });
  for (const m of paidMarkers) {
    const by = m.source === "model" ? "lector" : "regla de texto";
    verifyDetails.push({ text: `documento ya pagado: «${m.text}» · detectado por ${by} · no se paga`, tone: "bad" });
  }
  for (const w of ingestWarnings) verifyDetails.push({ text: `aviso de entrada: ${w}`, tone: "bad" });
  steps.push({
    n: "04",
    label: "Verificación",
    head: counts.map(([k, v], i) => ({ text: `${i > 0 ? " · " : ""}${k} ${v}`, tone: v > 0 ? ("warn" as const) : undefined })),
    details: verifyDetails,
  });

  const engine = engineOutcome(record);
  const checks = decision.checks ?? [];
  const passCount = checks.filter((c) => c.status === "pass").length;
  const engineDetails: TraceLine[] = checks
    .filter((c) => c.status !== "pass")
    .map((c) => {
      const effect = effectOf(c) ?? "ESCALAR";
      const state = c.status === "fail" ? "no cumple" : "sin datos";
      return { text: `${c.code} ${state} → ${effect}`, tone: OUTCOME_TONE[effect] };
    });
  engineDetails.push({ text: "regla: alguna FRENAR → FRENAR; si no, alguna ESCALAR → ESCALAR; si no → PAGAR", tone: "muted" });
  steps.push({
    n: "05",
    label: "Motor",
    head: [
      { text: `${passCount} de ${CHECK_CATALOG.length} cumplen · resultado ` },
      { text: engine, tone: OUTCOME_TONE[engine] },
    ],
    details: engineDetails,
  });

  let guardStep: TraceStep;
  if (!decision.guard) {
    guardStep = { n: "06", label: "Guardia", head: [{ text: "no aplica: el motor no propuso pagar", tone: "muted" }], details: [] };
  } else if (decision.guard.approved && !decision.guardOverride) {
    guardStep = {
      n: "06",
      label: "Guardia",
      head: [{ text: "aprobó", tone: "ok" }, { text: " · 0 violaciones · recalculó las reglas duras por su cuenta" }],
      details: [],
    };
  } else {
    const violations = decision.guard.violations ?? [];
    guardStep = {
      n: "06",
      label: "Guardia",
      head: [
        { text: "no aprobó", tone: "bad" },
        { text: ` · ${violations.length === 1 ? "1 violación" : `${violations.length} violaciones`} · PAGAR → ` },
        { text: "ESCALAR", tone: "warn" },
      ],
      details: violations.map((v) => ({ text: v, tone: "bad" as const })),
    };
  }
  steps.push(guardStep);

  steps.push({
    n: "07",
    label: "Registro",
    head: [{ text: `${record.id} · ${formatStampUtc(record.decidedAt)}` }],
    details: [
      {
        text: `app ${record.versions?.app ?? "—"} · prompt ${record.versions?.promptVersion ?? "—"} · modelos ${(record.versions?.models ?? []).join(", ") || "—"} · lectura ${MODE[record.readingMode] ?? record.readingMode}`,
        tone: "muted",
      },
    ],
  });

  return steps;
}

/** La traza como texto plano (para copiar). */
export function traceToText(record: DecisionRecord, steps: readonly TraceStep[]): string {
  const lines = steps.flatMap((step) => [
    `${step.n} ${step.label}: ${step.head.map((l) => l.text).join("")}`,
    ...step.details.map((d) => `   ${d.text}`),
  ]);
  lines.push(`= ${record.decision.outcome}`);
  return lines.join("\n");
}
