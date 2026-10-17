/**
 * Banco de pruebas de Centinela.
 *
 * Por cada escenario de dataset/scenarios.json: historial vacío, reglas con `rulesOverride`, y los
 * casos del escenario en el orden de dataset/casos.csv, SIN base de datos:
 *   normalizeFile → readInvoice → decide → guardia (si PAGAR) → se agrega al historial.
 *
 * Lectores:
 * - simulated: lectura «perfecta» del manifiesto (sin costo; no mide la calidad de lectura).
 * - cache: lectores de Anthropic que solo leen dataset/reading-cache; si falta una lectura, el
 *   lector falla (no llama a la API) y el caso escala por LEC-1.
 * - live: lectores de Anthropic con esa misma caché (requiere ANTHROPIC_API_KEY; cuesta dinero).
 *
 * Un caso es correcto si la decisión es la esperada y cada código esperado quedó en `fail` o
 * `not_evaluable`.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { CaseRow, ManifestEntry, ReadingCache } from "../src/core/ports";
import type { CheckCode, Company, HistoryEntry, Outcome, Reader, ReaderResult } from "../src/core/schemas";
import { normalizeFile } from "../src/ingest";
import {
  createAnthropicReader,
  createCachedReader,
  createFileReadingCache,
  createSimulatedReader,
  readInvoice,
  PRIMARY_MODEL,
  PROMPT_VERSION,
  SECONDARY_MODEL,
} from "../src/extract";
import { decideWithGuard } from "../src/pipeline/guard-apply";
import {
  companyForScenario,
  loadDatasetCompany,
  loadManifest,
  manifestFilePath,
  readCaseRows,
  readScenarios,
  type Scenario,
} from "../src/pipeline/dataset";
import { PRIMARY_READER_ID, SECONDARY_READER_ID } from "../src/pipeline/reader-ids";

export type EvalReader = "simulated" | "cache" | "live";
export type EvalSplit = "train" | "holdout" | "all";

export interface EvalOptions {
  reader: EvalReader;
  split?: EvalSplit;
  /** Solo estos casos (ids de casos.csv). Los casos anteriores de su escenario se procesan igual, como historial. */
  cases?: string[];
  /** Carpeta de la caché de lecturas (por defecto dataset/reading-cache). */
  cacheDir?: string;
  /** Se llama al terminar cada caso evaluado (progreso en la consola). */
  onCase?: (result: CaseResult) => void;
}

