/**
 * Comparación del texto plano y el HTML de un correo multipart/alternative (código, sin modelo).
 *
 * Un cliente de correo le muestra a una persona la versión HTML; la lectura usaba el texto plano. Si
 * las dos versiones no dicen lo mismo (el HTML es un recibo «PAGADO» y el texto una factura por
 * pagar), lo que decide el sistema no es lo que ve la persona. Esta comparación dice si la diferencia
 * es MATERIAL. No importa nada de src/extract (la entrada solo depende de src/core): tiene su propia
 * lista corta de términos decisivos.
 *
 * Ambas versiones se pliegan igual (NFKD, sin tildes, minúsculas, sin invisibles, espacios colapsados)
 * y se les quitan enlaces (http(s)://, www., mailto:), direcciones de correo y llamadas de nota tipo
 * «[1]»: un botón «Ver factura» en el HTML y «Ver factura: https://…» en el texto son lo mismo.
 * Las fechas escritas con palabras («20 de octubre de 2026», «October 20, 2026», «octubre 2026») se
 * pasan a ISO antes de comparar.
 *
 * Es material si se cumple cualquiera de estas, en cualquiera de los dos sentidos:
 *
 * 1. Cifras propias: una versión trae un monto, número, fecha o cuenta (2 dígitos o más) que la otra
 *    no tiene. Las cifras se comparan por sus dígitos: «1,200.00», «1.200,00» y «1200» son la misma;
 *    «2026-10-20», «20/10/2026» y «20 de octubre de 2026» también. Un año suelto («© 2026») cuenta como
 *    presente si la otra versión trae una fecha de ese año, y una cuenta enmascarada («****7731»,
 *    «terminada en 7731») si la otra trae una cifra que termina en esos dígitos. Cero tolerancia: un
 *    dígito cambiado en el monto o la cuenta ya es material.
 * 2. Términos decisivos propios: una versión dice algo que cambia si el documento se paga y la otra
 *    no lo dice. Son palabras sueltas de documento ya pagado («pagado», «saldada», «cancelada»,
 *    «acreditado», «recibimos», «recibo», «comprobante», «paid», «receipt», «quitada»…), de órdenes
 *    («ignorar», «aprobado», «urgente», «inmediatamente», «instrucciones»…) y de cambio de datos
 *    («nueva», «cambiamos», «actualizada», «changed»…). Cero tolerancia: una sola basta.
 * 3. Proporción de palabras propias: al menos MIN_OWN_WORDS palabras con contenido (3 letras o más,
 *    sin artículos ni preposiciones, sin palabras de etiqueta como «Concepto», «Tarifa», «Importe»)
 *    y al menos el MIN_OWN_RATIO de las palabras distintas de esa versión no aparecen en la otra.
 *    Justificación: un correo legítimo arma las dos versiones con la misma plantilla, y lo que solo
 *    trae el HTML es de presentación («Ver en el navegador», el texto alternativo del logo, «[image:
 *    …]» en el texto de Gmail, encabezados de columna): en los 12 correos legítimos de las pruebas
 *    son 0 a 2 palabras y como mucho el 9 %. Un cuerpo reescrito cambia la mayoría (INY-04, INY-07 e
 *    INY-13: 57 a 60 % de las palabras del HTML y 68 a 72 % de las del texto). El 20 % deja más del
 *    doble de margen sobre lo legítimo y queda muy por debajo de lo atacado; el mínimo de 4 palabras
 *    evita que un correo de dos líneas con una despedida distinta cuente como reescrito. Los cambios
 *    cortos que sí importan los cubren las reglas 1 y 2 (cifras y términos decisivos), sin umbral.
 *
 * Si el HTML aporta algo aunque no sea material (una palabra o una cifra que el texto no tiene), su
 * texto igual se agrega a la lectura (ver email.ts): los detectores de instrucciones y de documento
 * ya pagado y los lectores lo ven, sin aviso.
 *
 * No es material: saltos de línea, tablas en lugar de «Etiqueta: valor», negritas, enlaces, píxeles de
 * rastreo (imágenes sin texto alternativo), ni pies o firmas que estén en las dos versiones.
 */

