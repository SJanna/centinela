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
