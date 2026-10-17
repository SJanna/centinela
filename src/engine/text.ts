/**
 * Plantillas y formatos para los textos que ve el usuario (explicaciones, resumen, acción humana).
 * Todo determinista: nada de fechas actuales ni configuración regional del sistema.
 */
import { formatMoney, normalizeAccount } from "../core/normalize";

const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;

/** "2026-06-30" → "30 de junio de 2026". Si no es una fecha ISO válida, la devuelve tal cual. */
export function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return iso;
  return `${Number(m[3])} de ${MONTHS[month - 1]} de ${m[1]}`;
}

/** "2026-10" → "octubre de 2026". */
export function formatPeriod(period: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(period);
  if (!m) return period;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return period;
  return `${MONTHS[month - 1]} de ${m[1]}`;
}

const NUMBER = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 });

/** 37.5 → "37,5". */
export function formatNumber(n: number): string {
  return NUMBER.format(n);
}

/** Centavos de USD → "USD 1.234,56". */
export function formatUsdCents(cents: number): string {
  return formatMoney(cents / 100, "USD");
}

/** Monto en su moneda → "COP 12.000.000,00". */
export function money(amount: number, currency: string): string {
  return formatMoney(amount, currency);
}

/** Porcentaje legible: 1.5 → "1,5 %". */
export function formatPct(pct: number): string {
  return `${formatNumber(pct)} %`;
}

/** ["a", "b", "c"] → "a, b y c". */
export function listEs(items: readonly string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

/** Recorta un texto a `max` caracteres (sin contar el «…» final) y compacta espacios. */
export function truncate(text: string, max = 120): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max).trimEnd()}…`;
}

/** Últimos 4 caracteres de una cuenta normalizada (nunca se muestra la cuenta completa). */
export function lastDigits(account: string | null | undefined): string {
  const n = normalizeAccount(account);
  if (n == null) return "—";
  return n.slice(-4);
}

/** Pone en minúscula la primera letra, salvo que sea una sigla ("USD", "LEC-1"). */
export function lowerFirst(text: string): string {
  if (text.length < 2) return text.toLowerCase();
  const [a, b] = [text[0], text[1]];
  if (a !== a.toLowerCase() && b === b.toLowerCase() && b !== b.toUpperCase()) {
    return a.toLowerCase() + text.slice(1);
  }
  return text;
}

/** Quita el punto final para poder encadenar frases. */
export function stripFinalPeriod(text: string): string {
  return text.replace(/[.\s]+$/, "");
}

const FIELD_LABELS: Record<string, string> = {
  documentType: "tipo de documento",
  vendorName: "nombre del proveedor",
  vendorTaxId: "identificación tributaria",
  invoiceNumber: "número de factura",
  issueDate: "fecha de emisión",
  dueDate: "fecha de vencimiento",
  servicePeriod: "periodo facturado",
  currency: "moneda",
  subtotal: "subtotal",
  tax: "impuestos",
  total: "total",
  lineItems: "líneas de detalle",
  beneficiaryName: "beneficiario",
  bankName: "banco",
  accountNumber: "cuenta destino",
  routingOrSwift: "código SWIFT o de ruta",
  segunda_lectura_no_disponible: "segunda lectura no disponible",
};

/** Nombre de campo (p. ej. "accountNumber" o "payment.accountNumber") → etiqueta en español. */
export function fieldLabel(field: string): string {
  const key = field.includes(".") ? field.slice(field.lastIndexOf(".") + 1) : field;
  return FIELD_LABELS[key] ?? field;
}

/** Quita repetidos conservando el orden. */
export function unique<T>(items: readonly T[]): T[] {
  return Array.from(new Set(items));
}
