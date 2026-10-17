/**
 * Normalización propia de la guardia.
 *
 * NO reutiliza `src/core/normalize` ni nada del motor a propósito: la guardia es una segunda
 * implementación independiente de las reglas duras. Si una de las dos tiene un error, la otra
 * lo detecta. Por eso aquí todo es más estricto: ante un valor raro se devuelve `null` y la
 * guardia no aprueba.
 */

// ───────────────────────── Texto ─────────────────────────

/** Separadores que se pueden quitar de cuentas, ids y números sin cambiar su significado. */
const SEPARATOR_CHARS = /[\s\-‐-―.\/_]/g;

/** Quita tildes y diacríticos ("Ñ" → "N", "é" → "e"). */
function stripDiacritics(raw: string): string {
  return raw.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// ───────────────────────── Cuentas bancarias ─────────────────────────

/**
 * Cuenta bancaria: mayúsculas sin separadores. Estricta: si queda cualquier carácter que no sea
 * letra o dígito ASCII (p. ej. un dígito de ancho completo o un carácter invisible), devuelve
 * null en vez de descartarlo en silencio. "4512-0098 7731" → "451200987731".
 */
export function guardAccount(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const compact = raw.toUpperCase().replace(SEPARATOR_CHARS, "");
  return /^[A-Z0-9]+$/.test(compact) ? compact : null;
}

// ───────────────────────── Identificación tributaria ─────────────────────────

export interface TaxId {
  /** Todas las letras y dígitos, en mayúscula: "901.456.789-1" → "9014567891". */
  full: string;
  /**
   * El número sin el dígito de verificación cuando este viene separado por guion al final
   * (1 o 2 caracteres): "901.456.789-1" → "901456789", "12.345.678/0001-90" → "123456780001".
   * null si no hay dígito de verificación separado ("88-1234567" no lo tiene: el último tramo es largo).
   */
  base: string | null;
}

/**
 * Id tributario de la guardia. Misma semántica de comparación que la decisión del equipo
 * (`taxIdsEquivalent` del núcleo, que la guardia no importa): solo cuentan letras ASCII y dígitos
 * en mayúscula, sin quitar etiquetas («NIT 900…» no es «900…») ni convertir letras con tilde. Más
 * estricta en la forma: si además de letras, dígitos y separadores (espacios, guiones, puntos,
 * barras, guion bajo) queda cualquier otro carácter, devuelve null y la guardia no aprueba.
 */
export function guardTaxId(raw: string | null | undefined): TaxId | null {
  if (typeof raw !== "string") return null;
  const upper = raw.toUpperCase().trim();
  const full = upper.replace(SEPARATOR_CHARS, "");
  if (!/^[A-Z0-9]+$/.test(full)) return null;
  const dv = /^(.*[A-Z0-9])\s*[-‐-―]\s*([A-Z0-9]{1,2})$/.exec(upper);
  let base: string | null = null;
  if (dv) {
    const b = dv[1].replace(SEPARATOR_CHARS, "");
    base = /^[A-Z0-9]+$/.test(b) && b.length > 0 ? b : null;
  }
  return { full, base };
}

/**
 * Dos ids tributarios son el mismo si coinciden completos, o si uno de los dos trae el dígito de
 * verificación separado y el otro (que NO lo trae) es exactamente el número sin ese dígito. Si
 * ambos traen dígito de verificación separado, solo cuentan completos: "9014567891-2" no es
 * "901.456.789-1" aunque la base del primero sea el número completo del segundo.
 */
export function sameTaxId(a: TaxId, b: TaxId): boolean {
  if (a.full === b.full) return true;
  if (a.base !== null && b.base === null && a.base === b.full) return true;
  if (b.base !== null && a.base === null && b.base === a.full) return true;
  return false;
}

// ───────────────────────── Nombres de proveedor ─────────────────────────

/**
 * Formas societarias que se ignoran al final del nombre, escritas sin espacios ni puntos
 * ("S. de R.L." → "sderl"). Lista corta a propósito: quitar de más haría que nombres distintos
 * se parezcan.
 */
const CORPORATE_SUFFIXES = new Set([
  "sas", "sa", "sac", "saa", "sadecv", "sapi", "sapidecv", "sderl", "sderlcv", "srl", "sl", "slu",
  "ltda", "ltd", "llc", "inc", "corp", "spa", "eireli", "eirl", "gmbh", "plc",
]);

/**
 * Clave de comparación de un nombre: sin tildes, minúsculas, sin puntuación, sin forma societaria
 * final y sin espacios. "Camila Restrepo Dev S.A.S." → "camilarestrepodev".
 */
export function guardNameKey(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = stripDiacritics(raw)
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const tokens = cleaned.length > 0 ? cleaned.split(" ") : [];
  let changed = true;
  while (changed && tokens.length > 1) {
    changed = false;
    for (let k = Math.min(6, tokens.length - 1); k >= 1; k--) {
      if (CORPORATE_SUFFIXES.has(tokens.slice(-k).join(""))) {
        tokens.splice(tokens.length - k, k);
        changed = true;
        break;
      }
    }
  }
  const key = tokens.join("");
  return key.length > 0 ? key : null;
}

// ───────────────────────── Números de factura ─────────────────────────

/**
 * Clave de un número de factura para detectar duplicados. Generosa a propósito (detectar de más
 * solo hace que se frene o escale, nunca que se pague de más): sin tildes, mayúsculas, sin
 * separadores y sin ceros a la izquierda en cada tramo numérico. "FE-0012" y "fe 12" → "FE12".
 * Dígitos y letras de ancho completo cuentan como los normales: "FE-１２" → "FE12".
 */
export function guardInvoiceKey(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const halfWidth = raw.replace(/[\uff01-\uff5e]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  const segments = stripDiacritics(halfWidth).toUpperCase().split(/[^A-Z0-9]+/).filter((s) => s.length > 0);
  const key = segments.map((s) => s.replace(/\d+/g, (run) => run.replace(/^0+(?=\d)/, ""))).join("");
  return key.length > 0 ? key : null;
}

// ───────────────────────── Moneda ─────────────────────────

/** Código ISO 4217: tres letras mayúsculas. " cop " → "COP"; cualquier otra cosa → null. */
export function guardCurrency(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(v) ? v : null;
}

// ───────────────────────── Dinero en centavos ─────────────────────────

/** Por encima de esto los centavos dejan de ser enteros exactos en coma flotante. */
const MAX_CENTS = Number.MAX_SAFE_INTEGER;

/**
 * Redondea al entero más cercano (mitades lejos de cero), limpiando antes el ruido de coma
 * flotante: 250.49999999999997 se trata como 250.5 → 251.
 */
export function roundHalfAwayFromZero(x: number): number {
  const cleaned = Number(x.toPrecision(15));
  const r = Math.round(Math.abs(cleaned));
  if (r === 0) return 0;
  return cleaned < 0 ? -r : r;
}

/** Monto → centavos enteros. null si no es un número finito o es demasiado grande. */
export function guardCents(amount: number | null | undefined): number | null {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return null;
  const scaled = amount * 100;
  if (Math.abs(scaled) > MAX_CENTS) return null;
  return roundHalfAwayFromZero(scaled);
}

/**
 * Monto de una entrada del historial → centavos. Además de números acepta texto decimal estricto
 * ("3000.00"), porque las columnas numéricas de Postgres suelen llegar como texto; cualquier otra
 * cosa → null (y la guardia no aprueba).
 */
export function guardStoredCents(amount: unknown): number | null {
  if (typeof amount === "number") return guardCents(amount);
  if (typeof amount === "string" && /^\s*-?\d+(?:\.\d+)?\s*$/.test(amount)) return guardCents(Number(amount));
  return null;
}

/** Centavos de USD de un monto en centavos de otra moneda: totalCents × tasa, redondeado. */
export function convertCents(cents: number, fxToUsd: number): number | null {
  const v = roundHalfAwayFromZero(cents * fxToUsd);
  return Number.isSafeInteger(v) ? v : null;
}

/** ¿|actual − pactado| ≤ pactado × tolerancia %? Todo en centavos enteros. */
export function withinTolerance(actualCents: number, agreedCents: number, tolerancePct: number): boolean {
  const diffTimes100 = Math.abs(actualCents - agreedCents) * 100;
  const allowedTimes100 = Number((agreedCents * tolerancePct).toPrecision(15));
  return diffTimes100 <= allowedTimes100;
}

/** Centavos → "USD 4.800,00" (formato propio, sin Intl, para que sea idéntico en todo entorno). */
export function formatCents(cents: number, currency: string): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const units = Math.floor(abs / 100);
  const rest = abs - units * 100;
  const unitsText = String(units).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const restText = String(rest).padStart(2, "0");
  return `${currency} ${negative ? "-" : ""}${unitsText},${restText}`;
}

/** Cantidad para textos: 40 → "40", 37.5 → "37,5". */
export function formatQuantity(q: number): string {
  const cleaned = Number(q.toPrecision(12));
  return String(cleaned).replace(".", ",");
}

// ───────────────────────── Fechas y periodos ─────────────────────────

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function validDay(y: string, m: string, d: string): string | null {
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return `${y}-${m}-${d}`;
}

/** Fecha "YYYY-MM-DD" válida de calendario. Cualquier otro formato → null. */
export function guardDate(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  return m ? validDay(m[1], m[2], m[3]) : null;
}

const INSTANT = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s?(Z|[+-]\d{2}(?::?\d{2})?)?)?$/;
const OFFSET = /^([+-])(\d{2}):?(\d{2})?$/;

