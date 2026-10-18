/**
 * Repositorios de Centinela.
 *
 * Las funciones sueltas (`getCompany`, `appendDecision`, …) usan la conexión compartida de `getDb()`.
 * `createRepo(handle)` da las mismas funciones sobre otra conexión (pruebas aisladas, banco de pruebas).
 *
 * Las decisiones son un registro de solo inserción: no hay ninguna función que las modifique o borre
 * salvo `resetAll`, y la base de datos rechaza UPDATE/DELETE sobre la tabla.
 */
import { asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  CompanySchema,
  ExtractionSchema,
  RulesSchema,
  VendorSchema,
  type Company,
  type DecisionRecord,
  type HistoryEntry,
  type Outcome,
  type Rules,
  type Vendor,
} from "../core/schemas";
import type { ReadingCache } from "../core/ports";
import { CHECK_CATALOG } from "../core/checks";
import { monthOf, toCents } from "../core/normalize";
import { getDbHandle, type Db, type DbHandle, type StoreQuery } from "./db";
import { appMeta, companySettings, decisions, invoices, readingCache, vendors } from "./schema";
import { toDecisionSummary, type DecisionSummary } from "./mappers";
import { toJsonbSafe, toPgSafeString } from "./jsonb";
import {
  DuplicatePaymentError,
  isDuplicatePaymentError,
  isPaymentHistoryChangedError,
  PAYMENT_KEY_INDEX,
  PAYMENT_KEY_KINDS,
  PaymentHistoryChangedError,
  paymentKeysOf,
  type PaymentKeyKind,
} from "./payment-keys";

export type { DecisionSummary } from "./mappers";
export { toDecisionSummary, toHistoryEntry } from "./mappers";

export interface SaveInvoiceInput {
  filename: string;
  mediaType: string;
  bytes: Uint8Array;
  /** sha256 hex del archivo (lo calcula `src/ingest`). */
  fileHash: string;
}

export interface InvoiceFile {
  filename: string;
  mediaType: string;
  bytes: Uint8Array;
}

export interface Stats {
  /** Decisiones registradas. */
  total: number;
  byOutcome: Record<Outcome, number>;
  /** Suma de `amountUsd` de las decisiones PAGAR (todo el historial). */
  paidUsd: number;
  /** Suma de `amountUsd` de las decisiones FRENAR (todo el historial; las que no tienen monto no suman). */
  heldUsd: number;
  /** Suma de `amountUsd` de las decisiones ESCALAR (todo el historial; las que no tienen monto no suman). */
  escalatedUsd: number;
  /** Fondo inicial de las reglas. */
  initialFundUsd: number;
  /** Fondo inicial − pagado. */
  fundAvailableUsd: number;
  /** Mes calendario (YYYY-MM) de `now`, el que usan `monthSpentUsd` y LIM-2. */
  month: string;
  /** Pagado (PAGAR) en el mes de `now`, según la fecha de la decisión. */
  monthSpentUsd: number;
  periodLimitUsd: number;
  approvalThresholdUsd: number;
  /** (PAGAR + FRENAR) / total: lo que el agente resolvió sin una persona. 0 si no hay decisiones. */
  autonomyRate: number;
}

export interface Repo {
  getCompany(): Promise<Company | null>;
  saveCompany(company: Company): Promise<void>;
  saveRules(rules: Rules): Promise<void>;
  upsertVendor(vendor: Vendor): Promise<void>;
  deleteVendor(id: string): Promise<boolean>;
  replaceVendors(vendors: Vendor[]): Promise<void>;
  saveInvoice(input: SaveInvoiceInput): Promise<{ id: string }>;
  getInvoiceFile(id: string): Promise<InvoiceFile | null>;
  /**
   * Registra una decisión. Para un PAGAR, `opts.paymentsSeen` es cuántos PAGAR traía el historial con
   * que se decidió: la base solo lo inserta si siguen siendo esos (ver `appendPaymentIfUnchanged`).
   * @throws DuplicatePaymentError si es un PAGAR y ya hay un pago registrado con una de sus claves.
   * @throws PaymentHistoryChangedError si es un PAGAR con `paymentsSeen` y entretanto se registró otro pago.
   */
  appendDecision(record: DecisionRecord, opts?: AppendDecisionOptions): Promise<void>;
  getHistory(): Promise<HistoryEntry[]>;
  listDecisions(opts?: { limit?: number }): Promise<DecisionSummary[]>;
  getDecision(id: string): Promise<DecisionRecord | null>;
  getDecisionByInvoice(invoiceId: string): Promise<DecisionRecord | null>;
  getStats(now: string): Promise<Stats>;
  exportDecisions(): Promise<DecisionRecord[]>;
  resetAll(company: Company): Promise<void>;
  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, value: string): Promise<void>;
  readingCache(): ReadingCache;
}

