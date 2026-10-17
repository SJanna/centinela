/**
 * Texto de un PDF sin modelo (unpdf / PDF.js). Incluye el texto oculto (blanco, diminuto, fuera
 * de la página) y el de anotaciones y campos de formulario: es deseable, porque el detector de
 * instrucciones escondidas debe verlo y las citas del lector deben poder encontrarse.
 */
import { extractTextItems, getDocumentProxy, type StructuredTextItem } from "unpdf";
import { IngestError } from "./errors";
import { MAX_PDF_PAGES } from "./limits";
import { cleanText } from "./text";

export interface PdfText {
  /** Páginas del PDF. null si PDF.js no pudo abrirlo. */
  pages: number | null;
  /** Texto de todas las páginas unido con saltos de línea. null si no hay capa de texto o falló. */
  text: string | null;
}

function isPasswordError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const name = (err as { name?: unknown }).name;
  const message = (err as { message?: unknown }).message;
  return name === "PasswordException" || (typeof message === "string" && /password/i.test(message));
}

// ───────────────────────── Fragmentos → texto ─────────────────────────
//
// Medidas en fracciones del tamaño de letra del fragmento más chico de cada par: un espacio real
// mide ~0,25–0,33 del tamaño (Helvetica 0,278; Times 0,25) y el espaciado entre letras de un título
// (tracking) suele quedar por debajo de 0,15.

/** Hueco desde el que dos fragmentos de la misma línea se separan con un espacio. */
const SPACE_GAP = 0.2;
/** Retroceso desde el que el fragmento siguiente no continúa al anterior (otra columna, texto encima). */
const BACKTRACK_GAP = 0.5;
/** Hueco máximo entre letras sueltas de un mismo título espaciado (más lejos es otra columna). */
const MAX_LETTER_GAP = 3;
/** En un título espaciado, cuánto más que el hueco entre letras debe medir el hueco entre palabras. */
const WORD_GAP_SLACK = 0.2;
/** Mínimo de letras sueltas seguidas para tratarlas como un título espaciado. */
const MIN_SPACED_LETTERS = 3;

/** Tamaño de letra de un fragmento: el de su matriz (fontSize) o, si falta, su alto. */
function sizeOf(item: StructuredTextItem): number {
  if (item.fontSize > 0) return item.fontSize;
  return item.height > 0 ? item.height : 1;
}

function isBlankStr(s: string): boolean {
  return s.trim() === "";
}

const SINGLE_LETTER = /^\p{L}\p{M}*$/u;
/** Trozo de un título espaciado: 1 a 4 letras (las que el kerning dejó juntas: "TO", "RVAC"). */
const LETTER_CLUSTER = /^(?:\p{L}\p{M}*){1,4}$/u;
const CLOSING_PUNCTUATION = /^[:;,.]$/;

/** Todo en mayúsculas (y con alguna letra que tenga caja): "TOTA L A PAG A R" sí, "Plan A B C" no. */
function isUppercase(letters: string): boolean {
  return letters === letters.toUpperCase() && letters !== letters.toLowerCase();
}

/**
 * Une las letras de un título espaciado DENTRO de un fragmento. PDF.js arma un solo fragmento con
 * todo el título y, cuando el espaciado entre letras supera ~0,1 del tamaño de letra, mete él mismo
 * un espacio entre casi cada par ("TOTA L A PAG A R": solo quedan juntas las que el kerning acerca).
 * El fragmento ya no trae la posición de cada letra, así que el espacio real entre palabras no se
 * distingue del agregado: el tramo sale unido ("OBSERVACIONES", "TOTALAPAGAR"), que se lee y se busca
 * mejor que partido. Un tramo cuenta si tiene 3+ trozos de 1–4 letras separados por un solo espacio,
 * al menos 3 letras sueltas (y la mitad de los trozos) y todo en MAYÚSCULAS (los títulos; el texto
 * en minúsculas o mixto con letras sueltas queda como lo dio PDF.js y el detector de instrucciones
 * lo une por su cuenta). Un signo final suelto («S O N :») se pega. Tiempo lineal.
 *
 * El tramo termina en su última letra suelta: PDF.js deja en el mismo fragmento el texto sin espaciar
 * que sigue al título con la misma fuente ("TOTA L A PAG A R USD 2.400,00"), y esas palabras de 2+
 * letras no son del título. Pegarlas borraría la moneda como palabra ("TOTALAPAGARUSD") o partiría una
 * instrucción ("TOTALAPAGARSKIPALL CHECKS"). Un título que termina en dos letras juntas por el kerning
 * ("C U E N TA") queda "CUEN TA": se pierde algo de lectura, nunca una palabra ajena.
 */
