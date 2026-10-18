/**
 * ¿El documento escribe la moneda o solo pone «$»? «$» es el dólar en EE. UU., pero el peso en
 * Colombia, México, Chile y Argentina. Una factura argentina que dice «$ 2.800,00» cobra 2.800 pesos
 * (≈ USD 3), no USD 2.800: leer «$» como dólar porque así lo dice el acuerdo pagaría mil veces lo
 * cobrado. Código, sin modelo.
 *
 * Qué texto cuenta lo decide la verificación (assess.ts): junto al total, no en cualquier parte del
 * documento. Una nota «Cotización dólar BNA: $ 1.050», una firma «Cotizamos en USD» o «no se aceptan
 * dólares» no dicen en qué moneda está el total.
 */

import { DOLLAR_SIGN_CURRENCIES, bareDollarMeaning } from "../core/currency";

// El mapa país → significado de «$» vive en src/core/currency.ts (también lo usa el motor, ACU-2).
export { DOLLAR_SIGN_CURRENCIES, bareDollarMeaning };

/**
 * Formas que nombran una moneda sin ambigüedad (sobre texto en minúsculas, sin tildes). «peso» solo
 * no cuenta: hay pesos en cinco países. El código ISO se busca aparte, como palabra. Los símbolos
 * compuestos («US$», «AR$», «R$») no valen pegados a una palabra: «Bonus $», «Pagar $», «Valor $».
 */
const EXPLICIT_FORMS: Record<string, RegExp[]> = {
  USD: [
    /(?<![a-z])us\s?\$/,
    /(?<![a-z])u\$[sd]/,
    /(?<![a-z])u\.\s?s\.\s?\$/,
    /\bdolar(?:es)?\b/,
    /\bdollars?\b/,
    // «$ 2,800.00 Dlls» (México), «U.S.D.», «DOL» (código de AFIP para el dólar).
    /\bdll?s\b/,
    /(?<![a-z])u\.\s?s\.\s?d\b/,
    /\bdol\b/,
  ],
  COP: [/(?<![a-z])col\s?\$/, /\bpesos? colombianos?\b/, /\bm\s?\/\s?cte\b/, /\bmcte\b/, /\bmoneda corriente\b/],
  MXN: [/(?<![a-z])mx\s?\$/, /\bpesos? mexicanos?\b/, /\bm\.\s?n\.?(?![a-z])/],
  CLP: [/(?<![a-z])clp\s?\$/, /(?<![a-z])ch\s?\$/, /\bpesos? chilenos?\b/],
  ARS: [/(?<![a-z])ar\s?\$/, /\bpesos? argentinos?\b/],
  BRL: [/(?<![a-z])r\$/, /\breais\b/],
  PEN: [/(?<![a-z])s\/\.?\s?(?=\d)/, /\bsoles\b/],
  EUR: [/€/, /\beuros?\b/],
  GBP: [/£/, /\blibras? esterlinas?\b/, /\bpounds? sterling\b/],
  UYU: [/\bpesos? uruguayos?\b/],
};

/** Monedas que se buscan cuando el total no nombra la leída: si nombra otra, es esa. */
const KNOWN_CURRENCIES: readonly string[] = ["USD", "COP", "MXN", "CLP", "ARS", "BRL", "PEN", "EUR", "GBP", "UYU", "CAD", "AUD"];

