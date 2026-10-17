/**
 * Claves de pago: protección contra el pago doble entre instancias.
 *
 * El candado de `src/pipeline` es por proceso; en Vercel puede haber dos procesos decidiendo a la vez
 * sobre el mismo historial. Cada decisión PAGAR guarda tres claves en columnas con índice ÚNICO, así
 * la base rechaza el segundo de dos pagos equivalentes aunque vengan de procesos distintos:
 *
 * - `file`: huella del archivo (DUP-1).
 * - `invoice`: proveedor + número de factura normalizado (DUP-2).
 * - `period`: acuerdo + periodo, o acuerdo + "once" si el acuerdo es de pago único (DUP-3).
 *
 * Las normalizaciones replican las del motor (`src/engine/facts.ts`); src/store no puede importar el
 * motor, y una prueba de src/pipeline verifica que coincidan. Un FRENAR o ESCALAR no lleva claves.
 */
import type { DecisionRecord } from "../core/schemas";

export type PaymentKeyKind = "file" | "invoice" | "period";

export interface PaymentKeys {
  file: string | null;
  invoice: string | null;
  period: string | null;
}

export const PAYMENT_KEY_KINDS: readonly PaymentKeyKind[] = ["file", "invoice", "period"];

/** Índice único de cada clave (el nombre que Postgres devuelve al chocar). */
export const PAYMENT_KEY_INDEX: Record<PaymentKeyKind, string> = {
  file: "decisions_pay_file_key_uq",
  invoice: "decisions_pay_invoice_key_uq",
  period: "decisions_pay_period_key_uq",
};

/** Columna de cada clave en la tabla `decisions`. */
export const PAYMENT_KEY_COLUMN: Record<PaymentKeyKind, string> = {
  file: "pay_file_key",
  invoice: "pay_invoice_key",
  period: "pay_period_key",
};

const NO_KEYS: PaymentKeys = { file: null, invoice: null, period: null };

/** Igual que `normalizeFileHash` del motor: sin espacios alrededor y en minúsculas. */
export function paymentFileKey(fileHash: unknown): string | null {
  if (typeof fileHash !== "string") return null;
  const v = fileHash.trim().toLowerCase();
  return v.length > 0 ? v : null;
}

/**
 * Igual que `normalizeInvoiceNumber` del motor: letras y dígitos de ancho completo convertidos, sin
 * tildes, mayúsculas, sin separadores y sin ceros a la izquierda en cada tramo numérico.
 * "FE-0012", "fe 12" y "FE-００１２" → "FE12".
 */
export function normalizePaymentInvoiceNumber(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const tokens = raw
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((t) => t.length > 0);
  const v = tokens.map((t) => t.replace(/\d+/g, (digits) => String(digits.replace(/^0+/, "") || "0"))).join("");
  return v.length > 0 ? v : null;
}

function daysIn(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Igual que `periodOf` del motor: "YYYY-MM" (mes 01–12) o el mes de una fecha YYYY-MM-DD que existe. */
export function normalizePaymentPeriod(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) return v;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return null;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysIn(Number(m[1]), month)) return null;
  return `${m[1]}-${m[2]}`;
}

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.trim().length > 0;

/** Qué le falta a un registro para tener clave de factura (vacío si la tiene). */
export type InvoiceKeyGap = "vendor" | "number";

/** Partes de la clave de factura: proveedor emparejado (id tal cual) y número normalizado. */
function invoiceKeyParts(record: DecisionRecord): { vendorId: string | null; number: string | null } {
  const vendorId: unknown = record?.decision?.vendorId;
  return {
    vendorId: nonEmpty(vendorId) ? vendorId : null,
    number: normalizePaymentInvoiceNumber(record?.reading?.data?.invoiceNumber),
  };
}

/**
 * Clave de factura de un registro, «proveedor|número normalizado», sea cual sea la decisión (DUP-2 y
 * la clave de idempotencia de `src/pipeline/idempotency.ts` salen de aquí). null si no hay proveedor
 * emparejado o número legible.
 */
export function invoiceKeyOf(record: DecisionRecord): string | null {
  const { vendorId, number } = invoiceKeyParts(record);
  return vendorId != null && number != null ? `${vendorId}|${number}` : null;
}

