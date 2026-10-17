/**
 * Formatos de las pantallas de configuración (reglas, proveedores, registro).
 * Sin "use client" ni E/S: lo usan el servidor y el cliente, y produce lo mismo en los dos
 * (meses escritos a mano y zona horaria fija, para no romper la hidratación).
 */
import type { Agreement, DecisionRecord, Vendor } from "@/core/schemas";

// ───────────────────────── Números ─────────────────────────

const numberFormatters = new Map<string, Intl.NumberFormat>();

function numberFormatter(min: number, max: number): Intl.NumberFormat {
  const key = `${min}:${max}`;
  let f = numberFormatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat("es-CO", { minimumFractionDigits: min, maximumFractionDigits: max });
    numberFormatters.set(key, f);
  }
  return f;
}

/** Número en formato es-CO, sin decimales forzados: 12000000 → "12.000.000"; 0.00025 → "0,00025". */
export function formatNumber(value: number, maxFractionDigits = 2): string {
  return numberFormatter(0, maxFractionDigits).format(value);
}

/** Monto con su código delante y sin decimales forzados: "COP 12.000.000". */
export function formatAmount(value: number, currency: string): string {
  return `${currency.toUpperCase()} ${formatNumber(value)}`;
}

/** Monto con dos decimales: "USD 3.000,00" (como las explicaciones del motor). */
export function formatAmountExact(value: number, currency: string): string {
  return `${currency.toUpperCase()} ${numberFormatter(2, 2).format(value)}`;
}

/**
 * Lee un número escrito por una persona en formato es-CO.
 * - Con coma: la coma es el decimal y los puntos son miles ("1.234,5" → 1234.5).
 * - Sin coma y con `grouping`: "5.000" o "1.000.000" son miles; "1.5" es decimal.
 * - Sin coma y sin `grouping`: el punto es decimal ("0.055" → 0.055).
 * Devuelve null si está vacío o no es un número.
 */
