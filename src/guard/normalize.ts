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

// ───────────────────────── Banco de la cuenta ─────────────────────────

type BankCodeKind = "swift" | "aba" | "otro";

function bankCodeKind(code: string): BankCodeKind {
  if (/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(code)) return "swift";
  if (/^[0-9]{9}$/.test(code)) return "aba";
  return "otro";
}

/**
 * ¿El código SWIFT/de ruteo de la factura contradice el registrado? Solo se comparan códigos del
 * mismo tipo (SWIFT con SWIFT, ABA con ABA): un SWIFT es del mismo banco si coinciden sus 8 primeros
 * caracteres (la sucursal no cambia el banco). Si falta alguno o son de tipos distintos, no hay
 * contradicción que probar (decide el nombre del banco). Un código con caracteres raros sí la hay.
 */
export function guardBankCodeConflict(invoiceCode: unknown, registeredCode: unknown): boolean {
  if (typeof invoiceCode !== "string" || typeof registeredCode !== "string") return false;
  const a = invoiceCode.toUpperCase().replace(SEPARATOR_CHARS, "");
  const b = registeredCode.toUpperCase().replace(SEPARATOR_CHARS, "");
  if (a.length === 0 || b.length === 0) return false;
  if (!/^[A-Z0-9]+$/.test(a)) return true;
  if (a === b) return false;
  const kind = bankCodeKind(a);
  if (kind !== bankCodeKind(b)) return false;
  return kind === "swift" ? a.slice(0, 8) !== b.slice(0, 8) : true;
}

/** Palabras que no identifican a un banco. */
const BANK_FILLER = new Set([
  "banco", "bank", "bco", "banca", "de", "del", "la", "el", "los", "las", "the", "of", "and", "y", "e", "do", "da",
  "dos", "das", "sa", "na", "n", "a", "s", "ltd", "ltda", "plc", "inc", "corp", "co", "company", "trust",
  "nacional", "national", "grupo", "group", "financiero", "financial", "multiple", "institucion",
]);
const BANK_CONNECTORS = new Set(["de", "del", "la", "el", "los", "las", "the", "of", "and", "y", "e", "do", "da", "dos", "das"]);

function bankTokens(raw: string): string[] {
  const cleaned = stripDiacritics(raw).toLowerCase().replace(/\./g, "").replace(/[^a-z0-9]+/g, " ").trim();
  return cleaned.length > 0 ? cleaned.split(" ") : [];
}

/**
 * ¿El nombre de banco de la factura contradice el registrado? No, si comparten una palabra que
 * identifica al banco, si una contiene a la otra al quitar espacios o si una es la sigla de la otra
 * («SVB» / «Silicon Valley Bank»). Tolerante a propósito (el banco se escribe de muchas formas);
 * sí contradice «Banco Pirata Internacional» frente a «Silicon Valley Bank». Si falta alguno, no.
 */
