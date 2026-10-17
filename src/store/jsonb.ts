/**
 * Postgres rechaza el carácter NUL (U+0000) en text/jsonb y los sustitutos UTF-16 sueltos en jsonb.
 * El texto que sale de un PDF o de un modelo puede traerlos, y un INSERT fallido haría perder una
 * decisión. Por eso todo lo que se guarda pasa antes por aquí: esos caracteres se cambian por «�».
 */
const NUL = /\u0000/g;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const REPLACEMENT = "�";

export function toPgSafeString(value: string): string {
  return value.replace(NUL, REPLACEMENT).replace(LONE_SURROGATE, REPLACEMENT);
}

/** Copia apta para jsonb: limpia textos y claves; como JSON, descarta `undefined` y cambia NaN/Infinity por null. */
export function toJsonbSafe<T>(value: T): T {
  const json = JSON.stringify(value, (_key, v: unknown) => {
    if (typeof v === "string") return toPgSafeString(v);
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      const entries = Object.entries(v as Record<string, unknown>);
      if (entries.some(([k]) => toPgSafeString(k) !== k)) {
        return Object.fromEntries(entries.map(([k, x]) => [toPgSafeString(k), x]));
      }
    }
    return v;
  });
  return (json === undefined ? null : JSON.parse(json)) as T;
}