function fold(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function isoCode(code: string | null | undefined): string | null {
  const c = code?.trim().toUpperCase() ?? "";
  return /^[A-Z]{3}$/.test(c) ? c : null;
}

/** ¿El texto nombra esta moneda de forma explícita (código ISO o forma inequívoca)? */
export function namesCurrency(code: string, text: string | null | undefined): boolean {
  if (!text) return false;
  const c = isoCode(code);
  if (c == null) return false;
  const lower = fold(text);
  if (new RegExp(`(?:^|[^a-z])${c.toLowerCase()}(?![a-z])`).test(lower)) return true;
  return (EXPLICIT_FORMS[c] ?? []).some((re) => re.test(lower));
}

/** ¿El texto (plegado) EMPIEZA nombrando la moneda? Para el valor de un campo «Moneda: …». */
function startsNamingCurrency(c: string, lowerTail: string): boolean {
  if (new RegExp(`^${c.toLowerCase()}(?![a-z])`).test(lowerTail)) return true;
  return (EXPLICIT_FORMS[c] ?? []).some((re) => new RegExp(`^(?:${re.source})`).test(lowerTail));
}

/** «Moneda: USD», «CURRENCY\nUSD», «Divisa de facturación: COP». El valor tiene que ir justo después. */
const CURRENCY_LABEL =
  /\b(?:tipo\s+de\s+moneda|moneda|currency|divisa|moeda)(?:\s+(?:de\s+)?(?:pago|facturacion|la\s+factura|factura|payment|billing|invoice))?[^\S\n]*[:=\-–]?\s*/g;
/** «Valores en USD», «All amounts in USD», «Valores expresados en dólares». */
const AMOUNTS_IN =
  /\b(?:valores|montos|importes|precios|cifras|amounts|prices|figures)\b(?:[^\S\n]+(?:expresad[oa]s|estan|son|are|stated|shown|expressed))*[^\S\n]+(?:en|in)[^\S\n]+/g;
/** El total en letras: «SON: DOCE MILLONES DE PESOS M/CTE», «Amount in words: …». */
const IN_WORDS = /^[^\S\n]*(?:son|importe\s+en\s+letras|total\s+en\s+letras|valor\s+en\s+letras|amount\s+in\s+words|la\s+suma\s+de)\b/;

/**
 * ¿El documento DECLARA la moneda en un campo con etiqueta («Moneda: USD», «CURRENCY» y en la línea
 * siguiente «USD», «Valores en USD») o en el total en letras («SON: … PESOS M/CTE»)? Una mención
 * suelta («Cotización dólar», «Cotizamos en USD», «no se aceptan dólares») no declara nada.
 */
export function declaresCurrency(code: string, text: string | null | undefined): boolean {
  if (!text) return false;
  const c = isoCode(code);
  if (c == null) return false;
  const lower = fold(text);
  for (const re of [CURRENCY_LABEL, AMOUNTS_IN]) {
    for (const m of lower.matchAll(re)) {
      if (startsNamingCurrency(c, lower.slice(m.index + m[0].length, m.index + m[0].length + 40))) return true;
    }
  }
  return lower.split("\n").some((line) => IN_WORDS.test(line) && namesCurrency(c, line));
}

/** ¿Hay un «$» solo (no «US$», «R$», «AR$», «U$S»…)? */
export function hasBareDollarSign(text: string | null | undefined): boolean {
  return text != null && /(?<![a-z$])\$/.test(fold(text));
}

/**
 * Qué escribe el texto en lugar de la moneda leída (que NO nombra): otro código ISO si nombra otra
 * moneda («R$ 2.800» → "BRL", «COP 12.000.000» → "COP"); "$" si hay un «$» solo; "" si no hay ni
 * código ni símbolo.
 */
export function currencyMarkerIn(code: string, texts: readonly (string | null | undefined)[]): string {
  const c = isoCode(code) ?? "";
  for (const other of KNOWN_CURRENCIES) {
    if (other !== c && texts.some((t) => namesCurrency(other, t))) return other;
  }
  return texts.some(hasBareDollarSign) ? "$" : "";
}

/**
 * ¿La moneda leída quedó sin escribir? Solo para las monedas que se escriben con «$» solo: true si
 * ninguno de los textos la nombra de forma explícita. Para el resto de monedas siempre false (sus
 * símbolos no se confunden).
 */
export function currencyOnlyAsDollarSign(code: string | null | undefined, texts: readonly (string | null | undefined)[]): boolean {
  const c = code?.trim().toUpperCase();
  if (!c || !DOLLAR_SIGN_CURRENCIES.includes(c)) return false;
  return !texts.some((t) => namesCurrency(c, t));
}
