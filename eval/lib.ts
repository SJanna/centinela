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
 * En cache y live los lectores salen del perfil de lectura (`profile`, o `READER_PROFILE`; por
 * defecto «economico»: Haiku 5.5 con el prompt «a» + Haiku 5.5 con el prompt «b»), igual que en la
 * aplicación (`createLiveReaders` / `liveReaderSpecs` de src/pipeline/readers): mismas claves de caché.
 *
 * Un caso es correcto si la decisión es la esperada y cada código esperado quedó en `fail` o
 * `not_evaluable`.
 *
 * Conjuntos (eval/datasets.ts): «base» (dataset/, 41 casos) o «stress» (dataset/stress/, 2000 casos
 * generados con npm run stress:generate). Los escenarios pueden correr en paralelo (`concurrency`);
 * los casos de un escenario siempre van en orden. Con `sample` se evalúa una muestra estratificada:
 * los casos anteriores de cada escenario que no están en la muestra se procesan solo como historial,
 * con la lectura simulada (no cuestan llamadas a la API).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { loadEvalDataset, type CaseExtras, type DatasetName } from "./datasets";
import { DEFAULT_SAMPLE_SEED, stratifiedSample } from "./sample";
import type { CaseRow, ManifestEntry, ReadingCache } from "../src/core/ports";
import type {
  CheckCode,
  Company,
  Extraction,
  HistoryEntry,
  Outcome,
  Reader,
  ReaderResult,
  ReadingAssessment,
  ReadingSignals,
} from "../src/core/schemas";
import { normalizeFile } from "../src/ingest";
import {
  createCachedReader,
  createFileReadingCache,
  createSimulatedReader,
  readInvoice,
  HAIKU_MODEL,
  SONNET_MODEL,
  type ReaderProfile,
} from "../src/extract";
import { decideWithGuard } from "../src/pipeline/guard-apply";
import { companyForScenario, loadManifest, type Scenario } from "../src/pipeline/dataset";
import { PRIMARY_READER_ID, SECONDARY_READER_ID } from "../src/pipeline/reader-ids";
import { createLiveReaders, liveReaderSpecs, readerProfile, type LiveReaderSpec } from "../src/pipeline/readers";

export type EvalReader = "simulated" | "cache" | "live";
export type EvalSplit = "train" | "holdout" | "all";

export interface EvalOptions {
  reader: EvalReader;
  /**
   * Perfil de lectura de los modos cache y live (qué modelo y qué prompt usa cada lector). Si falta,
   * el de `READER_PROFILE` (por defecto «economico»). No aplica al lector simulado.
   */
  profile?: ReaderProfile;
  /** Nombre base de los archivos del reporte en eval/reports (solo la CLI lo usa). */
  out?: string;
  /** Cliente de Anthropic para el modo live (pruebas). Si falta, se crea uno con las credenciales del entorno. */
  client?: Anthropic;
  /** Conjunto de casos: «base» (por defecto) o «stress». */
  dataset?: DatasetName;
  split?: EvalSplit;
  /** Solo estos casos (ids de casos.csv). Los casos anteriores de su escenario se procesan igual, como historial. */
  cases?: string[];
  /** Carpeta de la caché de lecturas (por defecto la del conjunto: dataset/reading-cache o dataset/stress/reading-cache). */
  cacheDir?: string;
  /** Escenarios en paralelo (por defecto 1). Los casos de un escenario siempre van en orden. */
  concurrency?: number;
  /** Evalúa una muestra estratificada (trampa × formato) de este tamaño. */
  sample?: number;
  /** Semilla de la muestra (por defecto 17). */
  sampleSeed?: number;
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
  /** Columnas extra del set de estrés (trampa, dificultad, idioma, plantilla). */
  extras?: CaseExtras;
  /** Qué leyó cada lector y las señales de la verificación (solo en los casos que fallaron). */
  reading?: ReadingDigest;
}

/** Lo que leyó un lector, en corto (para diagnosticar fallos). */
export interface ReaderDigest {
  readerId: string;
  model: string;
  promptVersion: string;
  /** Campos clave leídos (null si la lectura falló). */
  fields: Record<string, string | number | null> | null;
  /** Campos clave que el lector marcó como ilegibles. */
  illegible: string[];
  /** Instrucciones que el lector reportó en el documento. */
  embeddedInstructions: string[];
  /** Si la lectura falló: «tipo · mensaje». */
  error?: string;
}

