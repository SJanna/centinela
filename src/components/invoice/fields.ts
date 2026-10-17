/**
 * Campos leídos de una factura tal como los muestra la tabla "Datos leídos", y qué campos usa cada
 * comprobación (para iluminar la fila al pasar el cursor). Funciones puras.
 */
import { CRITICAL_FIELDS, type CheckCode, type Extraction, type ReaderResult, type ReadingAssessment } from "@/core/schemas";

export type FieldKey =
  | "vendorName"
  | "vendorTaxId"
  | "invoiceNumber"
  | "issueDate"
  | "dueDate"
  | "servicePeriod"
  | "currency"
  | "subtotal"
  | "tax"
  | "total"
  | "beneficiaryName"
  | "bankName"
  | "accountNumber"
  | "routingOrSwift"
  | "lineItems";

export type FieldFormat = "text" | "money" | "date" | "period" | "account" | "currency" | "lines";

export interface FieldRow {
  key: FieldKey;
  label: string;
  format: FieldFormat;
  /** "critical": la coincidencia sale de la verificación (LEC-2) · "compare": se compara aquí para mostrarla. */
  match: "critical" | "compare" | null;
}

export const FIELD_ROWS: readonly FieldRow[] = [
  { key: "vendorName", label: "Proveedor", format: "text", match: "critical" },
  { key: "vendorTaxId", label: "Identificación tributaria", format: "text", match: null },
  { key: "invoiceNumber", label: "Número", format: "text", match: "critical" },
  { key: "issueDate", label: "Emisión", format: "date", match: "compare" },
  { key: "dueDate", label: "Vencimiento", format: "date", match: "compare" },
  { key: "servicePeriod", label: "Periodo", format: "period", match: "compare" },
  { key: "currency", label: "Moneda", format: "currency", match: "critical" },
  { key: "lineItems", label: "Líneas", format: "lines", match: "compare" },
  { key: "subtotal", label: "Subtotal", format: "money", match: null },
  { key: "tax", label: "Impuestos", format: "money", match: null },
  { key: "total", label: "Total", format: "money", match: "critical" },
  { key: "beneficiaryName", label: "Beneficiario", format: "text", match: null },
  { key: "bankName", label: "Banco", format: "text", match: "compare" },
  { key: "accountNumber", label: "Cuenta destino", format: "account", match: "critical" },
  { key: "routingOrSwift", label: "SWIFT o ruta", format: "text", match: null },
];

export const CRITICAL_SET: ReadonlySet<string> = new Set<string>(CRITICAL_FIELDS);

/** Campos que mira cada comprobación. Vacío si la comprobación no depende de un dato leído. */
export const CHECK_FIELDS: Record<CheckCode, readonly FieldKey[]> = {
  "LEC-1": ["vendorName", "invoiceNumber", "currency", "total", "accountNumber"],
  "LEC-2": ["vendorName", "invoiceNumber", "currency", "total", "accountNumber"],
  "LEC-3": ["lineItems", "subtotal", "tax", "total"],
  "LEC-4": [],
  "DUP-1": [],
  "DUP-2": ["vendorName", "invoiceNumber"],
  "DUP-3": ["servicePeriod", "issueDate"],
  "PRV-1": ["vendorName", "vendorTaxId"],
  "PRV-2": ["accountNumber", "bankName", "beneficiaryName"],
  "ACU-1": ["issueDate", "servicePeriod"],
  "ACU-2": ["currency"],
  "ACU-3": ["lineItems", "total", "currency"],
  "LIM-1": ["total", "currency"],
  "LIM-2": ["total", "currency"],
  "FON-1": ["total", "currency"],
};

/** Comprobaciones que usan un campo (para el hover inverso: fila → comprobaciones). */
export function checksForField(field: FieldKey): CheckCode[] {
  return (Object.keys(CHECK_FIELDS) as CheckCode[]).filter((code) => CHECK_FIELDS[code].includes(field));
}

export interface FieldReading {
  value: string | number | null;
  evidence: string | null;
  legible: boolean;
}

export interface LinesReading {
  count: number;
  sum: number;
  items: Extraction["lineItems"];
}

export function extractionOf(result: ReaderResult | null | undefined): Extraction | null {
  return result && result.ok ? result.extraction : null;
}

/** El campo de una lectura (null si la lectura falló). */
export function readField(e: Extraction | null, key: Exclude<FieldKey, "lineItems">): FieldReading | null {
  if (!e) return null;
  switch (key) {
    case "beneficiaryName":
    case "bankName":
    case "accountNumber":
    case "routingOrSwift":
      return e.payment?.[key] ?? null;
    default:
      return (e[key] as FieldReading | undefined) ?? null;
  }
}

export function readLines(e: Extraction | null): LinesReading | null {
  if (!e) return null;
  const items = Array.isArray(e.lineItems) ? e.lineItems : [];
  const sum = items.reduce((acc, l) => acc + (Number.isFinite(l.amount) ? Math.round(l.amount * 100) : 0), 0) / 100;
  return { count: items.length, sum, items };
}

function normalizeText(value: string | number | null | undefined): string | null {
  if (value == null) return null;
  const v = String(value)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toLowerCase();
  return v.length > 0 ? v : null;
}

/** ¿Las dos lecturas dicen lo mismo en este campo? Solo para mostrarlo; la decisión usa LEC-2. */
export function readingsAgree(key: FieldKey, a: Extraction | null, b: Extraction | null): boolean {
  if (key === "lineItems") {
    const la = readLines(a);
    const lb = readLines(b);
    if (!la || !lb) return false;
    if (la.count !== lb.count) return false;
    return la.items.every((item, i) => Math.round(item.amount * 100) === Math.round((lb.items[i]?.amount ?? NaN) * 100));
  }
  const fa = readField(a, key);
  const fb = readField(b, key);
  if (!fa || !fb) return false;
  if (typeof fa.value === "number" || typeof fb.value === "number") {
    if (fa.value == null || fb.value == null) return fa.value === fb.value;
    return Math.round(Number(fa.value) * 100) === Math.round(Number(fb.value) * 100);
  }
  return normalizeText(fa.value) === normalizeText(fb.value);
}

/**
 * Citas textuales de cada campo (lectura A y B, sin repetir), para subrayarlas en la hoja.
 * Se ignoran las de menos de 3 caracteres: marcarían medio documento.
 */
export function fieldEvidence(reading: ReadingAssessment | null | undefined): Partial<Record<FieldKey, string[]>> {
  const out: Partial<Record<FieldKey, string[]>> = {};
  const readers = [extractionOf(reading?.primary), extractionOf(reading?.secondary)];
  for (const row of FIELD_ROWS) {
    const quotes = new Set<string>();
    for (const e of readers) {
      if (!e) continue;
      if (row.key === "lineItems") {
        for (const item of readLines(e)?.items ?? []) if (item.description?.trim().length >= 3) quotes.add(item.description.trim());
        continue;
      }
      const ev = readField(e, row.key)?.evidence?.trim();
      if (ev && ev.length >= 3) quotes.add(ev);
    }
    if (quotes.size > 0) out[row.key] = [...quotes];
  }
  return out;
}