/**
 * Días calendario a los que puede pertenecer un instante ISO 8601. El primero es siempre el día tal
 * como está escrito ("2026-10-31T19:15:00-05:00" → "2026-10-31"); si el instante trae zona horaria
 * y en UTC cae en otro día, se agrega ese día ("2026-11-01"). Así, quien compara meses puede contar
 * un pago en cualquiera de los dos y no depender de que todo el sistema escriba la misma zona.
 * Acepta solo fecha, o fecha con hora válida y zona opcional (Z, +00, +0000, +00:00; también el
 * formato de texto de Postgres con espacio). Un `Date` válido se toma en UTC. Otra forma → null.
 */
export function guardInstantDays(raw: string | Date | null | undefined): string[] | null {
  if (raw instanceof Date) {
    return Number.isFinite(raw.getTime()) ? [raw.toISOString().slice(0, 10)] : null;
  }
  if (typeof raw !== "string") return null;
  const m = INSTANT.exec(raw.trim());
  if (!m) return null;
  const written = validDay(m[1], m[2], m[3]);
  if (written === null) return null;
  if (m[4] === undefined) return [written];
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = m[6] === undefined ? 0 : Number(m[6]);
  if (hour > 23 || minute > 59 || second > 59) return null;
  if (m[7] === undefined) return [written];
  let offsetMinutes = 0;
  if (m[7] !== "Z") {
    const z = OFFSET.exec(m[7]);
    if (!z) return null;
    const oh = Number(z[2]);
    const om = z[3] === undefined ? 0 : Number(z[3]);
    if (oh > 23 || om > 59) return null;
    offsetMinutes = (z[1] === "-" ? -1 : 1) * (oh * 60 + om);
  }
  const utcMs = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hour, minute, second) - offsetMinutes * 60_000;
  const utc = new Date(utcMs).toISOString().slice(0, 10);
  return utc === written ? [written] : [written, utc];
}

/** Día calendario de un instante ISO 8601 tal como está escrito ("2026-10-20T15:00:00Z" → "2026-10-20"). */
export function guardInstantDay(raw: string | Date | null | undefined): string | null {
  return guardInstantDays(raw)?.[0] ?? null;
}

/** Periodo "YYYY-MM" (también acepta una fecha "YYYY-MM-DD" válida y toma su mes). Otro formato → null. */
export function guardPeriod(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) return v;
  const day = guardDate(v);
  return day ? day.slice(0, 7) : null;
}

/** "2026-10-20" → "2026-10". La entrada debe ser una fecha ya validada. */
export function monthOfDay(day: string): string {
  return day.slice(0, 7);
}

/** Huella sha256: minúsculas y sin espacios. Vacía → null. */
export function guardHash(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  return v.length > 0 ? v : null;
}