export interface ReadingDigest {
  readers: ReaderDigest[];
  signals: ReadingSignals;
}

/** Identidad de un lector en el reporte. */
export interface ReaderInfo {
  id: string;
  model: string;
  promptVersion: string;
}

export interface Metrics {
  total: number;
  correct: number;
  accuracy: number;
  improperPayments: number;
  /** Casos que NO se debían pagar (FRENAR o ESCALAR esperados): base de la tasa de pagos indebidos. */
  shouldNotPay: number;
  overEscalations: number;
  overFreezes: number;
  /** Casos en que no se esperaba FRENAR: base de la tasa de frenos de más. */
  notFreeze: number;
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
  dataset: DatasetName;
  split: EvalSplit;
  caseFilter: string[] | null;
  /** Versiones de prompt de los lectores, sin repetir («v3» o «v3 + v3b»). */
  promptVersion: string;
  models: string[];
  /** Perfil de lectura (null con el lector simulado). */
  readerProfile: ReaderProfile | null;
  /** Cada lector con su modelo y versión de prompt. */
  readers: ReaderInfo[];
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
  usage: UsageCost | null;
  /** Muestra estratificada evaluada (null si se evaluó todo). */
  sample: { size: number; seed: number } | null;
  /** Escenarios en paralelo. */
  concurrency: number;
  /** Avisos del conjunto de casos (p. ej. la empresa cambió desde que se generó). */
  warnings: string[];
}

/**
 * USD por millón de tokens (entrada / salida), precios de la API de Anthropic. Haiku 5.5 cobra
 * 0,50 / 2,50 en prompts de más de 100 000 tokens; una factura no llega ni cerca.
 */
export const PRICES_PER_MILLION: Record<string, { input: number; output: number }> = {
  [SONNET_MODEL]: { input: 2, output: 10 },
  [HAIKU_MODEL]: { input: 0.1, output: 0.5 },
};

export interface UsageCost {
  byModel: Record<string, ModelCost>;
  /** Por lector («lector-a», «lector-b»): con el perfil económico los dos usan el mismo modelo. */
  byReader: Record<string, ModelCost>;
  total: ModelCost;
}

export const DEFAULT_CACHE_DIR = path.join("dataset", "reading-cache");

export const CACHE_MISS_MESSAGE =
  "No hay lectura guardada en la caché para este archivo (modo cache: no se llama a la API). Créala con npm run eval:live.";

/**
 * Reintentos del cliente en el banco de pruebas: con varios escenarios en paralelo la API puede
 * responder 429; el SDK espera lo que indica `retry-after` y reintenta (la app usa 1).
 */
export const EVAL_MAX_RETRIES = 4;

// ───────────────────────── Lectores ─────────────────────────

interface ReaderPair {
  primary: Reader;
  secondary: Reader;
}

/** Lector que nunca llama a la API: siempre falla. Envuelto con la caché, solo responde lo guardado. */
function cacheOnlyInner({ id, model, promptVersion }: LiveReaderSpec): Reader {
  return {
    id,
    model,
    promptVersion,
    async read(): Promise<ReaderResult> {
      return { ok: false, readerId: id, model, promptVersion, error: "unavailable", message: CACHE_MISS_MESSAGE };
    },
  };
}

/** Caché que no escribe (en modo cache no hay lecturas nuevas que guardar). */
function readOnly(cache: ReadingCache): ReadingCache {
  return { get: (key) => cache.get(key), set: async () => undefined };
}

/** Perfil de lectura que usa un modo (null con el lector simulado). */
export function evalReaderProfile(mode: EvalReader, profile?: ReaderProfile): ReaderProfile | null {
  return mode === "simulated" ? null : (profile ?? readerProfile());
}

export interface EvalReadersOptions {
  cacheDir?: string;
  manifest?: ManifestEntry[];
  /** Perfil de lectura (cache y live). Si falta, el de `READER_PROFILE` (por defecto «economico»). */
  profile?: ReaderProfile;
  /** Cliente de Anthropic (live). Si falta, se crea uno con las credenciales del entorno. */
  client?: Anthropic;
}

/**
 * Lectores del banco de pruebas. En cache y live son los mismos de la aplicación para el perfil
 * pedido (ids, modelos y versiones de prompt de `liveReaderSpecs`), así comparten claves de caché.
 */