import { latinSkeleton } from "./lookalike";

export const MIN_OWN_WORDS = 4;
export const MIN_OWN_RATIO = 0.2;
/** Cuántos ejemplos de cifras o palabras se citan en el aviso (el resto se cuenta). */
const EXAMPLES_SHOWN = 3;

/**
 * Términos decisivos (plegados: minúsculas, sin tildes). Se comparan como palabras completas.
 * Formas genéricas que sí aparecen en un cobro («pago», «payment», «pagamento», «pagar», «cuenta»)
 * no están: no distinguen un recibo de una factura.
 */
const DECISIVE_TERMS: ReadonlySet<string> = new Set([
  // Ya pagado / recibo (es, en, pt)
  "pagado", "pagada", "pagados", "pagadas", "paid", "pagou",
  "saldado", "saldada", "saldados", "saldadas", "settled",
  "cancelado", "cancelada", "cancelados", "canceladas",
  "liquidado", "liquidada", "quitado", "quitada", "quitacao", "quitamos",
  "acreditado", "acreditada", "acreditados", "acreditadas", "acreditamos", "creditado", "creditada", "credited",
  "recibimos", "recibido", "recibida", "recibi", "received", "recebemos", "recebido", "recebida", "recebi",
  "recibo", "receipt", "comprobante", "comprovante", "constancia",
  "reembolso", "reembolsado", "refund", "refunded", "abonado", "abonada", "cubierto", "cubierta", "covered",
  "anulado", "anulada", "anulamos", "void", "voided", "duplicado", "duplicada", "duplicate",
  "reemplaza", "reemplazada", "sustituye", "sustituida", "replaces", "superseded",
  // Órdenes a quien procesa o al sistema
  "ignorar", "ignore", "ignora", "ignoren", "ignorem", "omitir", "omita", "omitan",
  "aprobado", "aprobada", "approved", "aprovado", "aprovada", "preaprobado", "preaprobada",
  "autorizado", "autorizada", "authorized", "authorised",
  "urgente", "urgent", "urgentemente", "urgently",
  "inmediato", "inmediata", "inmediatamente", "immediately", "imediatamente",
  "instrucciones", "instruccion", "instructions", "instrucoes",
  // Cambio de datos del cobro
  "nueva", "nuevo", "nuevas", "nuevos", "new", "nova", "novo",
  "cambiamos", "cambiado", "cambiada", "cambiaron", "changed",
  "actualizada", "actualizado", "actualizamos", "updated", "atualizada", "atualizado", "alterada", "alterado", "mudamos",
]);

/**
 * Paráfrasis de «ya está pago» sin las palabras de arriba («pago efectuado», «no adeuda», «saldo
 * cero», «payment processed»). También deciden solas; en el aviso se citan después de las de arriba.
 */
const PARAPHRASE_TERMS: ReadonlySet<string> = new Set([
  "adeuda", "adeudo", "adeudos", "adeudado", "adeudada", "efectuado", "efectuada", "efetuado", "efetuada",
  "realizado", "realizada", "procesado", "procesada", "processed", "confirmado", "confirmada", "confirmamos",
  "confirmed", "cobrado", "cobrada", "charged", "debitado", "debitada", "debited", "cero", "zero",
]);

