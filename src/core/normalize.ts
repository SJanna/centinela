/**
 * Utilidades de normalización compartidas por verificación y motor.
 * La guardia NO las importa: tiene su propia implementación a propósito.
 */

/** Cuenta bancaria: solo letras y dígitos, en mayúscula. "0012-3456 78" → "0012345678". */
export function normalizeAccount(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const v = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return v.length > 0 ? v : null;
}

/**
 * Formas societarias que se ignoran al FINAL de un nombre, escritas sin espacios ni puntos
 * ("S. de R.L." → "sderl"). Ni "me" ni nada en medio del nombre: "Testa Qualidade ME" no es
 * "Testa Qualidade Ltda" y "Acme SA Dev" no es "Acme Dev".
 */
const CORPORATE_SUFFIXES: ReadonlySet<string> = new Set([
  "sas", "sa", "sadecv", "sderl", "srl", "spa", "ltda", "ltd", "llc", "inc", "corp", "eireli",
]);

/**
 * Nombre de proveedor: sin tildes, minúsculas, palabras separadas por un espacio, sin puntos
 * ("S.A.S." → "sas") y sin la forma societaria final (una o varias palabras: "s de rl", "sa de cv").
 * "Camila Restrepo Dev S.A.S." → "camila restrepo dev". Un nombre que es solo la forma societaria
 * se conserva ("SAS" → "sas").
 */
export function normalizeName(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const words = raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\./g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0);
  let stripped = true;
  while (stripped && words.length > 1) {
    stripped = false;
    // La forma más larga primero: "s a de c v" se quita entera y no solo "c v".
    for (let n = Math.min(6, words.length - 1); n >= 1 && !stripped; n--) {
      if (CORPORATE_SUFFIXES.has(words.slice(words.length - n).join(""))) {
        words.length -= n;
        stripped = true;
      }
    }
  }
  return words.length > 0 ? words.join(" ") : null;
}

/**
 * Identificación tributaria: solo letras ASCII y dígitos, en mayúscula. CONSERVA el dígito de
 * verificación (se pega al número): "901.456.789-1" → "9014567891". Para decidir si dos ids son
 * el mismo, usa `taxIdsEquivalent`, que sí sabe ignorar un dígito de verificación separado.
 */
export function normalizeTaxId(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const v = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return v.length > 0 ? v : null;
}

/**
 * Dígito de verificación separado por guion al final: 1 o 2 letras/dígitos tras un guion
 * (también guiones tipográficos), con espacios opcionales alrededor. "901.456.789-1" → "1",
 * "12.345.678/0001-90" → "90", "76.543.210-K" → "K". "88-1234567" no lo tiene (el último tramo es largo).
 */
const CHECK_DIGIT_SUFFIX = /^(.*[A-Z0-9])\s*[-‐-―]\s*[A-Z0-9]{1,2}$/;

/** El id sin su dígito de verificación separado, normalizado; null si no trae uno. */
function taxIdWithoutCheckDigit(raw: string): string | null {
  const m = CHECK_DIGIT_SUFFIX.exec(raw.trim().toUpperCase());
  return m ? normalizeTaxId(m[1]) : null;
}

/**
 * ¿Son la misma identificación tributaria? Sí si son iguales tras normalizar (`normalizeTaxId`).
 * Si no, y exactamente UNO de los dos trae dígito de verificación separado por guion al final,
 * se comparan quitándole ese dígito: "901.456.789-1" ≡ "901456789". Si los dos traen dígito de
 * verificación y no son iguales completos, no son el mismo ("901.456.789-1" ≠ "901.456.789-2").
 * Un id vacío o ausente nunca es equivalente a nada.
 */
export function taxIdsEquivalent(a: string | null | undefined, b: string | null | undefined): boolean {
  const fullA = normalizeTaxId(a);
  const fullB = normalizeTaxId(b);
  if (fullA == null || fullB == null) return false;
  if (fullA === fullB) return true;
  const baseA = taxIdWithoutCheckDigit(a as string);
  const baseB = taxIdWithoutCheckDigit(b as string);
  if (baseA != null && baseB == null) return baseA === fullB;
  if (baseB != null && baseA == null) return baseB === fullA;
  return false;
}

/**
 * Etiquetas con que suele venir escrita una identificación tributaria («NIT», «EIN», «Tax ID»…), sobre
 * el texto en mayúsculas. Solo se quitan al comienzo y si después queda algún dígito.
 */