export function buildEvalReaders(mode: EvalReader, opts: EvalReadersOptions = {}): ReaderPair {
  if (mode === "simulated") {
    const manifest = opts.manifest ?? loadManifest();
    return {
      primary: createSimulatedReader({ id: PRIMARY_READER_ID, manifest }),
      secondary: createSimulatedReader({ id: SECONDARY_READER_ID, manifest }),
    };
  }
  const profile = evalReaderProfile(mode, opts.profile)!;
  const cacheDir = path.resolve(process.cwd(), opts.cacheDir ?? DEFAULT_CACHE_DIR);
  const cache = createFileReadingCache(cacheDir);
  if (mode === "cache") {
    const ro = readOnly(cache);
    const specs = liveReaderSpecs(profile);
    return {
      primary: createCachedReader(cacheOnlyInner(specs.primary), ro),
      secondary: createCachedReader(cacheOnlyInner(specs.secondary), ro),
    };
  }
  if (!opts.client && !process.env.ANTHROPIC_API_KEY?.trim()) {
    throw new Error(
      "Falta ANTHROPIC_API_KEY: el modo live llama a la API de Anthropic (y cuesta dinero). " +
        "Defínela en el entorno, o usa --reader=simulated (sin costo) o --reader=cache (lecturas guardadas).",
    );
  }
  const client = opts.client ?? new Anthropic({ maxRetries: EVAL_MAX_RETRIES });
  return createLiveReaders({ profile, cache, client });
}

function readerInfo(r: Reader): ReaderInfo {
  return { id: r.id, model: r.model, promptVersion: r.promptVersion };
}

// ───────────────────────── Diagnóstico de lecturas ─────────────────────────

const DIGEST_FIELDS = [
  "vendorName",
  "vendorTaxId",
  "invoiceNumber",
  "issueDate",
  "servicePeriod",
  "currency",
  "subtotal",
  "tax",
  "total",
] as const;
const DIGEST_PAYMENT_FIELDS = ["beneficiaryName", "bankName", "accountNumber", "routingOrSwift"] as const;

function digestExtraction(e: Extraction): Pick<ReaderDigest, "fields" | "illegible" | "embeddedInstructions"> {
  const fields: Record<string, string | number | null> = { documentType: e.documentType };
  const illegible: string[] = [];
  for (const k of DIGEST_FIELDS) {
    fields[k] = e[k].value;
    if (!e[k].legible) illegible.push(k);
  }
  for (const k of DIGEST_PAYMENT_FIELDS) {
    fields[k] = e.payment[k].value;
    if (!e.payment[k].legible) illegible.push(k);
  }
  return { fields, illegible, embeddedInstructions: e.embeddedInstructions.map((i) => i.text) };
}

/** Resumen de las lecturas de un caso: qué leyó cada lector y las señales de la verificación. */
export function digestReading(reading: ReadingAssessment): ReadingDigest {
  const readers = readerResults(reading.primary, reading.secondary).map((r): ReaderDigest => {
    const base = { readerId: r.readerId, model: r.model, promptVersion: r.promptVersion };
    if (!r.ok) return { ...base, fields: null, illegible: [], embeddedInstructions: [], error: `${r.error} · ${r.message}` };
    return { ...base, ...digestExtraction(r.extraction) };
  });
  return { readers, signals: reading.signals };
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
    shouldNotPay: 0,
    overEscalations: 0,
    overFreezes: 0,
    notFreeze: 0,
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
    if (r.expected !== "PAGAR") m.shouldNotPay++;
    if (r.overEscalation) m.overEscalations++;
    if (r.overFreeze) m.overFreezes++;
    if (r.expected !== "FRENAR") m.notFreeze++;
    if (r.expected === "PAGAR" || r.expected === "FRENAR") {
      m.autonomy.eligible++;
      if (r.correct && r.outcome !== "ESCALAR") m.autonomy.resolved++;
    }
  }
  m.accuracy = m.total === 0 ? 0 : m.correct / m.total;
  m.autonomy.rate = m.autonomy.eligible === 0 ? 0 : m.autonomy.resolved / m.autonomy.eligible;
  return m;
}