/** Palabras sin contenido propio (3 letras o más) en español, inglés y portugués. */
const STOPWORDS: ReadonlySet<string> = new Set([
  "que", "los", "las", "del", "por", "para", "con", "una", "uno", "unos", "unas", "sus", "este", "esta", "estos",
  "estas", "ese", "esa", "esos", "esas", "como", "mas", "pero", "sin", "sobre", "entre", "desde", "hasta", "hay",
  "son", "fue", "ser", "han", "muy", "tambien", "nos", "les", "cual", "cuando", "donde", "porque", "esto", "eso",
  "the", "and", "for", "with", "from", "this", "that", "your", "our", "you", "are", "was", "were", "has", "have",
  "will", "not", "all", "any", "its", "into", "also", "been", "per", "via", "can", "may", "his", "her", "they",
  "pelo", "pela", "com", "uma", "dos", "das", "seu", "sua", "nas", "aos", "mais", "sem", "isso", "essa", "esse",
]);

/**
 * Palabras de etiqueta o encabezado de columna (plegadas). No cuentan para la proporción de palabras
 * propias: una tabla HTML pone «Concepto · Horas · Tarifa · Importe» como encabezado y el texto
 * escribe «40 h x MXN 900.00». Siguen contando para las cifras y los términos decisivos.
 */
const LABEL_WORDS: ReadonlySet<string> = new Set(
  (
    "concepto conceptos descripcion description descricao detalle detalles detail details item items articulo articulos " +
    "producto productos servicio servicios service services cantidad cant quantity qty quantidade horas hours hrs " +
    "unidad unidades unit units tarifa rate precio price preco unitario unitaria valor value monto importe amount " +
    "subtotal total totales iva igv impuesto impuestos imposto impostos tax taxes vat moneda currency moeda fecha date data " +
    "numero number referencia reference periodo period vencimiento vencimento due emision emissao issue issued " +
    "estado status nota notas note notes observaciones cliente customer proveedor vendor prestador tomador"
  ).split(" "),
);

const MONTHS: Record<string, number> = {
  enero: 1, ene: 1, january: 1, jan: 1, janeiro: 1,
  febrero: 2, feb: 2, february: 2, fevereiro: 2, fev: 2,
  marzo: 3, march: 3, marco: 3, mar: 3,
  abril: 4, abr: 4, april: 4, apr: 4,
  mayo: 5, may: 5, maio: 5, mai: 5,
  junio: 6, jun: 6, june: 6, junho: 6,
  julio: 7, jul: 7, july: 7, julho: 7,
  agosto: 8, ago: 8, august: 8, aug: 8,
  septiembre: 9, setiembre: 9, sep: 9, sept: 9, september: 9, setembro: 9, set: 9,
  octubre: 10, oct: 10, october: 10, outubro: 10, out: 10,
  noviembre: 11, nov: 11, november: 11, novembro: 11,
  diciembre: 12, dic: 12, december: 12, dec: 12, dezembro: 12, dez: 12,
};
const MONTH_ALT = Object.keys(MONTHS)
  .sort((a, b) => b.length - a.length)
  .join("|");