export interface ReaderUsage {
  readerId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface CaseResult {
  caseId: string;
  split: CaseRow["split"];
  escenario: string;
  formato: CaseRow["formato"];
  descripcion: string;
  expected: Outcome;
  expectedCodes: CheckCode[];
  /** null si el caso no se pudo procesar (ver `error`). */
  outcome: Outcome | null;
  failCodes: CheckCode[];
  notEvaluableCodes: CheckCode[];
  /** Códigos esperados que no quedaron en fail ni not_evaluable. */
  missingCodes: CheckCode[];
  correct: boolean;
  /** Salió PAGAR y lo esperado no era PAGAR. */
  improperPayment: boolean;
  /** Se esperaba PAGAR o FRENAR y salió ESCALAR. */
  overEscalation: boolean;
  /** Salió FRENAR y lo esperado no era FRENAR. */
  overFreeze: boolean;
  guardOverride: boolean;
  summary: string;
  /** Lecturas que fallaron: «lector-a: unavailable · mensaje». */
  readerErrors: string[];
  usage: ReaderUsage[];
  error?: string;
}

export interface Metrics {
  total: number;
  correct: number;
  accuracy: number;
  improperPayments: number;
  overEscalations: number;
  overFreezes: number;
  /** Casos esperados PAGAR/FRENAR resueltos correctamente sin escalar / casos esperados PAGAR/FRENAR. */
  autonomy: { resolved: number; eligible: number; rate: number };
}

export interface ModelCost {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface EvalReport {
  generatedAt: string;
  reader: EvalReader;
  split: EvalSplit;
  caseFilter: string[] | null;
  promptVersion: string;
  models: string[];
  metrics: {
    total: Metrics;
    bySplit: Record<string, Metrics>;
    byScenario: Record<string, Metrics>;
  };
  cases: CaseResult[];
  /** Casos procesados solo para construir el historial de los casos pedidos (no cuentan). */
  contextCases: string[];
  /** Lecturas que no estaban en la caché (modo cache). */
  cacheMisses: number;
  /** Consumo y costo estimado (modo live; las lecturas que salieron de la caché no consumen). */
  usage: { byModel: Record<string, ModelCost>; total: ModelCost } | null;
}

/** USD por millón de tokens (entrada / salida). Estimación para el reporte. */
export const PRICES_PER_MILLION: Record<string, { input: number; output: number }> = {
  [PRIMARY_MODEL]: { input: 2, output: 10 },
  [SECONDARY_MODEL]: { input: 0.1, output: 0.5 },
};

export const DEFAULT_CACHE_DIR = path.join("dataset", "reading-cache");

export const CACHE_MISS_MESSAGE =
  "No hay lectura guardada en la caché para este archivo (modo cache: no se llama a la API). Créala con npm run eval:live.";

// ───────────────────────── Lectores ─────────────────────────

interface ReaderPair {
  primary: Reader;
  secondary: Reader;
}

/** Lector que nunca llama a la API: siempre falla. Envuelto con la caché, solo responde lo guardado. */
function cacheOnlyInner(id: string, model: string): Reader {
  return {
    id,
    model,
    promptVersion: PROMPT_VERSION,
    async read(): Promise<ReaderResult> {
      return { ok: false, readerId: id, model, promptVersion: PROMPT_VERSION, error: "unavailable", message: CACHE_MISS_MESSAGE };
    },
  };
}

/** Caché que no escribe (en modo cache no hay lecturas nuevas que guardar). */
function readOnly(cache: ReadingCache): ReadingCache {
  return { get: (key) => cache.get(key), set: async () => undefined };
}

export function buildEvalReaders(mode: EvalReader, opts: { cacheDir?: string; manifest?: ManifestEntry[] } = {}): ReaderPair {
  if (mode === "simulated") {
    const manifest = opts.manifest ?? loadManifest();
    return {
      primary: createSimulatedReader({ id: PRIMARY_READER_ID, manifest }),
      secondary: createSimulatedReader({ id: SECONDARY_READER_ID, manifest }),
    };
  }
  const cacheDir = path.resolve(process.cwd(), opts.cacheDir ?? DEFAULT_CACHE_DIR);
  const cache = createFileReadingCache(cacheDir);
  if (mode === "cache") {
    const ro = readOnly(cache);
    return {
      primary: createCachedReader(cacheOnlyInner(PRIMARY_READER_ID, PRIMARY_MODEL), ro),
      secondary: createCachedReader(cacheOnlyInner(SECONDARY_READER_ID, SECONDARY_MODEL), ro),
    };
  }
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    throw new Error(
      "Falta ANTHROPIC_API_KEY: el modo live llama a la API de Anthropic (y cuesta dinero). " +
        "Defínela en el entorno, o usa --reader=simulated (sin costo) o --reader=cache (lecturas guardadas).",
    );
  }
  return {
    primary: createCachedReader(createAnthropicReader({ id: PRIMARY_READER_ID, model: PRIMARY_MODEL }), cache),
    secondary: createCachedReader(createAnthropicReader({ id: SECONDARY_READER_ID, model: SECONDARY_MODEL }), cache),
  };
}

// ───────────────────────── Evaluación ─────────────────────────

function readerResults(primary: ReaderResult, secondary: ReaderResult | null): ReaderResult[] {
  return secondary ? [primary, secondary] : [primary];
}

function emptyMetrics(): Metrics {
  return {
    total: 0,
    correct: 0,
    accuracy: 0,
    improperPayments: 0,
    overEscalations: 0,
    overFreezes: 0,
    autonomy: { resolved: 0, eligible: 0, rate: 0 },
  };
}

/** Métricas de un grupo de casos. */
export function computeMetrics(results: readonly CaseResult[]): Metrics {
  const m = emptyMetrics();
  for (const r of results) {
    m.total++;
    if (r.correct) m.correct++;
    if (r.improperPayment) m.improperPayments++;
    if (r.overEscalation) m.overEscalations++;
    if (r.overFreeze) m.overFreezes++;
    if (r.expected === "PAGAR" || r.expected === "FRENAR") {
      m.autonomy.eligible++;
      if (r.correct && r.outcome !== "ESCALAR") m.autonomy.resolved++;
    }
  }
  m.accuracy = m.total === 0 ? 0 : m.correct / m.total;
  m.autonomy.rate = m.autonomy.eligible === 0 ? 0 : m.autonomy.resolved / m.autonomy.eligible;
  return m;
}

function groupMetrics(results: readonly CaseResult[], key: (r: CaseResult) => string): Record<string, Metrics> {
  const groups = new Map<string, CaseResult[]>();
  for (const r of results) {
    const k = key(r);
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return Object.fromEntries([...groups].map(([k, list]) => [k, computeMetrics(list)]));
}

/** Clasifica un resultado contra la etiqueta del caso. */
export function scoreCase(
  row: CaseRow,
  outcome: Outcome | null,
  failCodes: CheckCode[],
  notEvaluableCodes: CheckCode[],
): Pick<CaseResult, "missingCodes" | "correct" | "improperPayment" | "overEscalation" | "overFreeze"> {
  const notPassing = new Set<CheckCode>([...failCodes, ...notEvaluableCodes]);
  const missingCodes = row.codigos_esperados.filter((c) => !notPassing.has(c));
  const expected = row.decision_esperada;
  return {
    missingCodes,
    correct: outcome != null && outcome === expected && missingCodes.length === 0,
    improperPayment: outcome === "PAGAR" && expected !== "PAGAR",
    overEscalation: outcome === "ESCALAR" && (expected === "PAGAR" || expected === "FRENAR"),
    overFreeze: outcome === "FRENAR" && expected !== "FRENAR",
  };
}

interface ScenarioRun {
  scenario: Scenario;
  rows: CaseRow[];
  /** Ids que se reportan (el resto de `rows` es solo historial). */
  reported: Set<string>;
}

function planRuns(rows: CaseRow[], scenarios: Scenario[], split: EvalSplit, cases: string[] | undefined): ScenarioRun[] {
  if (cases && cases.length > 0) {
    const known = new Set(rows.map((r) => r.id));
    const unknown = cases.filter((c) => !known.has(c));
    if (unknown.length > 0) throw new Error(`Caso(s) desconocido(s) en casos.csv: ${unknown.join(", ")}.`);
  }
  const wanted = (r: CaseRow) => (split === "all" || r.split === split) && (!cases || cases.length === 0 || cases.includes(r.id));

  const scenarioIds = new Set(scenarios.map((s) => s.id));
  const orphan = [...new Set(rows.map((r) => r.escenario))].filter((id) => !scenarioIds.has(id));
  if (orphan.length > 0) throw new Error(`casos.csv usa escenarios que no están en scenarios.json: ${orphan.join(", ")}.`);

  const runs: ScenarioRun[] = [];
  for (const scenario of scenarios) {
    const all = rows.filter((r) => r.escenario === scenario.id);
    let last = -1;
    all.forEach((r, i) => {
      if (wanted(r)) last = i;
    });
    if (last < 0) continue;
    const prefix = all.slice(0, last + 1);
    runs.push({ scenario, rows: prefix, reported: new Set(prefix.filter(wanted).map((r) => r.id)) });
  }
  if (runs.length === 0) throw new Error("No hay casos que evaluar con esos filtros.");
  return runs;
}

async function evaluateCase(
  row: CaseRow,
  entry: ManifestEntry | undefined,
  company: Company,
  scenario: Scenario,
  history: HistoryEntry[],
  readers: ReaderPair,
): Promise<{ result: CaseResult; historyEntry: HistoryEntry | null }> {
  const base = {
    caseId: row.id,
    split: row.split,
    escenario: row.escenario,
    formato: row.formato,
    descripcion: row.descripcion,
    expected: row.decision_esperada,
    expectedCodes: row.codigos_esperados,
  };
  const failed = (message: string): { result: CaseResult; historyEntry: null } => ({
    result: {
      ...base,
      outcome: null,
      failCodes: [],
      notEvaluableCodes: [],
      ...scoreCase(row, null, [], []),
      guardOverride: false,
      summary: "",
      readerErrors: [],
      usage: [],
      error: message,
    },
    historyEntry: null,
  });

  if (!entry) return failed(`El caso ${row.id} no tiene archivo en dataset/generated/manifest.json.`);

  let doc;
  try {
    const bytes = new Uint8Array(await readFile(manifestFilePath(entry)));
    doc = await normalizeFile(bytes, path.basename(entry.file), entry.mediaType);
  } catch (err) {
    return failed(`No se pudo leer el archivo ${entry.file}: ${err instanceof Error ? err.message : String(err)}`);
  }

  const invoiceId = `${scenario.id}/${row.id}`;
  const reading = await readInvoice(doc, readers);
  const decision = decideWithGuard({ invoiceId, fileHash: doc.fileHash, reading }, { company, history, now: scenario.now });

  const failCodes = decision.checks.filter((c) => c.status === "fail").map((c) => c.code);
  const notEvaluableCodes = decision.checks.filter((c) => c.status === "not_evaluable").map((c) => c.code);
  const results = readerResults(reading.primary, reading.secondary);

  const result: CaseResult = {
    ...base,
    outcome: decision.outcome,
    failCodes,
    notEvaluableCodes,
    ...scoreCase(row, decision.outcome, failCodes, notEvaluableCodes),
    guardOverride: decision.guardOverride,
    summary: decision.summary,
    readerErrors: results
      .filter((r): r is Extract<ReaderResult, { ok: false }> => !r.ok)
      .map((r) => `${r.readerId}: ${r.error} · ${r.message}`),
    usage: results
      .filter((r): r is Extract<ReaderResult, { ok: true }> => r.ok && r.usage != null)
      .map((r) => ({ readerId: r.readerId, model: r.model, inputTokens: r.usage!.inputTokens, outputTokens: r.usage!.outputTokens })),
  };

  const historyEntry: HistoryEntry = {
    invoiceId,
    fileHash: doc.fileHash,
    outcome: decision.outcome,
    vendorId: decision.vendorId,
    invoiceNumber: reading.data?.invoiceNumber ?? null,
    agreementId: decision.agreementId,
    agreementPeriod: decision.agreementPeriod,
    amountUsd: decision.amountUsd,
    decidedAt: scenario.now,
  };
  return { result, historyEntry };
}

function costOf(usage: readonly ReaderUsage[]): { byModel: Record<string, ModelCost>; total: ModelCost } {
  const byModel: Record<string, ModelCost> = {};
  for (const u of usage) {
    const m = (byModel[u.model] ??= { inputTokens: 0, outputTokens: 0, costUsd: 0 });
    m.inputTokens += u.inputTokens;
    m.outputTokens += u.outputTokens;
  }
  const total: ModelCost = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  for (const [model, m] of Object.entries(byModel)) {
    const price = PRICES_PER_MILLION[model] ?? { input: 0, output: 0 };
    m.costUsd = (m.inputTokens * price.input + m.outputTokens * price.output) / 1_000_000;
    total.inputTokens += m.inputTokens;
    total.outputTokens += m.outputTokens;
    total.costUsd += m.costUsd;
  }
  return { byModel, total };
}

/** Corre el banco de pruebas y devuelve el reporte (no escribe archivos). */
export async function runEval(opts: EvalOptions): Promise<EvalReport> {
  const split = opts.split ?? "all";
  const readers = buildEvalReaders(opts.reader, { cacheDir: opts.cacheDir });
  const company = loadDatasetCompany();
  const manifest = new Map(loadManifest().map((e) => [e.caseId, e]));
  const runs = planRuns(readCaseRows(), readScenarios(), split, opts.cases);

  const cases: CaseResult[] = [];
  const contextCases: string[] = [];
  const allUsage: ReaderUsage[] = [];
  let cacheMisses = 0;

  for (const run of runs) {
    const scenarioCompany = companyForScenario(company, run.scenario);
    const history: HistoryEntry[] = [];
    for (const row of run.rows) {
      const { result, historyEntry } = await evaluateCase(row, manifest.get(row.id), scenarioCompany, run.scenario, history, readers);
      if (historyEntry) history.push(historyEntry);
      allUsage.push(...result.usage);
      cacheMisses += result.readerErrors.filter((e) => e.includes(CACHE_MISS_MESSAGE)).length;
      if (run.reported.has(row.id)) {
        cases.push(result);
        opts.onCase?.(result);
      } else {
        contextCases.push(row.id);
      }
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    reader: opts.reader,
    split,
    caseFilter: opts.cases && opts.cases.length > 0 ? [...opts.cases] : null,
    promptVersion: PROMPT_VERSION,
    models: [...new Set([readers.primary.model, readers.secondary.model])],
    metrics: {
      total: computeMetrics(cases),
      bySplit: groupMetrics(cases, (r) => r.split),
      byScenario: groupMetrics(cases, (r) => r.escenario),
    },
    cases,
    contextCases,
    cacheMisses,
    usage: opts.reader === "live" ? costOf(allUsage) : null,
  };
}

// ───────────────────────── Reporte ─────────────────────────

const READER_LABEL: Record<EvalReader, string> = {
  simulated: "simulado (lectura «perfecta» del manifiesto: prueba la lógica de decisión, no mide la calidad de lectura)",
  cache: "caché (lecturas guardadas de los modelos en dataset/reading-cache; sin llamadas a la API)",
  live: "en vivo (API de Anthropic, con la caché de dataset/reading-cache)",
};

const SPLIT_LABEL: Record<EvalSplit, string> = { all: "todos", train: "train", holdout: "holdout" };

export function formatPct(rate: number): string {
  return `${(rate * 100).toFixed(1).replace(".", ",")} %`;
}

function ratio(n: number, d: number): string {
  return d === 0 ? "—" : `${n}/${d} (${formatPct(n / d)})`;
}

function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function metricsRow(label: string, m: Metrics): string {
  return `| ${cell(label)} | ${m.total} | ${ratio(m.correct, m.total)} | ${m.improperPayments} | ${m.overEscalations} | ${m.overFreezes} | ${ratio(m.autonomy.resolved, m.autonomy.eligible)} |`;
}

const METRICS_HEADER = [
  "| Grupo | Casos | Aciertos | Pagos indebidos | Escaladas de más | Frenos de más | Autonomía |",
  "|---|---:|---:|---:|---:|---:|---:|",
];

function codes(list: readonly string[]): string {
  return list.length > 0 ? list.join(", ") : "—";
}

function verdict(r: CaseResult): string {
  if (r.error) return "ERROR";
  if (r.improperPayment) return "PAGO INDEBIDO";
  return r.correct ? "correcto" : "fallo";
}

function usd(n: number): string {
  return `USD ${n.toFixed(4)}`;
}

/** Reporte en Markdown (español). */
export function renderMarkdown(report: EvalReport): string {
  const t = report.metrics.total;
  const lines: string[] = [];
  lines.push("# Banco de pruebas · Centinela", "");
  lines.push(`- Fecha: ${report.generatedAt}`);
  lines.push(`- Lector: ${READER_LABEL[report.reader]}`);
  lines.push(`- Casos: ${SPLIT_LABEL[report.split]}${report.caseFilter ? ` · filtro: ${report.caseFilter.join(", ")}` : ""}`);
  if (report.contextCases.length > 0) {
    lines.push(`- Procesados solo como historial (no cuentan): ${report.contextCases.join(", ")}`);
  }
  lines.push(`- Versión del prompt: ${report.promptVersion} · Modelos: ${report.models.join(", ")}`);
  if (report.reader === "cache") lines.push(`- Lecturas que no estaban en la caché: ${report.cacheMisses}`);
  lines.push("");

  lines.push("## Resumen", "");
  lines.push("| Métrica | Valor |", "|---|---:|");
  lines.push(`| Aciertos | ${ratio(t.correct, t.total)} |`);
  lines.push(`| Pagos indebidos | ${t.improperPayments} |`);
  lines.push(`| Escaladas de más | ${t.overEscalations} |`);
  lines.push(`| Frenos de más | ${t.overFreezes} |`);
  lines.push(`| Autonomía (PAGAR/FRENAR resueltos sin escalar) | ${ratio(t.autonomy.resolved, t.autonomy.eligible)} |`);
  if (report.usage) {
    lines.push(`| Tokens (entrada / salida) | ${report.usage.total.inputTokens} / ${report.usage.total.outputTokens} |`);
    lines.push(`| Costo estimado | ${usd(report.usage.total.costUsd)} |`);
  }
  lines.push("");

  lines.push("## Por split", "", ...METRICS_HEADER);
  for (const [k, m] of Object.entries(report.metrics.bySplit)) lines.push(metricsRow(k, m));
  lines.push("");

  lines.push("## Por escenario", "", ...METRICS_HEADER);
  for (const [k, m] of Object.entries(report.metrics.byScenario)) lines.push(metricsRow(k, m));
  lines.push("");

  if (report.usage) {
    lines.push("## Consumo y costo estimado", "");
    lines.push("Precios usados (USD por millón de tokens, entrada / salida): " +
      Object.entries(PRICES_PER_MILLION).map(([m, p]) => `${m} ${p.input} / ${p.output}`).join(" · ") + ".", "");
    lines.push("| Modelo | Tokens de entrada | Tokens de salida | Costo estimado |", "|---|---:|---:|---:|");
    for (const [model, c] of Object.entries(report.usage.byModel)) {
      lines.push(`| ${model} | ${c.inputTokens} | ${c.outputTokens} | ${usd(c.costUsd)} |`);
    }
    lines.push(`| **Total** | ${report.usage.total.inputTokens} | ${report.usage.total.outputTokens} | ${usd(report.usage.total.costUsd)} |`, "");
  }

  lines.push("## Detalle por caso", "");
  lines.push("| Caso | Escenario | Split | Esperado | Obtenido | Códigos esperados | Códigos no superados | Resultado |");
  lines.push("|---|---|---|---|---|---|---|---|");
  for (const r of report.cases) {
    const notPassing = [...r.failCodes, ...r.notEvaluableCodes.map((c) => `${c} (sin datos)`)];
    lines.push(
      `| ${r.caseId} | ${r.escenario} | ${r.split} | ${r.expected} | ${r.outcome ?? "—"}${r.guardOverride ? " (guardia)" : ""} | ${codes(r.expectedCodes)} | ${codes(notPassing)} | ${verdict(r)} |`,
    );
  }
  lines.push("");

  lines.push("## Fallos", "");
  const failures = report.cases.filter((r) => !r.correct);
  if (failures.length === 0) {
    lines.push("Ninguno.");
  } else {
    for (const r of failures) {
      const parts = [
        `**${r.caseId}** (${r.escenario}) · ${cell(r.descripcion)}`,
        `esperado ${r.expected}${r.expectedCodes.length ? ` [${r.expectedCodes.join(", ")}]` : ""}, obtenido ${r.outcome ?? "—"}`,
      ];
      if (r.improperPayment) parts.push("PAGO INDEBIDO");
      if (r.missingCodes.length > 0) parts.push(`faltan: ${r.missingCodes.join(", ")}`);
      if (r.error) parts.push(`error: ${cell(r.error)}`);
      if (r.summary) parts.push(`resumen: ${cell(r.summary)}`);
      if (r.readerErrors.length > 0) parts.push(`lecturas fallidas: ${cell(r.readerErrors.join("; "))}`);
      lines.push(`- ${parts.join(" · ")}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

/** Resumen de una línea para la consola. */
export function summaryLine(report: EvalReport): string {
  const t = report.metrics.total;
  const cost = report.usage ? ` · costo estimado ${usd(report.usage.total.costUsd)}` : "";
  return (
    `Aciertos ${ratio(t.correct, t.total)} · pagos indebidos ${t.improperPayments} · escaladas de más ${t.overEscalations} · ` +
    `frenos de más ${t.overFreezes} · autonomía ${ratio(t.autonomy.resolved, t.autonomy.eligible)}${cost}`
  );
}