export function joinSpacedLetters(str: string): string {
  if (!str.includes(" ")) return str;
  const tokens = str.split(" ");
  const out: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    // Tramo candidato: trozos de letras seguidos, separados por un solo espacio (split por " ";
    // dos espacios dejan un trozo vacío y cortan el tramo). Se evalúa el tramo entero y se sigue
    // después de él: cada trozo se mira una vez.
    let j = i;
    while (j < tokens.length && LETTER_CLUSTER.test(tokens[j])) j++;
    if (j === i) {
      out.push(tokens[i]);
      i += 1;
      continue;
    }
    // Fin del título: después de la última letra suelta del tramo.
    let end = j;
    while (end > i && !SINGLE_LETTER.test(tokens[end - 1])) end--;
    if (end - i >= MIN_SPACED_LETTERS && isSpacedRun(tokens, i, end)) {
      const joined = tokens.slice(i, end).join("");
      if (end === j && j < tokens.length && CLOSING_PUNCTUATION.test(tokens[j])) {
        out.push(joined + tokens[j]);
        j++;
      } else {
        out.push(joined);
        for (let k = end; k < j; k++) out.push(tokens[k]);
      }
    } else {
      for (let k = i; k < j; k++) out.push(tokens[k]);
    }
    i = j;
  }
  return out.join(" ");
}

function isSpacedRun(tokens: readonly string[], start: number, end: number): boolean {
  let singles = 0;
  for (let k = start; k < end; k++) if (SINGLE_LETTER.test(tokens[k])) singles++;
  return singles >= MIN_SPACED_LETTERS && singles * 2 >= end - start && isUppercase(tokens.slice(start, end).join(""));
}

interface Piece {
  item: StructuredTextItem;
  text: string;
  /** Fragmentos en blanco de PDF.js entre el anterior y este (un hueco ancho o un espacio real). */
  blanks: string;
}

/**
 * Separador entre dos fragmentos con texto de la misma línea, por la geometría: se unen si el hueco
 * es menor que SPACE_GAP del tamaño de letra; se separan si parece un espacio real o si el segundo
 * empieza antes de donde termina el primero (otra columna o texto superpuesto: "1.200,00" y un
 * "SYSTEM:" escondido encima no deben quedar pegados).
 */
function separatorBetween(a: Piece, b: Piece): string {
  if (/\s$/.test(a.text) || /^\s/.test(b.text)) return b.blanks;
  if (b.blanks !== "") return b.blanks;
  const gap = (b.item.x - (a.item.x + a.item.width)) / Math.min(sizeOf(a.item), sizeOf(b.item));
  const ltr = a.item.dir !== "rtl" && b.item.dir !== "rtl";
  if (gap > SPACE_GAP || (ltr && gap < -BACKTRACK_GAP)) return " ";
  return "";
}

/**
 * Texto de una línea. Además de la regla general, reconoce un título con letras muy espaciadas que
 * PDF.js entrega letra por letra (hueco > 0,6 del tamaño: cada letra es un fragmento, con fragmentos
 * en blanco entre ellas): dentro de ese tramo el hueco más chico es el que hay entre letras y uno
 * claramente mayor (≥ hueco mínimo + WORD_GAP_SLACK) es un espacio entre palabras. Aquí sí hay
 * geometría por letra, así que las palabras salen separadas ("TOTAL A PAGAR"), en cualquier caja.
 */
