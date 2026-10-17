/**
 * Formato local de montos, cantidades y fechas tal como aparecen en los documentos.
 * Implementado a mano (sin Intl) para que el resultado no dependa de la versión de ICU.
 */
import type { Locale } from "./spec";

interface Separators {
  group: string;
  decimal: string;
}

const SEPARATORS: Record<Locale, Separators> = {
  "es-CO": { group: ".", decimal: "," },
  "es-MX": { group: ",", decimal: "." },
  "es-PE": { group: ",", decimal: "." },
  "es-CL": { group: ".", decimal: "," },
  "es-AR": { group: ".", decimal: "," },
  "pt-BR": { group: ".", decimal: "," },
  "en-US": { group: ",", decimal: "." },
};

/** 1234567.5 → "1.234.567,50" (según el idioma). */
export function formatNumber(value: number, locale: Locale, decimals: number): string {
  const { group, decimal } = SEPARATORS[locale];
  const negative = value < 0;
  const fixed = Math.abs(value).toFixed(decimals);
  const [intPart, frac] = fixed.split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, group);
  return `${negative ? "-" : ""}${grouped}${frac ? decimal + frac : ""}`;
}

/** Decimales con que se muestra cada moneda (el peso colombiano va sin centavos). */
export function currencyDecimals(currency: string): number {
  return currency === "COP" || currency === "CLP" ? 0 : 2;
}

/**
 * Monto con el formato local del documento:
 * COP 12.000.000 · R$ 9.500,00 · $36,000.00 MXN · S/ 6,000.00 · USD 4.500,00 · $1,200.00 (en-US).
 */
export function formatMoney(amount: number, currency: string, locale: Locale): string {
  const n = formatNumber(amount, locale, currencyDecimals(currency));
  switch (currency) {
    case "BRL":
      return `R$ ${n}`;
    case "MXN":
      return `$${n} MXN`;
    case "PEN":
      return `S/ ${n}`;
    case "USD":
      return locale === "en-US" ? `$${n}` : `USD ${n}`;
    default:
      return `${currency} ${n}`;
  }
}

/** Cantidad con unidad opcional: 40 → "40 h"; 1 → "1". */
export function formatQuantity(quantity: number, unit: string | null, locale: Locale): string {
  const decimals = Number.isInteger(quantity) ? 0 : 2;
  const n = formatNumber(quantity, locale, decimals);
  return unit ? `${n} ${unit}` : n;
}

const MONTHS: Record<"es" | "pt" | "en", string[]> = {
  es: ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"],
  pt: ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"],
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
};

function lang(locale: Locale): "es" | "pt" | "en" {
  return locale.startsWith("pt") ? "pt" : locale.startsWith("en") ? "en" : "es";
}

function parts(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d: d ?? 1 };
}

const pad2 = (n: number) => String(n).padStart(2, "0");

export type DateStyle = "short" | "medium" | "long";

/**
 * short: 03/10/2026 (en-US: 10/03/2026) · medium: 3 oct. 2026 / Oct 3, 2026 ·
 * long: 3 de octubre de 2026 / October 3, 2026.
 */
