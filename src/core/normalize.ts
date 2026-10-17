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

/** Nombre de proveedor: sin tildes, minúsculas, sin puntuación ni sufijos societarios comunes. */
export function normalizeName(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const v = raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(s\s?a\s?s|s\s?a|ltda|llc|inc|corp|sa de cv|s de rl|ltd|eireli|me|srl|spa)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return v.length > 0 ? v : null;
}

/** Identificación tributaria: solo dígitos y letras, sin dígito de verificación separado por guion. */
export function normalizeTaxId(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const v = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return v.length > 0 ? v : null;
}

/** Monto a centavos enteros (evita errores de coma flotante al comparar). */
export function toCents(amount: number): number {
  return Math.round(amount * 100);
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
