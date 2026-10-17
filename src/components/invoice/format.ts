/**
 * Formatos de la pantalla de detalle. Funciones puras: sirven en servidor y cliente y dan siempre
 * el mismo texto (fechas en UTC, sin depender de la zona del navegador, para no romper la hidratación).
 */
import type { Agreement, DecisionRecord, ReaderResult } from "@/core/schemas";

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

const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"] as const;

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
const YM = /^(\d{4})-(\d{2})$/;

/** "2026-10-09" → "9 de octubre de 2026". Devuelve el texto tal cual si no es una fecha. */
export function formatDateLong(value: string | null | undefined): string {
  if (!value) return "—";
  const m = YMD.exec(value.trim());
  if (!m) return value;
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return value;
  return `${Number(m[3])} de ${month} de ${m[1]}`;
}

/** "2026-10-09" → "9 oct 2026" (para tablas). */
export function formatDateShort(value: string | null | undefined): string {
  if (!value) return "—";
  const m = YMD.exec(value.trim());
  if (!m) return value;
  const month = MONTHS_SHORT[Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month} ${m[1]}` : value;
}

/** "2026-10" → "octubre de 2026". */
export function formatPeriod(value: string | null | undefined): string {
  if (!value) return "—";
  const m = YM.exec(value.trim());
  if (!m) return value;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} de ${m[1]}` : value;
}

/** ISO 8601 → "17 oct 2026 · 06:58 UTC". */
export function formatDateTimeUtc(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()} · ${hh}:${mm} UTC`;
}

/** ISO 8601 → "2026-10-17 06:58:37 UTC" (para la traza). */
export function formatStampUtc(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

/**
 * Fecha de un correo tal como se escribió, sin convertir de zona:
 * "2026-10-07T09:14:22-03:00" → "7 oct 2026 · 09:14 (UTC−03:00)".
 */
export function formatEmailDate(value: string | null | undefined): string {
  if (!value) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(value.trim());
  if (!m) return value;
  const month = MONTHS_SHORT[Number(m[2]) - 1] ?? m[2];
  const zone = !m[6] ? "" : m[6] === "Z" ? " (UTC)" : ` (UTC${m[6].replace("-", "−")})`;
  return `${Number(m[3])} ${month} ${m[1]} · ${m[4]}:${m[5]}${zone}`;
}

const number = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 6 });
const integer = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });

/** 0.055 → "0,055"; 120 → "120". */
export function formatNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return number.format(value);
}

export function formatInteger(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return integer.format(value);
}

/** Primeros caracteres de una huella sha256. */
export function shortHash(hash: string | null | undefined, length = 12): string {
  if (!hash) return "—";
  return hash.slice(0, length);
}

export const READING_MODE_TEXT: Record<DecisionRecord["readingMode"], { label: string; help: string }> = {
  live: { label: "Lectura real", help: "Dos modelos leyeron la factura por separado." },
  cache: { label: "Lectura guardada", help: "Se usaron lecturas reales guardadas antes para este mismo archivo." },
  simulated: {
    label: "Lectura simulada",
    help: "Sin clave de API: se usó la lectura de referencia del set de ejemplo. Prueba las reglas, no la calidad de lectura.",
  },
};

export const AGREEMENT_KIND_LABEL: Record<Agreement["kind"], string> = {
  fixed_recurring: "Monto fijo mensual",
  hourly: "Por hora",
  one_off: "Cotización puntual",
};

/** Etiqueta del error de un lector, en español. */
export const READER_ERROR_LABEL: Record<Extract<ReaderResult, { ok: false }>["error"], string> = {
  refusal: "el modelo se negó a leer",
  api_error: "error de la API",
  parse_error: "respuesta no válida",
  unavailable: "lector no disponible",
};

/** "Lecturas: 2 de 2 coinciden." y variantes. */
export function readingsLine(record: DecisionRecord): { text: string; tone: "ok" | "warn" } {
  const { primary, secondary, signals } = record.reading;
  const disagree = signals.readersDisagreeOn.filter((f) => f !== "segunda_lectura_no_disponible");
  if (!primary.ok) return { text: "Lecturas: la lectura principal falló.", tone: "warn" };
  if (!secondary || !secondary.ok) return { text: "Lecturas: 1 de 2. La segunda lectura no está disponible.", tone: "warn" };
  if (disagree.length > 0) {
    return {
      text: `Lecturas: 2 de 2, no coinciden en ${disagree.map((f) => FIELD_NAME[f] ?? f).join(", ")}.`,
      tone: "warn",
    };
  }
  return { text: "Lecturas: 2 de 2 coinciden.", tone: "ok" };
}

/** Nombre corto en minúscula de un campo (para frases). */
export const FIELD_NAME: Record<string, string> = {
  vendorName: "proveedor",
  vendorTaxId: "identificación tributaria",
  invoiceNumber: "número",
  issueDate: "fecha de emisión",
  dueDate: "vencimiento",
  servicePeriod: "periodo",
  currency: "moneda",
  subtotal: "subtotal",
  tax: "impuestos",
  total: "total",
  beneficiaryName: "beneficiario",
  bankName: "banco",
  accountNumber: "cuenta destino",
  routingOrSwift: "SWIFT o ruta",
  lineItems: "líneas",
  periodo: "periodo",
};

/** Nombre de archivo seguro para descargas. */
export function safeFilename(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "decision";
}