const OUTCOMES: readonly Outcome[] = ["PAGAR", "FRENAR", "ESCALAR"];
const COMPANY_ROW_ID = 1;

/** Los drivers devuelven jsonb ya interpretado; por si alguno devuelve texto, se interpreta aquí. */
function fromJson<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

function roundUsd(value: number): number {
  return toCents(value) / 100;
}

function assertUniqueVendorIds(list: Vendor[]): void {
  const seen = new Set<string>();
  for (const v of list) {
    if (seen.has(v.id)) throw new Error(`El proveedor «${v.id}» aparece más de una vez.`);
    seen.add(v.id);
  }
}

/** El error de Postgres (o el que envuelve Drizzle) con código 23505, o null si no es una violación de unicidad. */
function uniqueViolation(err: unknown): { constraint?: unknown; message?: unknown; detail?: unknown } | null {
  for (let e: unknown = err, depth = 0; e && depth < 5; depth++) {
    if (typeof e === "object" && e !== null && (e as { code?: unknown }).code === "23505") return e;
    e = typeof e === "object" && e !== null ? (e as { cause?: unknown }).cause : undefined;
  }
  return null;
}

/** Qué clave de pago chocó, según el índice que nombra el error (null si fue otro, p. ej. el id). */
function collidedPaymentKey(violation: { constraint?: unknown; message?: unknown; detail?: unknown }): PaymentKeyKind | null {
  const named = typeof violation.constraint === "string" ? violation.constraint : "";
  const text = `${named} ${String(violation.message ?? "")} ${String(violation.detail ?? "")}`;
  return PAYMENT_KEY_KINDS.find((kind) => named === PAYMENT_KEY_INDEX[kind] || text.includes(PAYMENT_KEY_INDEX[kind])) ?? null;
}

