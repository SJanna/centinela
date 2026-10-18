/**
 * Recorrido completo de una factura:
 *   normalizeFile → saveInvoice → readInvoice → empresa → historial → decide → guardia → appendDecision.
 *
 * Las facturas se procesan DE A UNA por proceso (candado en memoria): el fondo, el límite del mes y
 * los duplicados dependen del historial, así que dos facturas simultáneas no pueden decidirse sobre
 * el mismo historial.
 *
 * Entre procesos (p. ej. dos instancias en Vercel) el candado no alcanza, así que la base protege el
 * PAGAR de dos formas y aquí se vuelve a decidir una vez con el historial fresco:
 * - rechaza un segundo pago equivalente (claves de pago con índice único, ver src/store/payment-keys.ts);
 * - solo inserta un PAGAR si el registro tiene los mismos pagos que el historial con que se decidió
 *   (candado de transacción, ver `appendPaymentIfUnchanged` en src/store/repo.ts): así el límite del
 *   mes (LIM-2) y el fondo (FON-1) siempre se calculan con todos los pagos.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import packageJson from "../../package.json";
import type { Decision, DecisionRecord, ReaderResult } from "../core/schemas";
import { normalizeFile } from "../ingest";
import { PROMPT_VERSION, readInvoice } from "../extract";
import { appendDecision, getHistory, isDuplicatePaymentError, isPaymentHistoryChangedError, saveInvoice } from "../store";
import { ensureCompany } from "./company";
import { escalateDuplicatePayment, escalatePaymentHistoryChanged } from "./duplicate-payment";
import { decideWithGuard } from "./guard-apply";
import { getReaders, type ReaderPair } from "./readers";
import { readingMode, type ReadingMode } from "./status";

export interface ProcessInput {
  bytes: Uint8Array;
  /** Nombre con que se subió el archivo. */
  filename: string;
  /** Tipo declarado por el navegador (pista; mandan los bytes). */
  mediaType?: string;
}

export interface ProcessOptions {
  /** ISO 8601. Fecha de la decisión (por defecto, ahora). */
  now?: string;
  /** Lectores a usar (por defecto, los del modo). */
  readers?: ReaderPair;
  /** Modo de lectura (por defecto, `readingMode()`). */
  mode?: ReadingMode;
}

export const APP_VERSION: string = (packageJson as { version?: string }).version ?? "0.0.0";

// ───────────────────────── Candado ─────────────────────────

const LOCK_KEY = "__centinelaProcessingLock";
const LOCK_CONTEXT_KEY = "__centinelaProcessingLockContext";

/** Turno de una tarea en la cola: `active` mientras la tarea tiene el candado. */
interface LockTurn {
  active: boolean;
}

type GlobalWithLock = typeof globalThis & {
  [LOCK_KEY]?: Promise<unknown>;
  [LOCK_CONTEXT_KEY]?: AsyncLocalStorage<LockTurn>;
};

/**
 * Ejecuta `task` cuando terminen las anteriores (cola de promesas en memoria del proceso).
 * El error de una tarea no bloquea a las siguientes. La cola se guarda en `globalThis` para que el
 * recargado en caliente de Next (o dos copias del módulo) no cree una segunda cola.
 *
 * Es reentrante: una llamada hecha DESDE una tarea que tiene el candado (p. ej. `processInvoice`
 * dentro de `withProcessingLock`) corre en el acto en vez de esperar a la tarea que la contiene, que
 * nunca terminaría. Una continuación que corre después de que la tarea soltó el candado vuelve a
 * hacer fila.
 */
