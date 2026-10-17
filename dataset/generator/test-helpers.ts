/**
 * Ayudas compartidas por las pruebas del generador (generación en memoria, una vez por archivo).
 */
import { simpleParser } from "mailparser";
import { extractText, getDocumentProxy } from "unpdf";
import { generateAll, type GeneratedCase } from "./build";

let cached: Promise<GeneratedCase[]> | null = null;

/** Genera todo en memoria (una sola vez por archivo de pruebas). */
export function generatedCases(): Promise<GeneratedCase[]> {
  cached ??= generateAll();
  return cached;
}

export async function pdfText(bytes: Buffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

/** Texto visible de un archivo del dataset (PDF: capa de texto; correo: cuerpo + adjunto; chat: tal cual). */
export async function documentText(c: GeneratedCase): Promise<string> {
  if (c.mediaType === "application/pdf") return pdfText(c.bytes);
  if (c.mediaType === "text/plain") return c.bytes.toString("utf8");
  if (c.mediaType === "message/rfc822") {
    const mail = await simpleParser(c.bytes);
    const parts = [mail.subject ?? "", typeof mail.text === "string" ? mail.text : ""];
    for (const att of mail.attachments) {
      if (att.contentType === "application/pdf") parts.push(await pdfText(att.content));
    }
    return parts.join("\n");
  }
  throw new Error(`${c.caseId}: ${c.mediaType} no tiene capa de texto`);
}

/** Espacios colapsados (la extracción de PDF puede cambiar saltos de línea por espacios). */
export function squash(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}