/** Métricas por grupo. Una clave puede devolver varios grupos (p. ej. una factura con dos trampas). */
export function groupMetrics(results: readonly CaseResult[], key: (r: CaseResult) => string | string[]): Record<string, Metrics> {
  const groups = new Map<string, CaseResult[]>();
  for (const r of results) {
    for (const k of [key(r)].flat()) {
      const list = groups.get(k);
      if (list) list.push(r);
      else groups.set(k, [r]);
    }
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

function planRuns(rows: CaseRow[], scenarios: Scenario[], split: EvalSplit, cases: string[] | undefined, sample?: ReadonlySet<string>): ScenarioRun[] {
  if (cases && cases.length > 0) {
    const known = new Set(rows.map((r) => r.id));
    const unknown = cases.filter((c) => !known.has(c));
    if (unknown.length > 0) throw new Error(`Caso(s) desconocido(s) en casos.csv: ${unknown.join(", ")}.`);
  }
  const wanted = (r: CaseRow) =>
    (split === "all" || r.split === split) && (!cases || cases.length === 0 || cases.includes(r.id)) && (!sample || sample.has(r.id));

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
  filePath: (entry: ManifestEntry) => string,
  extras: CaseExtras | undefined,
): Promise<{ result: CaseResult; historyEntry: HistoryEntry | null }> {
  const base = {
    caseId: row.id,
    split: row.split,
    escenario: row.escenario,
    formato: row.formato,
    descripcion: row.descripcion,
    expected: row.decision_esperada,
    expectedCodes: row.codigos_esperados,
    ...(extras ? { extras } : {}),
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

  if (!entry) return failed(`El caso ${row.id} no tiene archivo en el manifiesto de su conjunto.`);

  let doc;
  try {
    const bytes = new Uint8Array(await readFile(filePath(entry)));
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
  if (!result.correct) result.reading = digestReading(reading);

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

/** Costo de un consumo con la tabla de precios (0 si el modelo no está en la tabla). */
export function usageCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICES_PER_MILLION[model] ?? { input: 0, output: 0 };
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

export function costOf(usage: readonly ReaderUsage[]): UsageCost {
  const byModel: Record<string, ModelCost> = {};
  const byReader: Record<string, ModelCost> = {};
  const total: ModelCost = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  for (const u of usage) {
    const cost = usageCostUsd(u.model, u.inputTokens, u.outputTokens);
    for (const m of [(byModel[u.model] ??= { inputTokens: 0, outputTokens: 0, costUsd: 0 }), (byReader[u.readerId] ??= { inputTokens: 0, outputTokens: 0, costUsd: 0 }), total]) {
      m.inputTokens += u.inputTokens;
      m.outputTokens += u.outputTokens;
      m.costUsd += cost;
    }
  }
  return { byModel, byReader, total };
}

/** Ejecuta `fn` sobre los índices 0..n-1 con a lo sumo `size` en paralelo. */
async function pool(n: number, size: number, fn: (i: number) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(size, n)) }, async () => {
    while (next < n) await fn(next++);
  });
  await Promise.all(workers);
}

/** Estrato de un caso para la muestra: trampa principal y, dentro, formato (en el dataset base, decisión y formato). */
function stratumOf(row: CaseRow, extras: CaseExtras | undefined): { group: string; stratum: string } {
  return { group: extras ? extras.trampa.split("+")[0] : row.decision_esperada, stratum: row.formato };
}

/** Corre el banco de pruebas y devuelve el reporte (no escribe archivos). */
export async function runEval(opts: EvalOptions): Promise<EvalReport> {
  const split = opts.split ?? "all";
  const dataset = loadEvalDataset(opts.dataset ?? "base");
  const profile = evalReaderProfile(opts.reader, opts.profile);
  const readers = buildEvalReaders(opts.reader, {
    cacheDir: opts.cacheDir ?? dataset.defaultCacheDir,
    manifest: dataset.manifest,
    profile: profile ?? undefined,
    client: opts.client,
  });
  const manifest = new Map(dataset.manifest.map((e) => [e.caseId, e]));
  const concurrency = Math.max(1, Math.floor(opts.concurrency ?? 1));

  let sample: Set<string> | undefined;
  const sampleSeed = opts.sampleSeed ?? DEFAULT_SAMPLE_SEED;
  if (opts.sample != null) {
    const candidates = dataset.rows.filter(
      (r) => (split === "all" || r.split === split) && (!opts.cases || opts.cases.length === 0 || opts.cases.includes(r.id)),
    );
    sample = new Set(stratifiedSample(candidates.map((r) => ({ id: r.id, ...stratumOf(r, dataset.extras.get(r.id)) })), opts.sample, sampleSeed));
  }
  const runs = planRuns(dataset.rows, dataset.scenarios, split, opts.cases, sample);
  // En una muestra, el historial de cada escenario se arma con la lectura simulada: sin costo y sin
  // los errores de lectura de casos que no se están midiendo.
  const contextReaders = sample && opts.reader !== "simulated" ? buildEvalReaders("simulated", { manifest: dataset.manifest }) : readers;

  const perRun: Array<{ cases: CaseResult[]; context: string[]; usage: ReaderUsage[]; misses: number }> = [];
  await pool(runs.length, concurrency, async (i) => {
    const run = runs[i];
    const scenarioCompany = companyForScenario(dataset.company, run.scenario);
    const history: HistoryEntry[] = [];
    const out = { cases: [] as CaseResult[], context: [] as string[], usage: [] as ReaderUsage[], misses: 0 };
    for (const row of run.rows) {
      const reported = run.reported.has(row.id);
      const { result, historyEntry } = await evaluateCase(
        row,
        manifest.get(row.id),
        scenarioCompany,
        run.scenario,
        history,
        reported ? readers : contextReaders,
        (e) => dataset.filePath(e),
        dataset.extras.get(row.id),
      );
      if (historyEntry) history.push(historyEntry);
      out.usage.push(...result.usage);
      out.misses += result.readerErrors.filter((e) => e.includes(CACHE_MISS_MESSAGE)).length;
      if (reported) {
        out.cases.push(result);
        opts.onCase?.(result);
      } else {
        out.context.push(row.id);
      }
    }
    perRun[i] = out;
  });

  const cases = perRun.flatMap((r) => r.cases);
  const contextCases = perRun.flatMap((r) => r.context);
  const allUsage = perRun.flatMap((r) => r.usage);
  const cacheMisses = perRun.reduce((s, r) => s + r.misses, 0);

  return {
    generatedAt: new Date().toISOString(),
    reader: opts.reader,
    dataset: dataset.name,
    split,
    caseFilter: opts.cases && opts.cases.length > 0 ? [...opts.cases] : null,
    promptVersion: [...new Set([readers.primary.promptVersion, readers.secondary.promptVersion])].join(" + "),
    models: [...new Set([readers.primary.model, readers.secondary.model])],
    readerProfile: profile,
    readers: [readerInfo(readers.primary), readerInfo(readers.secondary)],
    metrics: {
      total: computeMetrics(cases),
      bySplit: groupMetrics(cases, (r) => r.split),
      byScenario: groupMetrics(cases, (r) => r.escenario),
    },
    cases,
    contextCases,
    cacheMisses,
    usage: opts.reader === "live" ? costOf(allUsage) : null,
    sample: sample ? { size: sample.size, seed: sampleSeed } : null,
    concurrency,
    warnings: dataset.warnings,
  };
}

// ───────────────────────── Reporte ─────────────────────────

const READER_LABEL: Record<EvalReader, string> = {
  simulated: "simulado (lectura «perfecta» del manifiesto: prueba la lógica de decisión, no mide la calidad de lectura)",
  cache: "caché (lecturas guardadas de los modelos en dataset/reading-cache; sin llamadas a la API)",
  live: "en vivo (API de Anthropic, con la caché de dataset/reading-cache)",
};

/** «economico · lector-a: claude-haiku-5-5 (prompt v3) · lector-b: …» (null con el lector simulado). */
export function readersLine(report: Pick<EvalReport, "readerProfile" | "readers">): string | null {
  if (!report.readerProfile) return null;
  return [report.readerProfile, ...report.readers.map((r) => `${r.id}: ${r.model} (prompt ${r.promptVersion})`)].join(" · ");
}

function fieldText(v: string | number | null | undefined): string {
  return v == null ? "∅" : String(v);
}

/** Una línea por lector: qué leyó en los campos clave (para la sección de fallos). */
export function digestLines(d: ReadingDigest): string[] {
  const lines = d.readers.map((r) => {
    if (!r.fields) return `${r.readerId} (${r.model}, ${r.promptVersion}): falló · ${r.error ?? ""}`;
    const f = r.fields;
    const parts = [
      `tipo ${fieldText(f.documentType)}`,
      `proveedor «${fieldText(f.vendorName)}»`,
      `n.º ${fieldText(f.invoiceNumber)}`,
      `emisión ${fieldText(f.issueDate)}`,
      `periodo ${fieldText(f.servicePeriod)}`,
      `${fieldText(f.currency)} ${fieldText(f.total)} (subtotal ${fieldText(f.subtotal)}, impuesto ${fieldText(f.tax)})`,
      `cuenta ${fieldText(f.accountNumber)} en ${fieldText(f.bankName)} (${fieldText(f.routingOrSwift)})`,
    ];
    if (r.illegible.length > 0) parts.push(`ilegible: ${r.illegible.join(", ")}`);
    parts.push(`instrucciones: ${r.embeddedInstructions.length}`);
    return `${r.readerId} (${r.model}, ${r.promptVersion}): ${parts.join(" · ")}`;
  });
  const s = d.signals;
  const signals = [
    s.readersDisagreeOn.length ? `discrepan en ${s.readersDisagreeOn.join(", ")}` : null,
    s.missingCriticalFields.length ? `faltan ${s.missingCriticalFields.join(", ")}` : null,
    s.illegibleCriticalFields.length ? `ilegibles ${s.illegibleCriticalFields.join(", ")}` : null,
    s.arithmeticIssues.length ? `aritmética: ${s.arithmeticIssues.join("; ")}` : null,
    s.suspiciousInstructions.length ? `instrucciones detectadas: ${s.suspiciousInstructions.length} (${[...new Set(s.suspiciousInstructions.map((i) => i.source))].join(", ")})` : null,
    s.evidenceNotFound.length ? `citas no encontradas: ${s.evidenceNotFound.join(", ")}` : null,
    s.paidDocumentMarkers?.length
      ? `ya pagado: ${s.paidDocumentMarkers.length} (${[...new Set(s.paidDocumentMarkers.map((m) => m.source))].join(", ")})`
      : null,
    s.ingestWarnings?.length ? `avisos de entrada: ${s.ingestWarnings.length}` : null,
    s.voidDocumentMarkers?.length ? `no cobrable: ${s.voidDocumentMarkers.map((m) => `«${m.text}»`).join(", ")}` : null,
    s.currencyOnlyDollarSign ? "moneda escrita solo con «$»" : null,
  ].filter(Boolean);
  if (signals.length > 0) lines.push(`señales: ${signals.join(" · ")}`);
  return lines;
}

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
  const profileLine = readersLine(report);
  if (profileLine) lines.push(`- Perfil de lectura: ${profileLine}`);
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
    lines.push(...usageByReaderTable(report));
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
      if (r.reading && report.reader !== "simulated") for (const l of digestLines(r.reading)) lines.push(`  - ${cell(l)}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

/** Tabla de consumo por lector (vacía si no hay consumo). */
export function usageByReaderTable(report: Pick<EvalReport, "usage" | "readers">): string[] {
  if (!report.usage || Object.keys(report.usage.byReader).length === 0) return [];
  const lines = ["| Lector | Modelo · prompt | Tokens de entrada | Tokens de salida | Costo estimado |", "|---|---|---:|---:|---:|"];
  for (const [id, c] of Object.entries(report.usage.byReader)) {
    const info = report.readers.find((r) => r.id === id);
    lines.push(`| ${id} | ${info ? `${info.model} · ${info.promptVersion}` : "—"} | ${c.inputTokens} | ${c.outputTokens} | ${usd(c.costUsd)} |`);
  }
  lines.push("");
  return lines;
}

/** Nombre válido para `--out` (letras, números, guiones, puntos y guiones bajos; sin rutas). */
export const REPORT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;

/**
 * Nombre base de los archivos del reporte en eval/reports (sin extensión):
 * dataset base → «latest»; estrés → «stress-<lector>[-<perfil>][-muestraN]». `out` lo reemplaza.
 */
export function reportBaseName(report: Pick<EvalReport, "dataset" | "reader" | "readerProfile" | "sample">, out?: string): string {
  if (out) {
    if (!REPORT_NAME.test(out) || out.includes("..")) throw new Error(`Nombre de reporte inválido: «${out}».`);
    return out;
  }
  if (report.dataset !== "stress") return "latest";
  return ["stress", report.reader, report.readerProfile, report.sample ? `muestra${report.sample.size}` : null].filter(Boolean).join("-");
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