export function withProcessingLock<T>(task: () => Promise<T>): Promise<T> {
  const g = globalThis as GlobalWithLock;
  const context = (g[LOCK_CONTEXT_KEY] ??= new AsyncLocalStorage<LockTurn>());
  if (context.getStore()?.active) return task();

  const turn: LockTurn = { active: false };
  const runTurn = async (): Promise<T> => {
    turn.active = true;
    try {
      return await context.run(turn, task);
    } finally {
      turn.active = false;
    }
  };
  const previous = g[LOCK_KEY] ?? Promise.resolve();
  const run = previous.then(runTurn, runTurn);
  g[LOCK_KEY] = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

// ───────────────────────── Procesamiento ─────────────────────────

function shortId(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function uniqueModels(results: (ReaderResult | null)[], fallback: string[]): string[] {
  const models = results.filter((r): r is ReaderResult => r != null).map((r) => r.model);
  const unique = [...new Set(models)];
  return unique.length > 0 ? unique : fallback;
}

/**
 * En modo live, si las dos lecturas salieron de la caché (lecturas exitosas sin consumo de tokens),
 * el registro dice «cache».
 */
function recordReadingMode(mode: ReadingMode, primary: ReaderResult, secondary: ReaderResult | null): DecisionRecord["readingMode"] {
  if (mode === "simulated") return "simulated";
  const fromCache = (r: ReaderResult | null) => r != null && r.ok && r.usage == null;
  return fromCache(primary) && fromCache(secondary) ? "cache" : "live";
}

/**
 * Procesa una factura y registra la decisión. Devuelve el registro guardado.
 *
 * Si la base rechaza el PAGAR porque otra instancia ya registró un pago equivalente
 * (DuplicatePaymentError) u otro pago cualquiera después de leer el historial
 * (PaymentHistoryChangedError), decide UNA vez más con el historial fresco (que ya incluye ese pago:
 * el motor frena por duplicado o recalcula el límite del mes y el fondo). Si la base vuelve a
 * rechazarlo, registra ESCALAR con la explicación.
 * @throws IngestError (mensaje en español) si el archivo no se puede leer; en ese caso no se guarda nada.
 */
export function processInvoice(input: ProcessInput, opts: ProcessOptions = {}): Promise<DecisionRecord> {
  return withProcessingLock(() => processUnlocked(input, opts));
}

async function processUnlocked(input: ProcessInput, opts: ProcessOptions): Promise<DecisionRecord> {
  const doc = await normalizeFile(input.bytes, input.filename, input.mediaType);

  const { id: invoiceId } = await saveInvoice({
    filename: doc.filename,
    mediaType: doc.mediaType,
    bytes: input.bytes,
    fileHash: doc.fileHash,
  });

  const mode = opts.mode ?? readingMode();
  const readers = opts.readers ?? getReaders(mode);
  const reading = await readInvoice(doc, readers);

  const company = await ensureCompany();
  const now = opts.now ?? new Date().toISOString();
  const engineInput = { invoiceId, fileHash: doc.fileHash, reading };
  /** Decide con el historial de ahora; `paymentsSeen` = cuántos PAGAR traía (la base lo exige igual al insertar). */
  const decideNow = async (): Promise<{ decision: Decision; paymentsSeen: number }> => {
    const history = await getHistory();
    return {
      decision: decideWithGuard(engineInput, { company, history, now }),
      paymentsSeen: history.filter((h) => h.outcome === "PAGAR").length,
    };
  };

  const id = `dec_${shortId()}`;
  const recordFor = (decision: Decision): DecisionRecord => ({
    id,
    invoiceId,
    decidedAt: now,
    filename: doc.filename,
    fileHash: doc.fileHash,
    decision,
    reading,
    companySnapshot: company,
    versions: {
      app: APP_VERSION,
      promptVersion: readers.primary.promptVersion ?? PROMPT_VERSION,
      models: uniqueModels([reading.primary, reading.secondary], [readers.primary.model, readers.secondary.model]),
    },
    readingMode: recordReadingMode(mode, reading.primary, reading.secondary),
  });

  // Un rechazo de la base no guarda nada, así que el mismo id sirve para el siguiente intento.
  const firstTry = await decideNow();
  const first = recordFor(firstTry.decision);
  try {
    await appendDecision(first, { paymentsSeen: firstTry.paymentsSeen });
    return first;
  } catch (err) {
    if (!isDuplicatePaymentError(err) && !isPaymentHistoryChangedError(err)) throw err;
  }

  const retryTry = await decideNow();
  const retry = recordFor(retryTry.decision);
  try {
    await appendDecision(retry, { paymentsSeen: retryTry.paymentsSeen });
    return retry;
  } catch (err) {
    let escalatedDecision: Decision;
    if (isDuplicatePaymentError(err)) escalatedDecision = escalateDuplicatePayment(retry.decision, err);
    else if (isPaymentHistoryChangedError(err)) escalatedDecision = escalatePaymentHistoryChanged(retry.decision);
    else throw err;
    const escalated = recordFor(escalatedDecision);
    await appendDecision(escalated);
    return escalated;
  }
}
