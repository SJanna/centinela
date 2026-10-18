/**
 * Utilidades de texto de la entrada: decodificación, limpieza y HTML → texto.
 * Todo puro, sin dependencias.
 */

export type TextEncodingName = "utf-8" | "utf-16le" | "utf-16be" | "windows-1252";

export interface DecodedText {
  text: string;
  encoding: TextEncodingName;
}

/** Más de esta proporción de caracteres de control ⇒ es binario, no texto. */
const MAX_CONTROL_RATIO = 0.01;

/**
 * Decodifica bytes como texto. Devuelve null si parecen binarios.
 * UTF-8 primero (quita BOM); UTF-16 solo con BOM; si no es UTF-8 válido, Windows-1252 (Latin-1).
 */
export function decodeText(bytes: Uint8Array): DecodedText | null {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return accept(new TextDecoder("utf-16le").decode(bytes), "utf-16le");
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return accept(new TextDecoder("utf-16be").decode(bytes), "utf-16be");
  }
  if (bytes.includes(0)) return null;
  try {
    return accept(new TextDecoder("utf-8", { fatal: true }).decode(bytes), "utf-8");
  } catch {
    return accept(new TextDecoder("windows-1252").decode(bytes), "windows-1252");
  }
}

function accept(text: string, encoding: TextEncodingName): DecodedText | null {
  let controls = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    const isControl =
      (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d && c !== 0x0c && c !== 0x0b && c !== 0x1b) ||
      c === 0x7f ||
      (c >= 0x80 && c <= 0x9f);
    if (isControl) controls++;
  }
  if (text.length > 0 && controls / text.length > MAX_CONTROL_RATIO) return null;
  return { text, encoding };
}

/**
 * Caracteres invisibles que se quitan del texto: controles, espacios de ancho cero, marcas y
 * forzados de dirección (incluye la marca U+200E que mete WhatsApp), BOM y guion blando.
 * Se conservan U+200C/U+200D (los usan los emojis compuestos).
 */
const INVISIBLE =
  /[\u0000-\u0008\u000E-\u001F\u007F\u00AD\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

/** Invisibles que suelen usarse para esconder o camuflar texto (no cuenta los de WhatsApp). */
const SUSPICIOUS_INVISIBLE = /[\u200B\u202A-\u202E\u2060-\u2064\u2066-\u2069]/g;

/**
 * Racha de caracteres «etiqueta» Unicode (U+E0000–U+E007F), opcionalmente tras 🏴. Son invisibles
 * para una persona, pero U+E0020–U+E007E equivalen uno a uno a ASCII y un modelo los lee como
 * texto: sirven para esconder instrucciones («ASCII smuggling»).
 */
const TAG_RUN = /(\u{1F3F4})?([\u{E0000}-\u{E007F}]+)/gu;
/** Bandera de subdivisión (🏴 + letras o dígitos etiqueta + cancelar): su único uso legítimo. */
const FLAG_TAGS = /^[\u{E0030}-\u{E0039}\u{E0061}-\u{E007A}]{1,6}\u{E007F}$/u;

/** Cuántos caracteres invisibles «sospechosos» trae el texto (antes de limpiarlo). */
export function countSuspiciousInvisible(text: string): number {
  let count = text.match(SUSPICIOUS_INVISIBLE)?.length ?? 0;
  for (const m of text.matchAll(TAG_RUN)) {
    if (!(m[1] && FLAG_TAGS.test(m[2]))) count += [...m[2]].length;
  }
  return count;
}

/**
 * Vuelve visible el texto escondido con caracteres etiqueta (U+E0041 → «A»), separado con espacios
 * de lo que lo rodea, para que el modelo lo vea como texto normal y el detector de instrucciones
 * escondidas lo encuentre. Conserva las banderas de subdivisiones.
 */
export function revealTagCharacters(text: string): string {
  return text.replace(TAG_RUN, (whole: string, flag: string | undefined, run: string) => {
    if (flag && FLAG_TAGS.test(run)) return whole;
    let decoded = "";
    for (const ch of run) {
      const ascii = (ch.codePointAt(0) ?? 0) - 0xe0000;
      if (ascii >= 0x20 && ascii <= 0x7e) decoded += String.fromCharCode(ascii);
    }
    return `${flag ?? ""}${decoded.trim() === "" ? "" : ` ${decoded} `}`;
  });
}

/** ¿Es espacio horizontal (espacio, tabulación o espacio duro)? */
function isBlank(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0xa0;
}

/** Quita espacios, tabulaciones y espacios duros al principio (start) y/o al final (end) de una línea. */
function trimBlanks(line: string, start: boolean, end: boolean): string {
  let a = 0;
  let b = line.length;
  if (start) while (a < b && isBlank(line.charCodeAt(a))) a++;
  if (end) while (b > a && isBlank(line.charCodeAt(b - 1))) b--;
  return a === 0 && b === line.length ? line : line.slice(a, b);
}

/**
 * Limpia texto para el modelo y para comparar citas: revela el texto escondido con caracteres
 * etiqueta, quita invisibles, unifica saltos de línea, convierte tabulación vertical y salto de
 * página en salto de línea, quita espacios al final de cada línea, colapsa más de dos líneas vacías
 * seguidas y normaliza a NFC.
 *
 * Todo en tiempo lineal: expresiones como /[ \t]+$/gm o /\s+$/ son cuadráticas con una racha larga
 * de espacios en medio de una línea (100 000 espacios ⇒ ~20 s) y colgaban el servidor.
 */
export function cleanText(raw: string): string {
  const unified = revealTagCharacters(raw)
    .replace(/\r\n?/g, "\n")
    .replace(/[\u000B\u000C\u2028\u2029]/g, "\n")
    .replace(INVISIBLE, "");
  return unified
    .split("\n")
    .map((line) => trimBlanks(line, false, true))
    .join("\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .normalize("NFC")
    .replace(/^\n+/, "")
    .trimEnd();
}

/**
 * HTML → texto plano: en html.ts (lo que algún cliente de correo o navegador puede mostrar, también
 * comentarios condicionales de Outlook, texto generado con CSS y entidades sin «;»).
 */
export { htmlToText } from "./html";
