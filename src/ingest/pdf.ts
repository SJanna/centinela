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

/**
 * Une los fragmentos de texto de una página respetando líneas: PDF.js no siempre marca el fin de
 * línea, y unir sin separador pegaría palabras de renglones distintos ("1.200,00SYSTEM").
 */
export function pageItemsToText(items: StructuredTextItem[]): string {
  // Se arma en un arreglo y se recuerda el último carácter: mirar el texto acumulado en cada
  // fragmento (/\s$/.test(out)) era cuadrático y una página con cientos de miles de fragmentos
  // colgaba el servidor.
  const out: string[] = [];
  let lastChar = "";
  const emit = (s: string) => {
    if (s === "") return;
    out.push(s);
    lastChar = s[s.length - 1];
  };
  let prev: StructuredTextItem | null = null;
  for (const item of items) {
    if (prev && !prev.hasEOL && item.str !== "") {
      const tolerance = Math.max(1, Math.min(item.fontSize || 1, prev.fontSize || 1) * 0.5);
      const sameLine = Math.abs(item.y - prev.y) <= tolerance;
      if (!sameLine) {
        if (lastChar !== "\n") emit("\n");
      } else {
        const gap = item.x - (prev.x + prev.width);
        const needsSpace = gap > Math.max(0.5, (prev.fontSize || 1) * 0.15);
        if (needsSpace && !/\s/.test(lastChar) && !/^\s/.test(item.str)) emit(" ");
      }
    }
    emit(item.str);
    if (item.hasEOL) emit("\n");
    if (item.str !== "" || item.hasEOL) prev = item;
  }
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