export function parseDecimal(raw: string, { grouping = true }: { grouping?: boolean } = {}): number | null {
  const s = raw.replace(/[\s ]/g, "").replace(/^(USD|\$)/i, "").replace(/%$/, "");
  if (s === "") return null;
  if (!/^-?[\d.,]+$/.test(s)) return null;
  let normalized: string;
  if (s.includes(",")) {
    if ((s.match(/,/g) ?? []).length > 1) return null;
    normalized = s.replace(/\./g, "").replace(",", ".");
  } else if (grouping && /^-?\d{1,3}(\.\d{3})+$/.test(s)) {
    normalized = s.replace(/\./g, "");
  } else {
    if ((s.match(/\./g) ?? []).length > 1) return null;
    normalized = s;
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

// ───────────────────────── Fechas ─────────────────────────

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"] as const;

/** Zona con que se muestran las horas del registro (la empresa de la demo opera en Bogotá). */
export const DISPLAY_TIME_ZONE = "America/Bogota";

/** "2026-10-01" → "1 oct 2026". Devuelve el texto tal cual si no es una fecha. */
export function formatDate(isoDate: string | null | undefined): string {
  if (!isoDate) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!m) return isoDate;
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return isoDate;
  return `${Number(m[3])} ${month} ${m[1]}`;
}

/** "2026-10" → "oct 2026". */
export function formatMonth(period: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(period);
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined;
  return m && month ? `${month} ${m[1]}` : period;
}

const dateTimeParts = new Intl.DateTimeFormat("en-US", {
  timeZone: DISPLAY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Fecha y hora de una decisión en la zona de la empresa: { date: "17 oct 2026", time: "01:58" }. */
export function formatDateTime(iso: string): { date: string; time: string; day: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: iso, time: "", day: iso.slice(0, 10) };
  const parts = Object.fromEntries(dateTimeParts.formatToParts(d).map((p) => [p.type, p.value]));
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  return { date: formatDate(day), time: `${parts.hour}:${parts.minute}`, day };
}

/** Fecha de hoy (YYYY-MM-DD) en la zona de la empresa. */
export function todayIso(now: Date = new Date()): string {
  return formatDateTime(now.toISOString()).day;
}

// ───────────────────────── Monedas y países ─────────────────────────

/** País de la bandera de cada moneda (EUR y otras no tienen: muestran el globo). */
export const CURRENCY_COUNTRY: Record<string, string> = {
  USD: "US",
  COP: "CO",
  MXN: "MX",
  BRL: "BR",
  PEN: "PE",
  ARS: "AR",
  CLP: "CL",
};

export const CURRENCY_NAME: Record<string, string> = {
  USD: "Dólar estadounidense",
  COP: "Peso colombiano",
  MXN: "Peso mexicano",
  BRL: "Real brasileño",
  PEN: "Sol peruano",
  ARS: "Peso argentino",
  CLP: "Peso chileno",
  EUR: "Euro",
  UYU: "Peso uruguayo",
  BOB: "Boliviano",
  PYG: "Guaraní",
  GTQ: "Quetzal",
  CRC: "Colón costarricense",
  DOP: "Peso dominicano",
  CAD: "Dólar canadiense",
  GBP: "Libra esterlina",
};

// ───────────────────────── Acuerdos ─────────────────────────

export const AGREEMENT_KIND_LABEL: Record<Agreement["kind"], string> = {
  fixed_recurring: "Fijo mensual",
  hourly: "Por hora",
  one_off: "Cotización única",
};

/** Resumen de un acuerdo en una línea: "COP 12.000.000 / mes" · "MXN 900 / h · máx 120 h" · "USD 4.500 · único". */
export function agreementSummary(a: Agreement): string {
  const cur = a.currency.toUpperCase();
  if (a.kind === "hourly") {
    const rate = a.rate != null ? `${cur} ${formatNumber(a.rate)} / h` : `${cur} — / h`;
    return a.maxQuantity != null ? `${rate} · máx ${formatNumber(a.maxQuantity)} h` : rate;
  }
  const amount = a.amount != null ? `${cur} ${formatNumber(a.amount)}` : `${cur} —`;
  if (a.kind === "one_off" || a.frequency === "once") return `${amount} · único`;
  return `${amount} / mes`;
}

/**
 * Qué paga Centinela con este acuerdo, en una frase (ACU-3 y DUP-3):
 * "Paga facturas de COP 12.000.000 (± 1 %), una por mes." · "Paga horas × MXN 900, hasta 120 h, una factura por mes."
 */
export function agreementRule(a: Agreement, tolerancePct: number): string {
  const cur = a.currency.toUpperCase();
  const tol = `± ${formatNumber(tolerancePct, 4)} %`;
  const once = a.kind === "one_off" || a.frequency === "once";
  if (a.kind === "hourly") {
    const rate = a.rate != null ? `${cur} ${formatNumber(a.rate)}` : "la tarifa pactada";
    const max = a.maxQuantity != null ? `, hasta ${formatNumber(a.maxQuantity)} h${once ? " en total" : " al mes"}` : "";
    return `Paga horas × ${rate}${max}, ${once ? "en una sola factura" : "una factura por mes"}.`;
  }
  const amount = a.amount != null ? `${cur} ${formatNumber(a.amount)}` : "el monto pactado";
  if (once) return `Paga una sola factura de ${amount} (${tol}).`;
  return `Paga facturas de ${amount} (${tol}), una por mes.`;
}

export type AgreementState = "active" | "upcoming" | "expired";

/** Estado de un acuerdo en una fecha (YYYY-MM-DD). Compara como texto: el formato ISO lo permite. */
export function agreementState(a: Agreement, today: string): AgreementState {
  if (a.validFrom && a.validFrom > today) return "upcoming";
  if (a.validTo && a.validTo < today) return "expired";
  return "active";
}

/** Vigencia en palabras: "Desde 1 ene 2026" · "1 oct – 31 dic 2026" · "Venció el 30 jun 2026". */
export function validityText(a: Agreement, today: string): string {
  const state = agreementState(a, today);
  if (state === "expired") return `Venció el ${formatDate(a.validTo)}`;
  if (state === "upcoming") return `Empieza el ${formatDate(a.validFrom)}`;
  if (!a.validTo) return `Desde ${formatDate(a.validFrom)}`;
  return `${formatDate(a.validFrom)} – ${formatDate(a.validTo)}`;
}

/** Vigencia del proveedor: el mejor estado entre sus acuerdos (uno vigente basta). */
export function vendorValidity(v: Vendor, today: string): { state: AgreementState | "none"; text: string } {
  if (v.agreements.length === 0) return { state: "none", text: "Sin acuerdos" };
  const active = v.agreements.filter((a) => agreementState(a, today) === "active");
  if (active.length > 0) {
    const open = active.find((a) => !a.validTo);
    if (open) return { state: "active", text: `Desde ${formatDate(open.validFrom)}` };
    const latest = [...active].sort((x, y) => (y.validTo ?? "").localeCompare(x.validTo ?? ""))[0];
    return { state: "active", text: `Hasta ${formatDate(latest.validTo)}` };
  }
  const upcoming = v.agreements.filter((a) => agreementState(a, today) === "upcoming");
  if (upcoming.length > 0) {
    const first = [...upcoming].sort((x, y) => x.validFrom.localeCompare(y.validFrom))[0];
    return { state: "upcoming", text: `Desde ${formatDate(first.validFrom)}` };
  }
  const last = [...v.agreements].sort((x, y) => (y.validTo ?? "").localeCompare(x.validTo ?? ""))[0];
  return { state: "expired", text: `Venció ${formatDate(last.validTo)}` };
}

// ───────────────────────── Registro ─────────────────────────

export const READING_MODE_SHORT: Record<DecisionRecord["readingMode"], string> = {
  live: "Real",
  cache: "Caché",
  simulated: "Simulada",
};

export const READING_MODE_HELP: Record<DecisionRecord["readingMode"], string> = {
  live: "Dos modelos leyeron la factura por separado.",
  cache: "Lectura real guardada antes para este mismo archivo.",
  simulated: "Lectura de referencia del set de ejemplo. Sirve para probar las reglas.",
};