function newInvoiceId(): string {
  return `inv_${globalThis.crypto.randomUUID()}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
}

function base64ToBytes(b64: string): Uint8Array {
  const buf = Buffer.from(b64, "base64");
  return new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

/** Errores de zod en español (por llamada: no cambia la configuración global de zod). */
const spanishZodErrors = z.locales.es().localeError;

/** Valida con zod y, si falla, lanza un error en español con la ruta de cada problema. */
function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value, { error: spanishZodErrors });
  if (result.success) return result.data;
  const issues = result.error.issues;
  const shown = issues.slice(0, 5).map((i) => (i.path.length > 0 ? `${i.path.join(".")}: ${i.message}` : i.message));
  const more = issues.length > shown.length ? ` (y ${issues.length - shown.length} problema(s) más)` : "";
  throw new Error(`${label}: ${shown.join("; ")}${more}.`, { cause: result.error });
}

// Misma forma que acepta la guardia (src/guard): fecha, y opcionalmente hora y zona horaria.
// El mes de LIM-2 y de `getStats` se toma de los 7 primeros caracteres, así que deben ser "YYYY-MM".
const ISO_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-](\d{2}):?(\d{2}))?)?$/;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** true si es una fecha ISO 8601 que existe (y que Postgres acepta como timestamptz). */
function isIsoDateTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = ISO_DATE_TIME.exec(value);
  if (!m) return false;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  if (day > (month === 2 && leap ? 29 : DAYS_IN_MONTH[month - 1])) return false;
  if (m[4] !== undefined && (Number(m[4]) > 23 || Number(m[5]) > 59 || (m[6] !== undefined && Number(m[6]) > 59))) return false;
  if (m[7] !== undefined && (Number(m[7]) > 15 || Number(m[8]) > 59)) return false;
  return true;
}

const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Lo mínimo para que un registro sirva al motor y a la guardia. Un registro guardado no se puede
 * corregir, así que lo que no cumpla se rechaza aquí y no se guarda.
 *
 * Un PAGAR, además, debe cumplir las invariantes 2 y 3 de CLAUDE.md (15 comprobaciones en «pass» y
 * aprobación de la guardia) y traer los datos con que el motor y la guardia controlan duplicados,
 * el límite del mes y el fondo. Un PAGAR sin monto, por ejemplo, dejaría LIM-2 y FON-1 sin poder
 * evaluarse para siempre.
 */
function validateRecord(record: DecisionRecord): void {
  const problems: string[] = [];
  if (!record || typeof record !== "object") throw new Error("La decisión a registrar no es válida.");
  if (typeof record.id !== "string" || record.id.length === 0) problems.push("falta id");
  if (typeof record.invoiceId !== "string" || record.invoiceId.length === 0) problems.push("falta invoiceId");
  if (!isIsoDateTime(record.decidedAt)) problems.push("decidedAt no es una fecha ISO 8601 válida (AAAA-MM-DD[THH:MM[:SS][Z|±HH:MM]])");
  if (typeof record.fileHash !== "string") problems.push("fileHash no es un texto");
  const d = record.decision;
  if (!d || !OUTCOMES.includes(d.outcome)) {
    problems.push("decision.outcome no es PAGAR, FRENAR ni ESCALAR");
  } else {
    const amount: unknown = d.amountUsd;
    if (amount != null && typeof amount !== "number") problems.push("decision.amountUsd no es un número");
    if (d.outcome === "PAGAR") {
      const checks = Array.isArray(d.checks) ? d.checks : [];
      const missing = CHECK_CATALOG.filter((c) => !checks.some((x) => x?.code === c.code)).map((c) => c.code);
      const notPassing = checks.filter((c) => c?.status !== "pass").map((c) => String(c?.code));
      const notPassed = [...new Set([...missing, ...notPassing])];
      if (notPassed.length > 0) {
        problems.push(`un PAGAR exige las ${CHECK_CATALOG.length} comprobaciones en «pass» (no lo están: ${notPassed.join(", ")})`);
      }
      if (d.guard?.approved !== true || d.guardOverride === true) problems.push("un PAGAR exige la aprobación de la guardia");
      if (!isFiniteNumber(amount) || amount < 0) problems.push("un PAGAR exige decision.amountUsd como número finito no negativo");
      if (!isNonEmptyString(d.vendorId)) problems.push("un PAGAR exige decision.vendorId");
      if (!isNonEmptyString(d.agreementId)) problems.push("un PAGAR exige decision.agreementId");
      if (!isNonEmptyString(record.reading?.data?.invoiceNumber)) problems.push("un PAGAR exige el número de factura leído");
      if (!isNonEmptyString(record.fileHash)) problems.push("un PAGAR exige fileHash");
    }
  }
  if (problems.length > 0) throw new Error(`La decisión a registrar no es válida: ${problems.join("; ")}.`);
}

// Consultas reutilizables (se construyen sobre la base que reciban, también dentro de una transacción).

function upsertSettingsQuery(db: Db, name: string, rules: Rules) {
  return db
    .insert(companySettings)
    .values({ id: COMPANY_ROW_ID, name, rules })
    .onConflictDoUpdate({
      target: companySettings.id,
      set: { name: sql`excluded.name`, rules: sql`excluded.rules`, updatedAt: sql`now()` },
    });
}

function replaceVendorsQueries(db: Db, list: Vendor[]): StoreQuery[] {
  const queries: StoreQuery[] = [db.delete(vendors)];
  if (list.length > 0) {
    queries.push(db.insert(vendors).values(list.map((v, position) => ({ id: v.id, data: v, position }))));
  }
  return queries;
}

const historyEntryExpr = sql<unknown>`jsonb_build_object(
  'invoiceId', ${decisions.invoiceId},
  'fileHash', ${decisions.record}->'fileHash',
  'outcome', ${decisions.outcome},
  'vendorId', ${decisions.record}->'decision'->'vendorId',
  'invoiceNumber', ${decisions.record}->'reading'->'data'->'invoiceNumber',
  'agreementId', ${decisions.record}->'decision'->'agreementId',
  'agreementPeriod', ${decisions.record}->'decision'->'agreementPeriod',
  'amountUsd', ${decisions.record}->'decision'->'amountUsd',
  'decidedAt', ${decisions.record}->'decidedAt'
)`;

// Solo convierte valores numéricos: un valor de otro tipo no debe hacer fallar las estadísticas.
const amountUsdExpr = sql`(CASE WHEN jsonb_typeof(${decisions.record}->'decision'->'amountUsd') = 'number'
  THEN (${decisions.record}->'decision'->>'amountUsd')::numeric END)`;

/** Factura de la decisión que ya tiene esa clave de pago (para explicar el choque), o null. */
async function invoiceWithKey(db: Db, kind: PaymentKeyKind, key: string): Promise<string | null> {
  const column = { file: decisions.payFileKey, invoice: decisions.payInvoiceKey, period: decisions.payPeriodKey }[kind];
  try {
    const [row] = await db.select({ invoiceId: decisions.invoiceId }).from(decisions).where(eq(column, key)).limit(1);
    return row?.invoiceId ?? null;
  } catch {
    return null;
  }
}

export interface AppendDecisionOptions {
  /** Cuántos PAGAR había en el historial con que se tomó la decisión (solo cuenta para un PAGAR). */
  paymentsSeen?: number;
}

/**
 * Clave del candado de transacción (pg_advisory_xact_lock) que ordena las inserciones de PAGAR entre
 * instancias. Un número fijo cualquiera, propio de Centinela.
 */
export const PAYMENT_LOCK_KEY = 4_317_202_610;

/**
 * Las tres sentencias de la inserción condicional de un PAGAR, en orden: aislamiento READ COMMITTED,
 * candado de transacción y la inserción con la condición. Exportada para las pruebas.
 */
export function paymentInsertQueries(db: Db, record: DecisionRecord, keys: ReturnType<typeof paymentKeysOf>, paymentsSeen: number): StoreQuery[] {
  return [
    db.execute(sql`SET TRANSACTION ISOLATION LEVEL READ COMMITTED`),
    db.execute(sql`SELECT pg_advisory_xact_lock(${PAYMENT_LOCK_KEY}::bigint)`),
    db.execute(sql`
      INSERT INTO decisions (id, invoice_id, decided_at, outcome, record, pay_file_key, pay_invoice_key, pay_period_key)
      SELECT ${record.id}, ${record.invoiceId}, ${record.decidedAt}::timestamptz, ${record.decision.outcome},
             ${JSON.stringify(record)}::jsonb, ${keys.file}, ${keys.invoice}, ${keys.period}
      WHERE (SELECT count(*) FROM decisions WHERE outcome = 'PAGAR') = ${paymentsSeen}::bigint`),
  ];
}

/**
 * Inserta un PAGAR solo si el registro sigue teniendo los mismos PAGAR que el historial con que se
 * decidió. LIM-2 (límite del mes) y FON-1 (fondo) suman pagos distintos, así que no caben en una
 * clave única: dos instancias podrían aprobar a la vez dos facturas que juntas se pasen. Aquí el
 * candado de transacción ordena las inserciones de PAGAR y la condición (mismo número de PAGAR)
 * rechaza el segundo si el primero entró después de leer el historial. Funciona igual en PGlite
 * (transacción) y en Neon HTTP (batch, que corre en una sola transacción): el candado se suelta al
 * confirmar. El registro es de solo inserción, así que el número de PAGAR solo crece (salvo un
 * reinicio, que lo vacía todo).
 *
 * La transacción se fija en READ COMMITTED: el conteo tiene que ver lo que confirmó quien tuvo el
 * candado antes. Con REPEATABLE READ o SERIALIZABLE (si la base los tuviera por defecto) el conteo
 * usaría la foto del comienzo de la transacción y los dos PAGAR entrarían (comprobado contra
 * Postgres 15 con dos sesiones).
 *
 * Esta transacción se comprueba con PGlite, que corre una transacción a la vez: las pruebas no
 * ejercitan el candado entre sesiones. Por eso hay una prueba que exige las tres sentencias en orden.
 * @throws Error si ya hay una decisión con ese id (el registro no se reescribe).
 * @throws PaymentHistoryChangedError si la condición no se cumplió (la fila no se insertó).
 */
async function appendPaymentIfUnchanged(h: DbHandle, record: DecisionRecord, keys: ReturnType<typeof paymentKeysOf>, paymentsSeen: number): Promise<void> {
  // Sin esto, una fila previa con el mismo id haría creer que la inserción entró.
  const existing = await h.db.select({ id: decisions.id }).from(decisions).where(eq(decisions.id, record.id)).limit(1);
  if (existing.length > 0) throw new Error(`Ya existe una decisión con id «${record.id}»: el registro no se puede reescribir.`);
  await h.atomic((db) => paymentInsertQueries(db, record, keys, paymentsSeen));
  const inserted = await h.db.select({ id: decisions.id }).from(decisions).where(eq(decisions.id, record.id)).limit(1);
  if (inserted.length > 0) return;
  // No entró. Si el pago nuevo es equivalente a este (misma clave), se dice eso, que es más preciso.
  for (const kind of PAYMENT_KEY_KINDS) {
    const key = keys[kind];
    if (key == null) continue;
    const conflictingInvoiceId = await invoiceWithKey(h.db, kind, key);
    if (conflictingInvoiceId != null) throw new DuplicatePaymentError({ kind, key, decisionId: record.id, conflictingInvoiceId });
  }
  const [{ n }] = await h.db.select({ n: sql<number>`count(*)::int` }).from(decisions).where(eq(decisions.outcome, "PAGAR"));
  throw new PaymentHistoryChangedError({ decisionId: record.id, paymentsSeen, paymentsNow: Number(n) });
}

/** Repositorio sobre una conexión concreta (o una función que la entrega cuando se necesita). */
export function createRepo(source: DbHandle | (() => Promise<DbHandle>)): Repo {
  const handle = (): Promise<DbHandle> => (typeof source === "function" ? source() : Promise.resolve(source));
  const database = async (): Promise<Db> => (await handle()).db;

  const repo: Repo = {
    async getCompany() {
      const db = await database();
      const [settingsRows, vendorRows] = await Promise.all([
        db.select().from(companySettings).where(eq(companySettings.id, COMPANY_ROW_ID)).limit(1),
        db.select({ data: vendors.data }).from(vendors).orderBy(asc(vendors.position), asc(vendors.id)),
      ]);
      const settings = settingsRows[0];
      if (!settings) return null;
      return {
        name: settings.name,
        rules: fromJson<Rules>(settings.rules),
        vendors: vendorRows.map((r) => fromJson<Vendor>(r.data)),
      };
    },

    async saveCompany(company) {
      const c = toJsonbSafe(parseOrThrow(CompanySchema, company, "La empresa no es válida"));
      assertUniqueVendorIds(c.vendors);
      const h = await handle();
      await h.atomic((db) => [upsertSettingsQuery(db, c.name, c.rules), ...replaceVendorsQueries(db, c.vendors)]);
    },

    async saveRules(rules) {
      const r = toJsonbSafe(parseOrThrow(RulesSchema, rules, "Las reglas no son válidas"));
      const db = await database();
      const updated = await db
        .update(companySettings)
        .set({ rules: r, updatedAt: sql`now()` })
        .where(eq(companySettings.id, COMPANY_ROW_ID))
        .returning({ id: companySettings.id });
      if (updated.length === 0) throw new Error("No hay empresa guardada: guarda la empresa antes de cambiar sus reglas.");
    },

    async upsertVendor(vendor) {
      const v = toJsonbSafe(parseOrThrow(VendorSchema, vendor, "El proveedor no es válido"));
      const db = await database();
      await db
        .insert(vendors)
        .values({ id: v.id, data: v, position: sql`(SELECT coalesce(max(${vendors.position}), -1) + 1 FROM ${vendors})` })
        .onConflictDoUpdate({ target: vendors.id, set: { data: sql`excluded.data`, updatedAt: sql`now()` } });
    },

    async deleteVendor(id) {
      const db = await database();
      const deleted = await db.delete(vendors).where(eq(vendors.id, toPgSafeString(id))).returning({ id: vendors.id });
      return deleted.length > 0;
    },

    async replaceVendors(list) {
      const parsed = toJsonbSafe(parseOrThrow(z.array(VendorSchema), list, "La lista de proveedores no es válida"));
      assertUniqueVendorIds(parsed);
      const h = await handle();
      await h.atomic((db) => replaceVendorsQueries(db, parsed));
    },

    async saveInvoice({ filename, mediaType, bytes, fileHash }) {
      const id = newInvoiceId();
      const db = await database();
      await db.insert(invoices).values({
        id,
        filename: toPgSafeString(filename),
        mediaType: toPgSafeString(mediaType),
        fileHash: toPgSafeString(fileHash),
        size: bytes.byteLength,
        bytesB64: bytesToBase64(bytes),
      });
      return { id };
    },

    async getInvoiceFile(id) {
      const db = await database();
      const [row] = await db
        .select({ filename: invoices.filename, mediaType: invoices.mediaType, bytesB64: invoices.bytesB64 })
        .from(invoices)
        .where(eq(invoices.id, toPgSafeString(id)))
        .limit(1);
      if (!row) return null;
      return { filename: row.filename, mediaType: row.mediaType, bytes: base64ToBytes(row.bytesB64) };
    },

    async appendDecision(input, opts) {
      validateRecord(input);
      const record = toJsonbSafe(input);
      const keys = paymentKeysOf(record);
      const h = await handle();
      const db = h.db;
      const paymentsSeen = opts?.paymentsSeen;
      if (paymentsSeen !== undefined && (!Number.isSafeInteger(paymentsSeen) || paymentsSeen < 0)) {
        throw new Error(`paymentsSeen debe ser un entero no negativo (llegó ${String(paymentsSeen)}).`);
      }
      try {
        if (record.decision.outcome === "PAGAR" && paymentsSeen !== undefined) {
          await appendPaymentIfUnchanged(h, record, keys, paymentsSeen);
        } else {
          await db.insert(decisions).values({
            id: record.id,
            invoiceId: record.invoiceId,
            decidedAt: record.decidedAt,
            outcome: record.decision.outcome,
            record,
            payFileKey: keys.file,
            payInvoiceKey: keys.invoice,
            payPeriodKey: keys.period,
          });
        }
      } catch (err) {
        if (isPaymentHistoryChangedError(err) || isDuplicatePaymentError(err)) throw err;
        const violation = uniqueViolation(err);
        if (violation == null) throw err;
        const kind = collidedPaymentKey(violation);
        if (kind != null) {
          const key = keys[kind];
          throw new DuplicatePaymentError(
            { kind, key, decisionId: record.id, conflictingInvoiceId: key == null ? null : await invoiceWithKey(db, kind, key) },
            { cause: err },
          );
        }
        throw new Error(`Ya existe una decisión con id «${record.id}»: el registro no se puede reescribir.`, { cause: err });
      }
    },

    async getHistory() {
      const db = await database();
      const rows = await db
        .select({ entry: historyEntryExpr })
        .from(decisions)
        .orderBy(asc(decisions.decidedAt), asc(decisions.seq));
      return rows.map(({ entry }) => {
        const e = fromJson<Partial<HistoryEntry>>(entry);
        return {
          invoiceId: e.invoiceId as string,
          fileHash: e.fileHash as string,
          outcome: e.outcome as Outcome,
          vendorId: e.vendorId ?? null,
          invoiceNumber: e.invoiceNumber ?? null,
          agreementId: e.agreementId ?? null,
          agreementPeriod: e.agreementPeriod ?? null,
          amountUsd: e.amountUsd ?? null,
          decidedAt: e.decidedAt as string,
        };
      });
    },

    async listDecisions(opts) {
      const db = await database();
      const limit = opts?.limit;
      const base = db
        .select({ record: decisions.record })
        .from(decisions)
        .orderBy(desc(decisions.decidedAt), desc(decisions.seq));
      // Un límite con decimales se trunca y uno negativo no devuelve nada; sin límite (o NaN/∞) devuelve todo.
      const rows = isFiniteNumber(limit) ? await base.limit(Math.max(0, Math.floor(limit))) : await base;
      return rows.map((r) => toDecisionSummary(fromJson<DecisionRecord>(r.record)));
    },

    async getDecision(id) {
      const db = await database();
      const [row] = await db.select({ record: decisions.record }).from(decisions).where(eq(decisions.id, toPgSafeString(id))).limit(1);
      return row ? fromJson<DecisionRecord>(row.record) : null;
    },

    async getDecisionByInvoice(invoiceId) {
      const db = await database();
      const [row] = await db
        .select({ record: decisions.record })
        .from(decisions)
        .where(eq(decisions.invoiceId, toPgSafeString(invoiceId)))
        .orderBy(desc(decisions.decidedAt), desc(decisions.seq))
        .limit(1);
      return row ? fromJson<DecisionRecord>(row.record) : null;
    },

    async getStats(now) {
      if (!isIsoDateTime(now)) throw new Error(`now no es una fecha ISO 8601 válida: «${String(now)}».`);
      const month = monthOf(now);
      const db = await database();
      const [settingsRows, groups] = await Promise.all([
        db.select({ rules: companySettings.rules }).from(companySettings).where(eq(companySettings.id, COMPANY_ROW_ID)).limit(1),
        db
          .select({
            outcome: decisions.outcome,
            count: sql<number>`count(*)::int`,
            amountUsd: sql<string>`coalesce(sum(${amountUsdExpr}), 0)::text`,
            monthAmountUsd: sql<string>`coalesce(sum(${amountUsdExpr}) FILTER (WHERE left(${decisions.record}->>'decidedAt', 7) = ${month}), 0)::text`,
          })
          .from(decisions)
          .groupBy(decisions.outcome),
      ]);
      const rules = settingsRows[0] ? fromJson<Rules>(settingsRows[0].rules) : null;
      const byOutcome: Record<Outcome, number> = { PAGAR: 0, FRENAR: 0, ESCALAR: 0 };
      const amountByOutcome: Record<Outcome, number> = { PAGAR: 0, FRENAR: 0, ESCALAR: 0 };
      let monthSpentUsd = 0;
      for (const g of groups) {
        if (!OUTCOMES.includes(g.outcome)) continue;
        byOutcome[g.outcome] = Number(g.count);
        amountByOutcome[g.outcome] = roundUsd(Number(g.amountUsd));
        if (g.outcome === "PAGAR") monthSpentUsd = roundUsd(Number(g.monthAmountUsd));
      }
      const paidUsd = amountByOutcome.PAGAR;
      const total = byOutcome.PAGAR + byOutcome.FRENAR + byOutcome.ESCALAR;
      const initialFundUsd = rules?.initialFundUsd ?? 0;
      return {
        total,
        byOutcome,
        paidUsd,
        heldUsd: amountByOutcome.FRENAR,
        escalatedUsd: amountByOutcome.ESCALAR,
        initialFundUsd,
        fundAvailableUsd: roundUsd(initialFundUsd - paidUsd),
        month,
        monthSpentUsd,
        periodLimitUsd: rules?.periodLimitUsd ?? 0,
        approvalThresholdUsd: rules?.approvalThresholdUsd ?? 0,
        autonomyRate: total === 0 ? 0 : (byOutcome.PAGAR + byOutcome.FRENAR) / total,
      };
    },

    async exportDecisions() {
      const db = await database();
      const rows = await db
        .select({ record: decisions.record })
        .from(decisions)
        .orderBy(asc(decisions.decidedAt), asc(decisions.seq));
      return rows.map((r) => fromJson<DecisionRecord>(r.record));
    },

    async resetAll(company) {
      const c = toJsonbSafe(parseOrThrow(CompanySchema, company, "La empresa no es válida"));
      assertUniqueVendorIds(c.vendors);
      const h = await handle();
      await h.atomic((db) => [
        // TRUNCATE (y no DELETE) porque el registro de decisiones rechaza borrados fila por fila.
        db.execute(sql`TRUNCATE TABLE ${invoices}, ${decisions} RESTART IDENTITY`),
        upsertSettingsQuery(db, c.name, c.rules),
        ...replaceVendorsQueries(db, c.vendors),
      ]);
    },

    async getMeta(key) {
      const db = await database();
      const [row] = await db.select({ value: appMeta.value }).from(appMeta).where(eq(appMeta.key, toPgSafeString(key))).limit(1);
      return row ? row.value : null;
    },

    async setMeta(key, value) {
      const db = await database();
      await db
        .insert(appMeta)
        .values({ key: toPgSafeString(key), value: toPgSafeString(value) })
        .onConflictDoUpdate({ target: appMeta.key, set: { value: sql`excluded.value` } });
    },

    readingCache() {
      return {
        async get(key) {
          const db = await database();
          const [row] = await db
            .select({ extraction: readingCache.extraction })
            .from(readingCache)
            .where(eq(readingCache.key, toPgSafeString(key)))
            .limit(1);
          if (!row) return null;
          // Una entrada que ya no cumple el esquema (p. ej. guardada con otra versión) cuenta como ausente.
          const parsed = ExtractionSchema.safeParse(fromJson<unknown>(row.extraction));
          return parsed.success ? parsed.data : null;
        },
        async set(key, value) {
          const extraction = toJsonbSafe(parseOrThrow(ExtractionSchema, value, "La lectura no es válida"));
          const db = await database();
          await db
            .insert(readingCache)
            .values({ key: toPgSafeString(key), extraction })
            .onConflictDoUpdate({ target: readingCache.key, set: { extraction: sql`excluded.extraction`, createdAt: sql`now()` } });
        },
      };
    },
  };
  return repo;
}

// ───────────────────────── Funciones sobre la conexión compartida ─────────────────────────

const shared = createRepo(getDbHandle);

/** Empresa (reglas + proveedores en su orden), o null si aún no se ha guardado. */
export function getCompany(): Promise<Company | null> {
  return shared.getCompany();
}
/** Reemplaza nombre, reglas y la ficha completa de proveedores (valida con CompanySchema). */
export function saveCompany(company: Company): Promise<void> {
  return shared.saveCompany(company);
}
/** Cambia solo las reglas. Falla si todavía no hay empresa guardada. */
export function saveRules(rules: Rules): Promise<void> {
  return shared.saveRules(rules);
}
/** Crea o actualiza un proveedor; uno nuevo queda al final de la lista. */
export function upsertVendor(vendor: Vendor): Promise<void> {
  return shared.upsertVendor(vendor);
}
/** Borra un proveedor. Devuelve true si existía. */
export function deleteVendor(id: string): Promise<boolean> {
  return shared.deleteVendor(id);
}
/** Reemplaza toda la ficha de proveedores (importar JSON). El orden del arreglo es el orden guardado. */
export function replaceVendors(list: Vendor[]): Promise<void> {
  return shared.replaceVendors(list);
}
/** Guarda el archivo subido y devuelve su id (`inv_…`). */
export function saveInvoice(input: SaveInvoiceInput): Promise<{ id: string }> {
  return shared.saveInvoice(input);
}
export function getInvoiceFile(id: string): Promise<InvoiceFile | null> {
  return shared.getInvoiceFile(id);
}
/**
 * Agrega una decisión al registro. Falla si ya existe una con el mismo id. Un PAGAR guarda sus claves
 * de pago; si otra decisión PAGAR ya tiene una de ellas, lanza DuplicatePaymentError y no guarda nada.
 */
export function appendDecision(record: DecisionRecord, opts?: AppendDecisionOptions): Promise<void> {
  return shared.appendDecision(record, opts);
}
/** Historial para el motor y la guardia, del más antiguo al más reciente. */
export function getHistory(): Promise<HistoryEntry[]> {
  return shared.getHistory();
}
/** Decisiones para la pantalla, de la más reciente a la más antigua. */
export function listDecisions(opts?: { limit?: number }): Promise<DecisionSummary[]> {
  return shared.listDecisions(opts);
}
export function getDecision(id: string): Promise<DecisionRecord | null> {
  return shared.getDecision(id);
}
/** La decisión más reciente de una factura, o null. */
export function getDecisionByInvoice(invoiceId: string): Promise<DecisionRecord | null> {
  return shared.getDecisionByInvoice(invoiceId);
}
export function getStats(now: string): Promise<Stats> {
  return shared.getStats(now);
}
/** Todas las decisiones completas, de la más antigua a la más reciente. */
export function exportDecisions(): Promise<DecisionRecord[]> {
  return shared.exportDecisions();
}
/** Borra facturas y decisiones (no la caché de lecturas ni app_meta) y guarda la empresa dada. */
export function resetAll(company: Company): Promise<void> {
  return shared.resetAll(company);
}
export function getMeta(key: string): Promise<string | null> {
  return shared.getMeta(key);
}
export function setMeta(key: string, value: string): Promise<void> {
  return shared.setMeta(key, value);
}
/** Caché de lecturas sobre la base compartida (implementa ReadingCache de src/core/ports). */
export function createDbReadingCache(): ReadingCache {
  return shared.readingCache();
}