const TAX_ID_LABEL =
  /^(?:NIT|EIN|FEIN|TIN|SSN|ITIN|RUT|RUN|RFC|RUC|CNPJ|CPF|CUIT|CUIL|CI|DNI|NIF|CIF|VAT(?:\s*(?:NO|NUMBER|ID))?|TAX\s*(?:ID|NO|NUMBER)|ID\s*FISCAL|C\.?\s?C\.?)\b\s*(?:N[O°º]\.?\s*)?[:#.\-]?\s*/;

/**
 * Quita la etiqueta inicial de una identificación tributaria leída: «EIN 93-4127765» → «93-4127765»,
 * «NIT: 901.888.123-4» → «901.888.123-4». Lo usa la comparación del destinatario de la factura con la
 * compradora (los ids de la ficha se guardan sin etiqueta y un lector a veces la deja en el valor).
 * Sin etiqueta reconocida, o si después no queda ningún dígito, devuelve el texto tal cual (con trim).
 */
export function stripTaxIdLabel(raw: string): string {
  const v = raw.trim();
  // La etiqueta es ASCII (más «°»/«º»): el prefijo que reconoce mide lo mismo en `v` que en mayúsculas.
  const m = TAX_ID_LABEL.exec(v.toUpperCase());
  if (!m || m[0].length === 0) return v;
  const rest = v.slice(m[0].length).trim();
  return /\d/.test(rest) ? rest : v;
}

// ───────────────────────── Razón social con su forma societaria ─────────────────────────

/**
 * Formas societarias que se reconocen al comparar el destinatario de una factura con la compradora,
 * escritas sin espacios ni puntos, con su forma canónica («Incorporated» = «Inc.»). A diferencia del
 * nombre del proveedor (`normalizeName`), aquí la forma NO se descarta: «Andes Labs S.A.S.» es otra
 * razón social que «Andes Labs Inc.» (p. ej. una filial). Una forma que no está en la lista queda como
 * parte del nombre y el nombre deja de coincidir (escala): nunca hace pasar a otra empresa.
 */
const LEGAL_FORMS: ReadonlyMap<string, string> = new Map([
  ...[...CORPORATE_SUFFIXES].map((f): [string, string] => [f, f]),
  ...[
    "sac", "saa", "sapi", "sapidecv", "sderlcv", "sl", "slu", "eirl", "gmbh", "plc", "ag", "bv", "nv", "pty", "ptyltd",
    "lda", "lp", "llp", "pllc", "sarl", "sasu",
  ].map((f): [string, string] => [f, f]),
  ["incorporated", "inc"],
  ["corporation", "corp"],
  ["limited", "ltd"],
  ["limitada", "ltda"],
]);

/** Palabras de un nombre como las corta `normalizeName`: sin tildes, minúsculas, sin puntos. */
function nameWords(raw: string): string[] {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\./g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0);
}

/** Forma societaria que empieza en `words[start]` (la más larga, hasta 6 palabras): [forma canónica, palabras]. */
function legalFormAt(words: readonly string[], start: number): [string, number] | null {
  for (let n = Math.min(6, words.length - start); n >= 1; n--) {
    const form = LEGAL_FORMS.get(words.slice(start, start + n).join(""));
    if (form != null) return [form, n];
  }
  return null;
}

/** Razón social separada en nombre y forma societaria. */
export interface LegalName {
  /** Palabras del nombre sin la forma societaria final, separadas por un espacio («andes labs»). */
  base: string;
  /** Forma societaria final, canónica y sin espacios («inc», «sas», «sadecv»); "" si no trae. */
  form: string;
}

/**
 * «Andes Labs, Inc.» → { base: "andes labs", form: "inc" }; «Grupo Nopalli S.A. de C.V.» →
 * { base: "grupo nopalli", form: "sadecv" }; «Andes Labs» → { base: "andes labs", form: "" }. null si
 * no queda ninguna letra o dígito ASCII (p. ej. un nombre escrito en otro alfabeto: no se puede comparar).
 */
export function splitLegalForm(raw: string | null | undefined): LegalName | null {
  if (raw == null) return null;
  const words = nameWords(raw);
  const forms: string[] = [];
  let stripped = true;
  while (stripped && words.length > 1) {
    stripped = false;
    // La forma más larga primero: «s a de c v» se quita entera y no solo «c v».
    for (let n = Math.min(6, words.length - 1); n >= 1 && !stripped; n--) {
      const form = LEGAL_FORMS.get(words.slice(words.length - n).join(""));
      if (form != null) {
        forms.unshift(form);
        words.length -= n;
        stripped = true;
      }
    }
  }
  return words.length > 0 ? { base: words.join(" "), form: forms.join("") } : null;
}

/**
 * Formas societarias que siguen a cada aparición del nombre `base` (palabras de `splitLegalForm`) en
 * un texto: «Cliente: Andes Labs S.A.S. — NIT…» con base «andes labs» → ["sas"]. "" si una aparición no
 * va seguida de forma societaria. [] si el nombre no aparece.
 */
export function legalFormsAfter(text: string | null | undefined, base: string): string[] {
  if (text == null || base.length === 0) return [];
  const words = nameWords(text);
  const target = base.split(" ");
  const out: string[] = [];
  for (let i = 0; i + target.length <= words.length; i++) {
    if (!target.every((w, k) => words[i + k] === w)) continue;
    out.push(legalFormAt(words, i + target.length)?.[0] ?? "");
  }
  return out;
}

/**
 * Monto a centavos enteros (evita errores de coma flotante al comparar). Primero limpia el ruido de
 * coma flotante (40091.005 × 100 = 4009100.4999999995 es 4009100.5) y luego redondea la mitad lejos
 * de cero: 40091.005 → 4009101, como se redondea en papel.
 */
export function toCents(amount: number): number {
  const raw = Number((amount * 100).toPrecision(15));
  const rounded = Math.round(Math.abs(raw));
  return raw < 0 && rounded !== 0 ? -rounded : rounded;
}

/** "2026-10-16T12:00:00Z" o "2026-10-16" → "2026-10". */
export function monthOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}

/** Formatea un monto para explicaciones: 4800 → "USD 4.800,00". */
export function formatMoney(amount: number, currency: string): string {
  const n = new Intl.NumberFormat("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
  return `${currency} ${n}`;
}