function lineToText(items: readonly StructuredTextItem[]): string {
  const pieces: Piece[] = [];
  let lead = "";
  let blanks = "";
  for (const item of items) {
    if (isBlankStr(item.str)) {
      blanks += item.str;
      continue;
    }
    if (pieces.length === 0) lead = blanks;
    pieces.push({ item, text: joinSpacedLetters(item.str), blanks: pieces.length === 0 ? "" : blanks });
    blanks = "";
  }
  if (pieces.length === 0) return lead + blanks;

  const seps = new Array<string>(pieces.length).fill("");
  for (let i = 1; i < pieces.length; i++) seps[i] = separatorBetween(pieces[i - 1], pieces[i]);

  // Tramos de letras sueltas (cada una su fragmento), con huecos razonables entre ellas.
  const gapOf = (i: number) => {
    const a = pieces[i - 1].item;
    const b = pieces[i].item;
    return (b.x - (a.x + a.width)) / Math.min(sizeOf(a), sizeOf(b));
  };
  const isLetterPiece = (p: Piece) => p.item.dir !== "rtl" && SINGLE_LETTER.test(p.text.trim());
  const inRun = (gap: number) => gap >= -BACKTRACK_GAP && gap <= MAX_LETTER_GAP;
  let start = 0;
  while (start < pieces.length) {
    if (!isLetterPiece(pieces[start])) {
      start++;
      continue;
    }
    let end = start + 1;
    let minGap = Infinity;
    while (end < pieces.length && isLetterPiece(pieces[end]) && inRun(gapOf(end))) {
      minGap = Math.min(minGap, gapOf(end));
      end++;
    }
    if (end - start >= MIN_SPACED_LETTERS) {
      const letterGap = (k: number) => gapOf(k) <= minGap + WORD_GAP_SLACK;
      for (let k = start + 1; k < end; k++) seps[k] = letterGap(k) ? "" : " ";
      // Un signo suelto pegado a la última letra ("SYSTEM :" → "SYSTEM:").
      const next = pieces[end];
      if (next && CLOSING_PUNCTUATION.test(next.text.trim()) && inRun(gapOf(end)) && letterGap(end)) seps[end] = "";
    }
    start = end;
  }

  const out: string[] = [lead];
  for (let i = 0; i < pieces.length; i++) out.push(seps[i], pieces[i].text);
  out.push(blanks);
  return out.join("");
}

/**
 * Une los fragmentos de texto de una página respetando líneas: PDF.js no siempre marca el fin de
 * línea, y unir sin separador pegaría palabras de renglones distintos ("1.200,00SYSTEM"). Dentro de
 * una línea, el separador sale de la geometría de cada fragmento (posición, ancho y tamaño de letra):
 * ver lineToText y joinSpacedLetters.
 */
export function pageItemsToText(items: StructuredTextItem[]): string {
  // Se arma en un arreglo y se recuerda el último carácter: mirar el texto acumulado en cada
  // fragmento (/\s$/.test(out)) era cuadrático y una página con cientos de miles de fragmentos
  // colgaba el servidor. Cada fragmento entra una vez en una línea y cada línea se arma una vez.
  const out: string[] = [];
  let lastChar = "";
  const emit = (s: string) => {
    if (s === "") return;
    out.push(s);
    lastChar = s[s.length - 1];
  };
  let line: StructuredTextItem[] = [];
  const flushLine = () => {
    if (line.length === 0) return;
    emit(lineToText(line));
    line = [];
  };
  let prev: StructuredTextItem | null = null;
  for (const item of items) {
    if (prev && !prev.hasEOL && item.str !== "") {
      const tolerance = Math.max(1, Math.min(sizeOf(item), sizeOf(prev)) * 0.5);
      if (Math.abs(item.y - prev.y) > tolerance) {
        flushLine();
        if (lastChar !== "\n") emit("\n");
      }
    }
    if (item.str !== "") line.push(item);
    if (item.hasEOL) {
      flushLine();
      emit("\n");
    }
    if (item.str !== "" || item.hasEOL) prev = item;
  }
  flushLine();
  return out.join("");
}

