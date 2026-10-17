/**
 * Dígitos de control de cuentas e identificaciones latinoamericanas y de EE. UU.
 *
 * El set de estrés inventa cuentas e ids para proveedores ficticios e impostores. Para no fabricar
 * por accidente el número de una cuenta o empresa real, todo lo inventado se construye para que
 * NO pase el dígito de control de su formato (CLABE, CBU, ABA, NIT, CUIT, RUT, CNPJ, RUC). Las
 * cuentas e ids de los proveedores registrados de dataset/company.json se usan tal cual.
 */

const digitsOf = (s: string): number[] => s.replace(/\D/g, "").split("").map(Number);

/** CLABE mexicana (18 dígitos): pesos 3, 7, 1 sobre los primeros 17. */
export function isValidClabe(raw: string): boolean {
  const d = digitsOf(raw);
  if (d.length !== 18) return false;
  const weights = [3, 7, 1];
  const sum = d.slice(0, 17).reduce((s, x, i) => s + ((x * weights[i % 3]) % 10), 0);
  return (10 - (sum % 10)) % 10 === d[17];
}

/** CBU argentina (22 dígitos): dos bloques con su dígito verificador. */
export function isValidCbu(raw: string): boolean {
  const d = digitsOf(raw);
  if (d.length !== 22) return false;
  const w1 = [7, 1, 3, 9, 7, 1, 3];
  const s1 = d.slice(0, 7).reduce((s, x, i) => s + x * w1[i], 0);
  if ((10 - (s1 % 10)) % 10 !== d[7]) return false;
  const w2 = [3, 9, 7, 1, 3, 9, 7, 1, 3, 9, 7, 1, 3];
  const s2 = d.slice(8, 21).reduce((s, x, i) => s + x * w2[i], 0);
  return (10 - (s2 % 10)) % 10 === d[21];
}

/** Número de ruteo ABA (9 dígitos): 3·(d1+d4+d7) + 7·(d2+d5+d8) + (d3+d6+d9) ≡ 0 (mód 10). */
export function isValidAba(raw: string): boolean {
  const d = digitsOf(raw);
  if (d.length !== 9 || raw.replace(/\D/g, "").length !== raw.trim().length) return false;
  const sum = 3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8]);
  return sum % 10 === 0;
}

/** Dígito de verificación del NIT colombiano para una base de dígitos. */
export function nitCheckDigit(base: string): number {
  const weights = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
  const d = digitsOf(base).reverse();
  const sum = d.reduce((s, x, i) => s + x * weights[i], 0);
  const r = sum % 11;
  return r > 1 ? 11 - r : r;
}

/** CUIT argentino (11 dígitos). */
export function isValidCuit(raw: string): boolean {
  const d = digitsOf(raw);
  if (d.length !== 11) return false;
  const w = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const r = 11 - (d.slice(0, 10).reduce((s, x, i) => s + x * w[i], 0) % 11);
  const dv = r === 11 ? 0 : r === 10 ? 9 : r;
  return dv === d[10];
}

/** Dígito verificador del RUT chileno ("0"–"9" o "K"). */
export function rutCheckDigit(body: string): string {
  const d = digitsOf(body).reverse();
  const sum = d.reduce((s, x, i) => s + x * (2 + (i % 6)), 0);
  const r = 11 - (sum % 11);
  return r === 11 ? "0" : r === 10 ? "K" : String(r);
}

/** CNPJ brasileño (14 dígitos). */
export function isValidCnpj(raw: string): boolean {
  const d = digitsOf(raw);
  if (d.length !== 14) return false;
  const calc = (n: number) => {
    const weights = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const s = d.slice(0, n).reduce((acc, x, i) => acc + x * weights[i], 0) % 11;
    return s < 2 ? 0 : 11 - s;
  };
  return calc(12) === d[12] && calc(13) === d[13];
}

/** RUC peruano (11 dígitos). */
export function isValidRuc(raw: string): boolean {
  const d = digitsOf(raw);
  if (d.length !== 11) return false;
  const w = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const r = 11 - (d.slice(0, 10).reduce((s, x, i) => s + x * w[i], 0) % 11);
  const dv = r === 10 ? 0 : r === 11 ? 1 : r;
  return dv === d[10];
}

/**
 * RFC mexicano (12 caracteres persona moral, 13 persona física): el último es el dígito verificador
 * del SAT (diccionario 0-9 A-N & O-Z espacio Ñ, pesos 13…2, módulo 11; 10 → «A»).
 */
export function isValidRfc(raw: string): boolean {
  const dict = "0123456789ABCDEFGHIJKLMN&OPQRSTUVWXYZ Ñ";
  let r = raw.toUpperCase().replace(/[\s-]/g, "");
  if (r.length === 12) r = ` ${r}`;
  if (r.length !== 13) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const v = dict.indexOf(r[i]);
    if (v < 0) return false;
    sum += v * (13 - i);
  }
  const m = sum % 11;
  const dv = m === 0 ? "0" : 11 - m === 10 ? "A" : String(11 - m);
  return dv === r[12];
}

/**
 * Cuenta de Itaú con la forma agência-conta-dígito («0341-45678-9»): el dígito sale de agência +
 * conta con pesos 2,1,2,1…, sumando los dígitos de cada producto, módulo 10.
 */
export function isValidItauAccount(raw: string): boolean {
  const m = /^(\d{4})-?(\d{5})-?(\d)$/.exec(raw.trim());
  if (!m) return false;
  const d = digitsOf(m[1] + m[2]);
  const sum = d.reduce((s, x, i) => {
    const p = x * (i % 2 === 0 ? 2 : 1);
    return s + Math.floor(p / 10) + (p % 10);
  }, 0);
  return (10 - (sum % 10)) % 10 === Number(m[3]);
}

/**
 * ¿Una cuenta inventada pasaría el dígito de control de su formato? CLABE (18 dígitos) y CBU
 * (22 dígitos) tienen uno estándar que se comprueba con el número solo; la forma
 * agência-conta-dígito de Brasil («0341-45678-9», la de la ficha de Testa Qualidade en Itaú) se
 * comprueba con el dígito de Itaú, porque una cuenta inventada «en el mismo banco» usa esa forma.
 */
export function accountPassesCheck(raw: string): boolean {
  if (/^\d{4}-\d{5}-\d$/.test(raw.trim())) return isValidItauAccount(raw);
  const n = raw.replace(/\D/g, "").length;
  if (n === 18) return isValidClabe(raw);
  if (n === 22) return isValidCbu(raw);
  return false;
}
