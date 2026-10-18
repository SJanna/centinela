/**
 * Qué significa un «$» solo según el país del proveedor. «$» es el dólar en EE. UU., pero el peso en
 * Colombia, México, Chile y Argentina: una factura argentina que dice «$ 2.800,00» cobra 2.800 pesos
 * (≈ USD 3), no USD 2.800. Lo usan la verificación de lecturas (src/extract/currency-written.ts) y el
 * motor (ACU-2). La guardia tiene su propia copia a propósito (no importa este archivo).
 */

/** Monedas que se escriben con un «$» solo. */
export const DOLLAR_SIGN_CURRENCIES: readonly string[] = ["USD", "COP", "MXN", "CLP", "ARS"];

/**
 * Lo que significa un «$» solo según el país del proveedor (ISO 3166 alfa-2). Países donde la moneda
 * local se escribe con «$»; en el resto (Brasil, Perú, Europa…) la moneda local tiene otro símbolo y
 * un «$» solo es el dólar.
 */
export const LOCAL_DOLLAR_SIGN: Readonly<Record<string, string>> = {
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
  const c = typeof country === "string" ? country.trim().toUpperCase() : "";
  if (!c) return null;
  return Object.prototype.hasOwnProperty.call(LOCAL_DOLLAR_SIGN, c) ? LOCAL_DOLLAR_SIGN[c] : "USD";
}