export function formatDate(iso: string, locale: Locale, style: DateStyle): string {
  const { y, m, d } = parts(iso);
  const l = lang(locale);
  const month = MONTHS[l][m - 1];
  if (style === "short") return l === "en" ? `${pad2(m)}/${pad2(d)}/${y}` : `${pad2(d)}/${pad2(m)}/${y}`;
  if (style === "medium") {
    if (l === "en") return `${month.slice(0, 3)} ${d}, ${y}`;
    return `${d} ${month.slice(0, 3)}. ${y}`;
  }
  if (l === "en") return `${month} ${d}, ${y}`;
  return `${d} de ${month} de ${y}`;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Periodo YYYY-MM: "Octubre 2026" · "Outubro/2026" · "October 2026";
 * range (solo en): "Oct 1 – Oct 31, 2026".
 */
export function formatPeriod(period: string, locale: Locale, style: "title" | "long" | "range" = "title"): string {
  const { y, m } = parts(`${period}-01`);
  const l = lang(locale);
  const month = MONTHS[l][m - 1];
  if (style === "range") {
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    if (l === "en") return `${month.slice(0, 3)} ${1} – ${month.slice(0, 3)} ${last}, ${y}`;
    return `1 al ${last} de ${month} de ${y}`;
  }
  if (l === "pt") return `${capitalize(month)}/${y}`;
  if (style === "long") return l === "en" ? `${month} ${y}` : `${month} de ${y}`;
  return `${capitalize(month)} ${y}`;
}

// ───────────────────────── Monto en letras (cuentas de cobro) ─────────────────────────

const UNITS = ["", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve"];
const TEENS = ["diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve"];
const TWENTIES = [
  "veinte", "veintiuno", "veintidós", "veintitrés", "veinticuatro",
  "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve",
];
const TENS = ["", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
const HUNDREDS = [
  "", "ciento", "doscientos", "trescientos", "cuatrocientos",
  "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos",
];

function below100(n: number): string {
  if (n < 10) return UNITS[n];
  if (n < 20) return TEENS[n - 10];
  if (n < 30) return TWENTIES[n - 20];
  const t = Math.floor(n / 10);
  const u = n % 10;
  return u === 0 ? TENS[t] : `${TENS[t]} y ${UNITS[u]}`;
}

function below1000(n: number): string {
  if (n === 100) return "cien";
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return [HUNDREDS[h], below100(rest)].filter(Boolean).join(" ");
}

/** "uno" → "un" delante de mil/millones ("veintiuno" → "veintiún"). */
function apocope(words: string): string {
  return words.replace(/veintiuno$/, "veintiún").replace(/uno$/, "un");
}

/** Entero en palabras, en español: 12000000 → "doce millones". */
export function spanishNumberWords(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n >= 1e12) throw new Error(`Fuera de rango: ${n}`);
  if (n === 0) return "cero";
  const millions = Math.floor(n / 1e6);
  const thousands = Math.floor((n % 1e6) / 1000);
  const rest = n % 1000;
  const out: string[] = [];
  if (millions > 0) {
    if (millions === 1) out.push("un millón");
    else out.push(`${apocope(spanishNumberWords(millions))} millones`);
  }
  if (thousands > 0) out.push(thousands === 1 ? "mil" : `${apocope(below1000(thousands))} mil`);
  if (rest > 0) out.push(below1000(rest));
  return out.join(" ");
}

/** Monto en pesos colombianos en letras: "DOCE MILLONES DE PESOS M/CTE". */
export function copAmountInWords(amount: number): string {
  const n = Math.round(amount);
  const words = spanishNumberWords(n);
  const exactMillions = n >= 1e6 && n % 1e6 === 0;
  return `${words}${exactMillions ? " de" : ""} pesos m/cte`.toUpperCase();
}

/**
 * Monto en letras con la fórmula habitual de cada moneda:
 * COP "DOCE MILLONES DE PESOS M/CTE" · USD "DOS MIL CUATROCIENTOS DÓLARES ESTADOUNIDENSES CON 00/100" ·
 * PEN "SEIS MIL CON 00/100 SOLES" · MXN "TREINTA Y SEIS MIL PESOS 00/100 M.N." ·
 * BRL "NUEVE MIL QUINIENTOS REALES CON 00/100".
 */
export function amountInWords(amount: number, currency: string): string | null {
  if (currency === "COP") return copAmountInWords(amount);
  // Se parte de los centavos redondeados (como formatMoney): 1,999 → 2,00 y no «1 con 100/100».
  const totalCents = Math.round(amount * 100);
  const units = Math.floor(totalCents / 100);
  const cents = String(totalCents % 100).padStart(2, "0");
  const words = spanishNumberWords(units);
  const noun = apocope(words);
  const de = units >= 1e6 && units % 1e6 === 0 ? " de" : "";
  let out: string;
  switch (currency) {
    case "USD":
      out = `${noun}${de} ${units === 1 ? "dólar estadounidense" : "dólares estadounidenses"} con ${cents}/100`;
      break;
    case "PEN":
      out = `${words} con ${cents}/100 ${units === 1 ? "sol" : "soles"}`;
      break;
    case "MXN":
      out = `${noun}${de} ${units === 1 ? "peso" : "pesos"} ${cents}/100 m.n.`;
      break;
    case "BRL":
      out = `${noun}${de} ${units === 1 ? "real" : "reales"} con ${cents}/100`;
      break;
    default:
      return null;
  }
  return out.toUpperCase();
}

// ───────────────────────── Lectura de montos (para pruebas) ─────────────────────────

/**
 * Último monto que aparece en un texto, interpretando el formato local:
 * "COP 12.000.000" → 12000000 · "R$ 9.500,00" → 9500 · "$36,000.00 MXN" → 36000 · "USD 2.800" → 2800.
 */
export function parseLastAmount(text: string): number | null {
  const tokens = text.match(/\d[\d.,]*\d|\d/g);
  if (!tokens) return null;
  const token = tokens[tokens.length - 1];
  const lastDot = token.lastIndexOf(".");
  const lastComma = token.lastIndexOf(",");
  let decimalSep: "." | "," | null = null;
  if (lastDot >= 0 && lastComma >= 0) decimalSep = lastDot > lastComma ? "." : ",";
  else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? "." : ",";
    const count = token.split(sep).length - 1;
    const after = token.length - token.lastIndexOf(sep) - 1;
    decimalSep = count === 1 && after !== 3 ? sep : null;
  }
  let normalized = token;
  if (decimalSep) {
    const groupSep = decimalSep === "." ? "," : ".";
    normalized = token.split(groupSep).join("").replace(decimalSep, ".");
  } else {
    normalized = token.replace(/[.,]/g, "");
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}