/** Qué partes faltan para la clave de factura, en orden: proveedor, número. */
export function invoiceKeyGaps(record: DecisionRecord): InvoiceKeyGap[] {
  const { vendorId, number } = invoiceKeyParts(record);
  const gaps: InvoiceKeyGap[] = [];
  if (vendorId == null) gaps.push("vendor");
  if (number == null) gaps.push("number");
  return gaps;
}

/** Frecuencia del acuerdo en la copia de la empresa guardada con la decisión, o null si no aparece. */
function agreementFrequency(record: DecisionRecord, vendorId: string | null, agreementId: string): string | null {
  const vendors: unknown = record.companySnapshot?.vendors;
  if (!Array.isArray(vendors)) return null;
  const sameVendor = vendors.filter((v) => v && typeof v === "object" && (vendorId == null || v.id === vendorId));
  for (const vendor of sameVendor) {
    const agreements: unknown = vendor.agreements;
    if (!Array.isArray(agreements)) continue;
    const found = agreements.find((a) => a && typeof a === "object" && a.id === agreementId);
    if (found && typeof found.frequency === "string") return found.frequency;
  }
  return null;
}

/**
 * Claves de pago de un registro. Solo un PAGAR las tiene (las tres en null en otro caso).
 * Los ids de proveedor y acuerdo se comparan tal cual, como en el motor. El número normalizado solo
 * tiene letras y dígitos, así que «proveedor|número» y «acuerdo|periodo» no son ambiguos.
 * Un acuerdo mensual sin periodo válido (el motor no lo paga) toma el texto tal cual o "once".
 */
export function paymentKeysOf(record: DecisionRecord): PaymentKeys {
  const d = record?.decision;
  if (d?.outcome !== "PAGAR") return { ...NO_KEYS };
  const vendorId = nonEmpty(d.vendorId) ? d.vendorId : null;
  const agreementId = nonEmpty(d.agreementId) ? d.agreementId : null;

  let period: string | null = null;
  if (agreementId != null) {
    const once = agreementFrequency(record, vendorId, agreementId) === "once";
    const rawPeriod: unknown = d.agreementPeriod;
    const fallback = typeof rawPeriod === "string" && rawPeriod.trim().length > 0 ? rawPeriod.trim() : "once";
    period = `${agreementId}|${once ? "once" : (normalizePaymentPeriod(rawPeriod) ?? fallback)}`;
  }

  return {
    file: paymentFileKey(record.fileHash),
    invoice: invoiceKeyOf(record),
    period,
  };
}

const DUPLICATE_MESSAGE: Record<PaymentKeyKind | "unknown", string> = {
  file: "Ya hay un pago registrado del mismo archivo",
  invoice: "Ya hay un pago registrado con el mismo proveedor y número de factura",
  period: "Ya hay un pago registrado del mismo acuerdo y periodo",
  unknown: "Ya hay un pago equivalente registrado",
};

/**
 * Un pago equivalente ya está registrado (otra instancia lo guardó entre la lectura del historial y
 * esta inserción). La decisión no se guardó. `processInvoice` lo atrapa y vuelve a decidir.
 */
export class DuplicatePaymentError extends Error {
  override readonly name = "DuplicatePaymentError";
  /** Qué clave chocó (null si la base no lo dijo). */
  readonly kind: PaymentKeyKind | null;
  /** Valor de la clave que chocó (null si no se sabe). */
  readonly key: string | null;
  /** Id de la decisión que no se guardó. */
  readonly decisionId: string;
  /** Factura del pago ya registrado con esa clave, si se pudo averiguar. */
  readonly conflictingInvoiceId: string | null;

  constructor(
    init: { kind: PaymentKeyKind | null; key: string | null; decisionId: string; conflictingInvoiceId?: string | null },
    options?: { cause?: unknown },
  ) {
    super(`${DUPLICATE_MESSAGE[init.kind ?? "unknown"]}: la decisión «${init.decisionId}» no se registró.`, options);
    this.kind = init.kind;
    this.key = init.key;
    this.decisionId = init.decisionId;
    this.conflictingInvoiceId = init.conflictingInvoiceId ?? null;
  }
}

/** true si `err` es un DuplicatePaymentError (también si viene de otra copia del módulo). */
export function isDuplicatePaymentError(err: unknown): err is DuplicatePaymentError {
  return err instanceof DuplicatePaymentError || (err instanceof Error && err.name === "DuplicatePaymentError" && "decisionId" in err);
}