export function guardBankNameConflict(invoiceBank: unknown, registeredBank: unknown): boolean {
  if (typeof invoiceBank !== "string" || typeof registeredBank !== "string") return false;
  const all = [bankTokens(invoiceBank), bankTokens(registeredBank)];
  if (all[0].length === 0 || all[1].length === 0) return false;
  const [a, b] = all.map((t) => t.filter((w) => !BANK_FILLER.has(w)));
  if (a.length === 0 || b.length === 0) return all[0].join("") !== all[1].join("");
  const setB = new Set(b);
  if (a.some((w) => setB.has(w))) return false;
  const joinedA = a.join("");
  const joinedB = b.join("");
  if (joinedA.includes(joinedB) || joinedB.includes(joinedA)) return false;
  const initials = (t: string[]) => t.filter((w) => !BANK_CONNECTORS.has(w)).map((w) => w.charAt(0)).join("");
  if (a.length === 1 && initials(all[1]) === a[0]) return false;
  if (b.length === 1 && initials(all[0]) === b[0]) return false;
  return true;
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

/** Etiquetas que se quitan al comienzo de un id tributario leído (en mayúsculas). */
const GUARD_TAX_LABEL =
  /^(?:NIT|EIN|FEIN|TIN|SSN|ITIN|RUT|RUN|RFC|RUC|CNPJ|CPF|CUIT|CUIL|CI|DNI|NIF|CIF|VAT(?:\s*(?:NO|NUMBER|ID))?|TAX\s*(?:ID|NO|NUMBER)|ID\s*FISCAL|C\.?\s?C\.?)\b\s*(?:N[O°º]\.?\s*)?[:#.\-]?\s*/;

/**
 * Id tributario del destinatario de una factura, sin su etiqueta inicial («EIN 93-4127765» →
 * «93-4127765»): los ids de la empresa compradora se registran sin etiqueta y un lector a veces la
 * deja en el valor. Solo se quita si después queda algún dígito. null si no es un id válido.
 */
export function guardBillToTaxId(raw: string | null | undefined): TaxId | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  const m = GUARD_TAX_LABEL.exec(v.toUpperCase());
  const rest = m && m[0].length > 0 ? v.slice(m[0].length).trim() : v;
  return guardTaxId(/[0-9]/.test(rest) ? rest : v);
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

// ───────────────────────── Destinatario de la factura ─────────────────────────

/**
 * Formas societarias del destinatario, con su forma canónica. Aquí la forma NO se descarta: «Andes Labs
 * S.A.S.» es otra razón social que «Andes Labs Inc.». Una forma desconocida queda como parte del nombre
 * (el nombre deja de coincidir y la guardia no aprueba).
 */
const GUARD_LEGAL_FORMS: ReadonlyMap<string, string> = new Map([
  ...[...CORPORATE_SUFFIXES, "ag", "bv", "nv", "pty", "ptyltd", "lda", "lp", "llp", "pllc", "sarl", "sasu"].map((f): [string, string] => [f, f]),
  ["incorporated", "inc"],
  ["corporation", "corp"],
  ["limited", "ltd"],
  ["limitada", "ltda"],
]);

function guardWords(raw: string): string[] {
  const cleaned = stripDiacritics(raw)
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return cleaned.length > 0 ? cleaned.split(" ") : [];
}

function guardFormAt(words: readonly string[], start: number): string | null {
  for (let k = Math.min(6, words.length - start); k >= 1; k--) {
    const form = GUARD_LEGAL_FORMS.get(words.slice(start, start + k).join(""));
    if (form !== undefined) return form;
  }
  return null;
}

/**
 * Razón social del destinatario: palabras del nombre (sin tildes, minúsculas, sin puntuación) y la forma
 * societaria final, canónica («ANDES LABS, INC.» → { base: "andes labs", form: "inc" }; «Andes Labs» →
 * form ""). null si no queda ninguna letra o dígito ASCII.
 */
export function guardLegalName(raw: string | null | undefined): { base: string; form: string } | null {
  if (typeof raw !== "string") return null;
  const words = guardWords(raw);
  const forms: string[] = [];
  let changed = true;
  while (changed && words.length > 1) {
    changed = false;
    for (let k = Math.min(6, words.length - 1); k >= 1; k--) {
      const form = GUARD_LEGAL_FORMS.get(words.slice(-k).join(""));
      if (form !== undefined) {
        forms.unshift(form);
        words.splice(words.length - k, k);
        changed = true;
        break;
      }
    }
  }
  return words.length > 0 ? { base: words.join(" "), form: forms.join("") } : null;
}

/** Formas societarias que siguen a cada aparición del nombre `base` en un texto ("" si ninguna). */
export function guardFormsAfter(text: string | null | undefined, base: string): string[] {
  if (typeof text !== "string" || base.length === 0) return [];
  const words = guardWords(text);
  const target = base.split(" ");
  const out: string[] = [];
  for (let i = 0; i + target.length <= words.length; i++) {
    if (target.every((w, k) => words[i + k] === w)) out.push(guardFormAt(words, i + target.length) ?? "");
  }
  return out;
}

/** Rellenos que un lector escribe en vez de dejar vacío el destinatario (solo letras y dígitos ASCII). */
const GUARD_BILL_TO_FILLERS = new Set([
  "na", "nd", "sn", "none", "null", "nil", "unknown", "ninguno", "ninguna", "desconocido", "desconocida", "noaplica",
  "noindica", "noaparece", "nodisponible", "noespecificado", "noespecificada", "sindato", "sindatos", "notavailable",
  "notprovided", "notapplicable", "notspecified",
]);

/**
 * Texto del destinatario: null si no viene, si no tiene ninguna letra ni dígito de ningún alfabeto
 * («—») o si es un relleno («N/A»). Un nombre en otro alfabeto SÍ es un destinatario: para el
 * destinatario, «ausente» es lo que deja pagar.
 */
export function guardBillToText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (!/[\p{L}\p{N}]/u.test(v)) return null;
  const canon = stripDiacritics(v.normalize("NFKC")).toLowerCase().replace(/[^a-z0-9]/g, "");
  return GUARD_BILL_TO_FILLERS.has(canon) ? null : v;
}

const GUARD_INTERMEDIARY =
  /(?:^|[^\p{L}\p{N}])(?:c\s*\/\s*o|(?:in\s+)?care\s+of|on\s+behalf\s+of|por\s+cuenta\s+(?:y\s+orden\s+)?de|en\s+nombre\s+y\s+por\s+cuenta\s+de|en\s+representacion\s+de|aos\s+cuidados\s+de|por\s+conta\s+(?:e\s+ordem\s+)?de)(?![\p{L}\p{N}])/u;

/** ¿El texto pone a un tercero junto al destinatario («c/o», «por cuenta de», «care of», «aos cuidados de»)? */
export function guardNamesIntermediary(text: string | null): boolean {
  return typeof text === "string" && GUARD_INTERMEDIARY.test(stripDiacritics(text).toLowerCase());
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

/** "2026-10-31" → "2026-11-01". La entrada debe ser una fecha ya validada. */
export function dayAfter(day: string): string {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  const d = Number(day.slice(8, 10));
  if (d < daysInMonth(year, month)) return `${day.slice(0, 8)}${String(d + 1).padStart(2, "0")}`;
  if (month < 12) return `${day.slice(0, 5)}${String(month + 1).padStart(2, "0")}-01`;
  return `${String(year + 1).padStart(4, "0")}-01-01`;
}

/** "2026-10-20" → "2026-10". La entrada debe ser una fecha ya validada. */
export function monthOfDay(day: string): string {
  return day.slice(0, 7);
}

/** Mes anterior a un periodo "YYYY-MM" ya validado: "2026-11" → "2026-10", "2026-01" → "2025-12". */
export function monthBefore(period: string): string {
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  if (month > 1) return `${period.slice(0, 5)}${String(month - 1).padStart(2, "0")}`;
  return `${String(year - 1).padStart(4, "0")}-12`;
}

/** Copia propia de la guardia (no usa la del motor): nombres de los meses en español. */
const GUARD_MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
] as const;

/** "2026-10" → "octubre de 2026". Si no es un periodo válido, lo devuelve tal cual. */
export function guardMonthLabel(period: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  const month = m ? Number(m[2]) : 0;
  return m && month >= 1 && month <= 12 ? `${GUARD_MONTHS[month - 1]} de ${m[1]}` : period;
}

/** Huella sha256: minúsculas y sin espacios. Vacía → null. */
export function guardHash(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  return v.length > 0 ? v : null;
}