/** «20 de octubre de 2026», «20 oct. 2026», «20 de outubro de 2026». */
const DAY_MONTH_YEAR = new RegExp(`\\b(\\d{1,2})\\s+(?:de\\s+)?(${MONTH_ALT})\\.?,?\\s+(?:de\\s+|del\\s+)?(\\d{4})\\b`, "g");
/** «October 20, 2026», «oct 20 2026». */
const MONTH_DAY_YEAR = new RegExp(`\\b(${MONTH_ALT})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, "g");
/** «octubre 2026», «octubre de 2026», «Oct. 2026». */
const MONTH_YEAR = new RegExp(`\\b(${MONTH_ALT})\\.?\\s+(?:de\\s+|del\\s+)?(\\d{4})\\b`, "g");

const pad2 = (n: number) => String(n).padStart(2, "0");

function validDate(y: number, m: number, d: number): boolean {
  return y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31;
}

/**
 * NFKD, sin tildes, letras parecidas de otros alfabetos como la latina que imitan («РАGАDО» →
 * «pagado», ver lookalike.ts), minúsculas y sin invisibles (los espacios quedan como están).
 */
function foldKeepingSpaces(s: string): string {
  return latinSkeleton(s.normalize("NFKD").replace(/[\u0300-\u036f]/g, ""))
    .toLowerCase()
    .replace(/[\u00AD\u200B-\u200F\u2060-\u2064\uFEFF]/g, "");
}

/**
 * Miles separados por UN espacio («12 000 000», «1 200,00», también con espacio fino o duro): una sola
 * cifra. Solo con un espacio simple: una tabulación o un salto de línea separan celdas o líneas
 * («1⇥500.00» es cantidad y precio, no 1.500).
 */
function joinSpacedThousands(s: string): string {
  return s.replace(/(?<![\d.,])\d{1,3}(?:[ \u00A0\u202F\u2009]\d{3})+(?![\d])/g, (run) => run.replace(/[ \u00A0\u202F\u2009]/g, ""));
}

/** NFKD, sin tildes, minúsculas, sin invisibles y espacios colapsados. */
export function foldForComparison(s: string): string {
  return foldKeepingSpaces(s).replace(/[\s\u00A0\u2007\u2009\u202F]+/g, " ").trim();
}

/** Texto plegado sin enlaces, correos ni llamadas de nota, con las fechas en palabras pasadas a ISO. */
function prepare(s: string): string {
  return (
    joinSpacedThousands(foldKeepingSpaces(s))
      .replace(/[\s\u00A0\u2007\u2009\u202F]+/g, " ")
      .trim()
      .replace(/\b(?:https?|ftp):\/\/[^\s<>()"'\]]+/g, " ")
      .replace(/\bwww\.[^\s<>()"'\]]+/g, " ")
      .replace(/\bmailto:[^\s<>()"'\]]+/g, " ")
      .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g, " ")
      .replace(/\[\d{1,3}\]/g, " ")
      .replace(DAY_MONTH_YEAR, (whole, d: string, mon: string, y: string) => {
        const m = MONTHS[mon];
        return m && validDate(Number(y), m, Number(d)) ? ` ${y}-${pad2(m)}-${pad2(Number(d))} ` : whole;
      })
      .replace(MONTH_DAY_YEAR, (whole, mon: string, d: string, y: string) => {
        const m = MONTHS[mon];
        return m && validDate(Number(y), m, Number(d)) ? ` ${y}-${pad2(m)}-${pad2(Number(d))} ` : whole;
      })
      .replace(MONTH_YEAR, (whole, mon: string, y: string) => {
        const m = MONTHS[mon];
        return m && Number(y) >= 1900 && Number(y) <= 2100 ? ` ${y}-${pad2(m)} ` : whole;
      })
  );
}

interface Figure {
  /** Como aparece (plegado). */
  raw: string;
  /** Para el aviso: como aparece, salvo un número largo que no es fecha (una cuenta): solo sus 4 últimos dígitos. */
  shown: string;
  /** Formas comparables (solo dígitos; las fechas como AAAAMMDD o AAAAMM, en sus lecturas posibles). */
  keys: string[];
  /** Año suelto (19xx / 20xx) o año y mes (AAAA-MM): cuenta si la otra trae una fecha de ese año o mes. */
  partialDate: boolean;
  /** AAAA o AAAAMM de una fecha parcial. */
  prefix: string;
  /** Cuenta enmascarada («****7731», «terminada en 7731»): basta con que la otra termine en estos dígitos. */
  masked: boolean;
}

const FIGURE = /\d+(?:[.,\-/:]\d+)*/g;
const MASK_BEFORE = /(?:[*x•·]{2,}[\s-]?|(?:terminad[ao]|termina|finalizad[ao]|ending|ends)\s+(?:en|in|em)\s+|final\s+)$/;

/** Parte entera de un monto: solo dígitos, o grupos de miles con un mismo separador («1,200», «12.000.000»). */
const AMOUNT_INTEGER = /^(?:\d+|\d{1,3}(?:([.,])\d{3})(?:\1\d{3})*)$/;

/**
 * Forma comparable de una cifra: sus dígitos sin ceros a la izquierda. Si termina en un separador con
 * 1 o 2 cifras y lo anterior es un entero o miles bien agrupados, son decimales y cuentan como tales
 * («1,200.00» = «1.200,00» = «1200» → «1200»; «1,200.50» → «1200.5»; «120.0» → «120», que ya no
 * es «1200»: con solo los dígitos eran la misma cifra).
 */
function digitsKey(raw: string): string {
  const m = /^(.+)[.,](\d{1,2})$/.exec(raw);
  if (m && AMOUNT_INTEGER.test(m[1])) {
    const int = m[1].replace(/\D/g, "").replace(/^0+(?=\d)/, "");
    const dec = m[2].replace(/0+$/, "");
    return dec ? `${int}.${dec}` : int;
  }
  return raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
}

/** Solo los dígitos (para cuentas enmascaradas y para decidir si una cifra es larga). */
function onlyDigits(raw: string): string {
  return raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
}

function figureOf(raw: string, before: string): Figure | null {
  const keys = new Set<string>();
  /** AAAAMM de un año y mes sueltos («2026-10», «10/2026»). */
  let monthKey: string | null = null;
  let isDate = false;
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(raw))) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (validDate(y, mo, d)) keys.add(`${y}${pad2(mo)}${pad2(d)}`);
    isDate = keys.size > 0;
  } else if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(raw))) {
    const [a, b, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (validDate(y, b, a)) keys.add(`${y}${pad2(b)}${pad2(a)}`); // día/mes/año
    if (validDate(y, a, b)) keys.add(`${y}${pad2(a)}${pad2(b)}`); // mes/día/año
    isDate = keys.size > 0;
  } else if ((m = /^(\d{4})[-/.](\d{1,2})$/.exec(raw)) || (m = /^(\d{1,2})[-/](\d{4})$/.exec(raw))) {
    const [y, mo] = m[1].length === 4 ? [Number(m[1]), Number(m[2])] : [Number(m[2]), Number(m[1])];
    if (validDate(y, mo, 1)) {
      monthKey = `${y}${pad2(mo)}`;
      keys.add(monthKey);
      isDate = true;
    }
  }
  const digits = onlyDigits(raw);
  const key = digitsKey(raw);
  if (key.replace(".", "").length >= 2) keys.add(key);
  if (keys.size === 0) return null;
  const year = /^(?:19|20)\d{2}$/.test(raw) ? raw : null;
  return {
    raw,
    shown: !isDate && digits.length >= 7 ? `…${digits.slice(-4)}` : raw,
    keys: [...keys],
    partialDate: year != null || monthKey != null,
    prefix: monthKey ?? year ?? "",
    masked: MASK_BEFORE.test(before),
  };
}

function figuresOf(prepared: string): Figure[] {
  const out: Figure[] = [];
  for (const m of prepared.matchAll(FIGURE)) {
    const start = m.index ?? 0;
    const f = figureOf(m[0], prepared.slice(Math.max(0, start - 24), start));
    if (f) out.push(f);
  }
  return out;
}

/** Palabras (letras de cualquier alfabeto: una palabra que no se pliega a latín también es contenido). */
function wordsOf(prepared: string): Set<string> {
  const out = new Set<string>();
  for (const m of prepared.matchAll(/\p{L}+/gu)) {
    const w = m[0];
    if (w.length >= 3 && !STOPWORDS.has(w)) out.add(w);
  }
  return out;
}

/** Monedas por su código, símbolo o nombre (plegados). «$» solo no dice cuál es. */
const CURRENCY_TOKENS: Record<string, string> = {
  usd: "USD", "us$": "USD", "u$s": "USD", dolar: "USD", dolares: "USD", dollar: "USD", dollars: "USD",
  eur: "EUR", "€": "EUR", euro: "EUR", euros: "EUR",
  cop: "COP", mxn: "MXN", pen: "PEN", "s/": "PEN", soles: "PEN", clp: "CLP", ars: "ARS", uyu: "UYU", pyg: "PYG",
  brl: "BRL", "r$": "BRL", reais: "BRL", gbp: "GBP", "£": "GBP", cad: "CAD", chf: "CHF", gtq: "GTQ", crc: "CRC",
  dop: "DOP", hnl: "HNL", nio: "NIO", pab: "PAB", bob: "BOB",
};
const AMBIGUOUS_CURRENCY = new Set(["bob", "pen"]);
const CURRENCY_RE = /(?<![\p{L}\d$])(us\$|u\$s|r\$|s\/|€|£|[a-z]{3,7})(?![\p{L}])/gu;

function currenciesOf(prepared: string): Set<string> {
  const out = new Set<string>();
  for (const m of prepared.matchAll(CURRENCY_RE)) {
    const code = CURRENCY_TOKENS[m[1]];
    if (!code) continue;
    // «bob» y «pen» también son palabras: solo cuentan junto a una cifra («PEN 6,000.00»).
    const at = m.index ?? 0;
    if (AMBIGUOUS_CURRENCY.has(m[1]) && !/\d/.test(prepared.slice(Math.max(0, at - 4), at + m[0].length + 4))) continue;
    out.add(code);
  }
  return out;
}

/** ¿La cifra de una versión está en la otra? */
function figurePresent(f: Figure, other: Side, otherKeyList: readonly string[]): boolean {
  if (f.keys.some((k) => other.keys.has(k))) return true;
  // La otra versión muestra esta cuenta enmascarada («****7731»): cuenta como presente.
  const own = onlyDigits(f.raw);
  if (own.length > 4 && other.maskedSuffixes.some((suffix) => own.endsWith(suffix))) return true;
  if (f.partialDate && otherKeyList.some((k) => k.length > f.prefix.length && k.length <= 8 && k.startsWith(f.prefix))) return true;
  if (f.masked) {
    const digits = onlyDigits(f.raw);
    if (digits.length >= 3 && otherKeyList.some((k) => k.length > digits.length && k.endsWith(digits))) return true;
  }
  return false;
}

interface Side {
  /** Monedas que nombra (código ISO). */
  currencies: Set<string>;
  words: Set<string>;
  figures: Figure[];
  keys: Set<string>;
  /** Dígitos visibles de las cuentas enmascaradas («****7731» → «7731»), de 3 o más. */
  maskedSuffixes: string[];
}

function sideOf(text: string): Side {
  const prepared = prepare(text);
  const figures = figuresOf(prepared);
  return {
    currencies: currenciesOf(prepared),
    words: wordsOf(prepared),
    figures,
    keys: new Set(figures.flatMap((f) => f.keys)),
    maskedSuffixes: figures.filter((f) => f.masked).map((f) => onlyDigits(f.raw)).filter((d) => d.length >= 3),
  };
}

export interface DirectionDiff {
  /** Palabras con contenido distintas de esta versión (sin las de etiqueta), para la proporción. */
  words: number;
  /** Palabras con contenido que no están en la otra versión (incluidas las de etiqueta). */
  ownWords: string[];
  /** Las de ownWords que no son de etiqueta: las que cuentan para la proporción. */
  ownContentWords: string[];
  /** Cifras que no están en la otra versión, sin repetir (como aparecen; de una cuenta, solo sus 4 últimos dígitos). */
  ownFigures: string[];
  /** Términos decisivos que no están en la otra versión. */
  ownTerms: string[];
  /** Monedas que no nombra la otra versión (código ISO). */
  ownCurrencies: string[];
}

export interface BodyComparison {
  text: DirectionDiff;
  html: DirectionDiff;
  /** El HTML aporta alguna palabra o cifra que el texto no tiene (aunque no sea material). */
  htmlAddsContent: boolean;
  /** Razones de la diferencia material, en español; vacío si las versiones dicen lo mismo. */
  reasons: string[];
}

function direction(self: Side, other: Side): DirectionDiff {
  const ownWords = [...self.words].filter((w) => !other.words.has(w));
  const otherKeyList = [...other.keys];
  const ownFigures: string[] = [];
  const seen = new Set<string>();
  for (const f of self.figures) {
    if (figurePresent(f, other, otherKeyList)) continue;
    const id = f.keys[0];
    if (seen.has(id)) continue;
    seen.add(id);
    ownFigures.push(f.shown);
  }
  const ownTerms = [...ownWords.filter((w) => DECISIVE_TERMS.has(w)), ...ownWords.filter((w) => PARAPHRASE_TERMS.has(w))];
  const ownContentWords = ownWords.filter((w) => !LABEL_WORDS.has(w));
  const words = [...self.words].filter((w) => !LABEL_WORDS.has(w)).length;
  const ownCurrencies = [...self.currencies].filter((c) => !other.currencies.has(c));
  return { words, ownWords, ownContentWords, ownFigures, ownTerms, ownCurrencies };
}

function examples(values: readonly string[], quote: boolean): string {
  const shown = values.slice(0, EXAMPLES_SHOWN).map((v) => (quote ? `«${v}»` : v));
  const rest = values.length - shown.length;
  const list = shown.length <= 1 ? shown.join("") : `${shown.slice(0, -1).join(", ")} y ${shown[shown.length - 1]}`;
  return rest > 0 ? `${shown.join(", ")} y ${rest} más` : list;
}

export function ownWordRatio(d: DirectionDiff): number {
  return d.words === 0 ? 0 : d.ownContentWords.length / d.words;
}

function wordsMaterial(d: DirectionDiff): boolean {
  return d.ownContentWords.length >= MIN_OWN_WORDS && ownWordRatio(d) >= MIN_OWN_RATIO;
}

function reasonsFor(d: DirectionDiff, self: "el HTML" | "el texto", other: "el HTML" | "el texto"): string[] {
  const out: string[] = [];
  if (d.ownTerms.length > 0) out.push(`${self} dice ${examples(d.ownTerms, true)} y ${other} no`);
  if (d.ownFigures.length > 0) out.push(`${self} trae cifras que ${other} no tiene (${examples(d.ownFigures, false)})`);
  if (wordsMaterial(d)) {
    const pct = Math.round(ownWordRatio(d) * 100);
    const sample = d.ownContentWords.filter((w) => !d.ownTerms.includes(w));
    out.push(
      `el ${pct} % de las palabras de${self === "el HTML" ? "l HTML" : "l texto"} no están en ${other}` +
        (sample.length > 0 ? ` (${examples(sample, true)})` : ""),
    );
  }
  return out;
}

/** Compara el cuerpo en texto plano con el texto del HTML (ya convertido con htmlToText). */
export function compareEmailBodies(text: string, htmlText: string): BodyComparison {
  const t = sideOf(text);
  const h = sideOf(htmlText);
  const textDiff = direction(t, h);
  const htmlDiff = direction(h, t);
  // Moneda cambiada: cada versión nombra una que la otra no («EUR 1,200.00» contra «USD 1,200.00»).
  // Que una sola versión la nombre («$1,200» contra «USD 1,200») no cuenta.
  const currency =
    htmlDiff.ownCurrencies.length > 0 && textDiff.ownCurrencies.length > 0
      ? [`el HTML dice ${examples(htmlDiff.ownCurrencies, true)} y el texto ${examples(textDiff.ownCurrencies, true)} (otra moneda)`]
      : [];
  return {
    text: textDiff,
    html: htmlDiff,
    htmlAddsContent: htmlDiff.ownWords.length > 0 || htmlDiff.ownFigures.length > 0,
    reasons: [...reasonsFor(htmlDiff, "el HTML", "el texto"), ...reasonsFor(textDiff, "el texto", "el HTML"), ...currency],
  };
}
