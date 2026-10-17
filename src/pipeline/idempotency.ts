/**
 * Clave de idempotencia de una decisión, para quien ejecute el pago fuera de Centinela (por ejemplo,
 * una API que exige el encabezado `Idempotency-Key`). Centinela no paga: solo la calcula y la muestra.
 *
 * Es un UUID versión 5 (RFC 9562, sección 5.5) del espacio de nombres de Centinela sobre la clave de
 * factura que ya usa la protección contra duplicados: «proveedor|número normalizado» (DUP-2, ver
 * `src/store/payment-keys.ts`). Por eso la misma factura da siempre la misma clave, aunque llegue en
 * otro archivo o con el número escrito distinto («F-001» y «F-1»), y sin importar el resultado
 * (un ESCALAR aprobado después por una persona conserva la clave). No se guarda: se calcula al leer.
 */
import { createHash } from "node:crypto";
import type { DecisionRecord } from "../core/schemas";
import { invoiceKeyGaps, invoiceKeyOf } from "../store/payment-keys";

/**
 * Espacio de nombres propio de Centinela para las claves de idempotencia. Fijo: cambiarlo cambia
 * todas las claves ya entregadas y un pago repetido dejaría de reconocerse.
 */
export const IDEMPOTENCY_NAMESPACE = "db708853-9343-45a8-8910-1d91953b2767";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidBytes(uuid: string): Buffer {
  if (!UUID_RE.test(uuid)) throw new Error(`Espacio de nombres inválido: «${uuid}» no es un UUID.`);
  return Buffer.from(uuid.replace(/-/g, ""), "hex");
}

/**
 * UUID versión 5: SHA-1 de (espacio de nombres en 16 bytes + nombre en UTF-8), primeros 16 bytes,
 * con la versión (5) y la variante (10xx) escritas encima. Sale en minúsculas.
 */
export function uuidv5(name: string, namespace: string): string {
  const hash = createHash("sha1").update(uuidBytes(namespace)).update(name, "utf8").digest();
  const b = hash.subarray(0, 16);
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = b.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export type IdempotencyKey =
  /** `invoiceKey` es la clave de factura de la que sale (proveedor|número normalizado). */
  | { key: string; invoiceKey: string; reason: null }
  /** Sin proveedor emparejado o sin número legible no hay clave; `reason` dice por qué. */
  | { key: null; invoiceKey: null; reason: string };

const MISSING_REASON = {
  vendor: "Sin clave: no se identificó al proveedor en la ficha.",
  number: "Sin clave: no se pudo leer el número de factura.",
  both: "Sin clave: no se identificó al proveedor en la ficha ni se pudo leer el número de factura.",
} as const;

/** Clave de idempotencia de un registro, calculada en el momento (no está en la base). */
export function idempotencyKeyOf(record: DecisionRecord): IdempotencyKey {
  const invoiceKey = invoiceKeyOf(record);
  if (invoiceKey != null) return { key: uuidv5(invoiceKey, IDEMPOTENCY_NAMESPACE), invoiceKey, reason: null };
  const gaps = invoiceKeyGaps(record);
  const reason = gaps.length > 1 ? MISSING_REASON.both : gaps[0] === "vendor" ? MISSING_REASON.vendor : MISSING_REASON.number;
  return { key: null, invoiceKey: null, reason };
}
