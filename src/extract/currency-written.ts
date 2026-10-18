/**
 * ¿El documento escribe la moneda o solo pone «$»? «$» es el dólar en EE. UU., pero el peso en
 * Colombia, México, Chile y Argentina. Una factura argentina que dice «$ 2.800,00» cobra 2.800 pesos
 * (≈ USD 3), no USD 2.800: leer «$» como dólar porque así lo dice el acuerdo pagaría mil veces lo
 * cobrado. Código, sin modelo.
 */

/** Monedas que se escriben con un «$» solo. */
export const DOLLAR_SIGN_CURRENCIES: readonly string[] = ["USD", "COP", "MXN", "CLP", "ARS"];

/**
 * Lo que significa un «$» solo según el país del proveedor. Países donde la moneda local se escribe
 * con «$»; en el resto (Brasil, Perú, Europa…) la moneda local tiene otro símbolo y un «$» solo es
 * el dólar.
 */
const LOCAL_DOLLAR_SIGN: Record<string, string> = {
  US: "USD",
  EC: "USD",
  SV: "USD",
  PA: "USD",
  PR: "USD",
  CO: "COP",
  MX: "MXN",
  CL: "CLP",
  AR: "ARS",
  UY: "UYU",
  DO: "DOP",
  CU: "CUP",
  NZ: "NZD",
  AU: "AUD",
  CA: "CAD",
  SG: "SGD",
  HK: "HKD",
};

/** Moneda que significa un «$» solo en una factura de un proveedor de ese país (ISO 3166 alfa-2). null si no se sabe el país. */
export function bareDollarMeaning(country: string | null | undefined): string | null {
  const c = country?.trim().toUpperCase();
  if (!c) return null;
  return LOCAL_DOLLAR_SIGN[c] ?? "USD";
}

/**
 * Formas que nombran una moneda sin ambigüedad (sobre texto en minúsculas, sin tildes). «peso» solo
 * no cuenta: hay pesos en cinco países. El código ISO se busca aparte, como palabra.
 */
const EXPLICIT_FORMS: Record<string, RegExp[]> = {
  USD: [/us\s?\$/, /u\$s/, /u\$d/, /\bdolar(?:es)?\b/, /\bdollars?\b/],
  COP: [/col\s?\$/, /\bpesos? colombianos?\b/, /\bm\s?\/\s?cte\b/, /\bmcte\b/, /\bmoneda corriente\b/],
  MXN: [/mx\s?\$/, /\bpesos? mexicanos?\b/, /\bm\.\s?n\.?(?![a-z])/],
  CLP: [/clp\s?\$/, /ch\s?\$/, /\bpesos? chilenos?\b/],
  ARS: [/ar\s?\$/, /\bpesos? argentinos?\b/],
};

function fold(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** ¿El texto nombra esta moneda de forma explícita (código ISO o forma inequívoca)? */
export function namesCurrency(code: string, text: string | null | undefined): boolean {
  if (!text) return false;
  const c = code.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(c)) return false;
  const lower = fold(text);
  if (new RegExp(`(?:^|[^a-z])${c.toLowerCase()}(?![a-z])`).test(lower)) return true;
  return (EXPLICIT_FORMS[c] ?? []).some((re) => re.test(lower));
}

/**
 * ¿La moneda leída quedó sin escribir? Solo para las monedas que se escriben con «$» solo: true si
 * ninguno de los textos (el texto plano del documento, si lo hay, y las citas de los lectores) la
 * nombra de forma explícita. Para el resto de monedas siempre false (sus símbolos no se confunden).
 */
export function currencyOnlyAsDollarSign(code: string | null | undefined, texts: readonly (string | null | undefined)[]): boolean {
  const c = code?.trim().toUpperCase();
  if (!c || !DOLLAR_SIGN_CURRENCIES.includes(c)) return false;
  return !texts.some((t) => namesCurrency(c, t));
}