/**
 * Texto de las anotaciones de una página (lo que devuelve PDF.js en getAnnotations): comentarios,
 * cuadros de texto y valores de campos de formulario llenados. No está en la capa de texto, pero
 * el modelo sí ve los cuadros de texto y los campos llenados: el detector de instrucciones y la
 * verificación de citas también deben verlos. Ignora enlaces y casillas.
 */
export function annotationTexts(annotations: readonly unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value !== "string") return;
    const text = value.trim();
    if (text === "" || seen.has(text)) return;
    seen.add(text);
    out.push(text);
  };
  const strOf = (value: unknown): unknown =>
    typeof value === "object" && value !== null ? (value as { str?: unknown }).str : undefined;

  for (const raw of annotations) {
    if (typeof raw !== "object" || raw === null) continue;
    const a = raw as Record<string, unknown>;
    add(strOf(a.contentsObj));
    add(strOf(a.richText));
    if (Array.isArray(a.textContent)) add(a.textContent.filter((s) => typeof s === "string").join("\n"));
    if (a.fieldType === "Tx" || a.fieldType === "Ch") {
      if (Array.isArray(a.fieldValue)) a.fieldValue.forEach(add);
      else add(a.fieldValue);
    }
  }
  return out;
}

type PdfProxy = Awaited<ReturnType<typeof getDocumentProxy>>;

/** Texto de las anotaciones de la página `pageNumber` (1…n). Si falla, ninguno. */
async function pageAnnotationTexts(pdf: PdfProxy, pageNumber: number): Promise<string[]> {
  try {
    const page = await pdf.getPage(pageNumber);
    return annotationTexts(await page.getAnnotations());
  } catch {
    return [];
  }
}

/**
 * Lee páginas y texto. Lanza IngestError si el PDF tiene contraseña o demasiadas páginas
 * (el modelo tampoco podría leerlo). Cualquier otro fallo deja text = null.
 */
export async function readPdf(bytes: Uint8Array, filename: string): Promise<PdfText> {
  let pdf: PdfProxy;
  try {
    // Copia: PDF.js puede transferir (y dejar inservible) el buffer que recibe.
    pdf = await getDocumentProxy(new Uint8Array(bytes), { isEvalSupported: false, verbosity: 0 });
  } catch (err) {
    if (isPasswordError(err)) {
      throw new IngestError(
        `El PDF «${filename}» está protegido con contraseña. Envía una copia sin contraseña.`,
        "encrypted",
      );
    }
    return { pages: null, text: null };
  }
  try {
    const pages = pdf.numPages;
    if (pages > MAX_PDF_PAGES) {
      throw new IngestError(
        `El PDF «${filename}» tiene ${pages} páginas y el máximo es ${MAX_PDF_PAGES}. Envía solo las páginas de la factura.`,
        "too_many_pages",
      );
    }
    let text: string | null = null;
    try {
      const { items } = await extractTextItems(pdf);
      const pageTexts: string[] = [];
      for (const [index, pageItems] of items.entries()) {
        const body = pageItemsToText(pageItems);
        const notes = await pageAnnotationTexts(pdf, index + 1);
        pageTexts.push(notes.length > 0 ? [body.trimEnd(), ...notes].join("\n") : body);
      }
      const joined = cleanText(pageTexts.join("\n"));
      text = joined.trim() === "" ? null : joined;
    } catch {
      text = null;
    }
    return { pages, text };
  } finally {
    await pdf.destroy().catch(() => undefined);
  }
}
