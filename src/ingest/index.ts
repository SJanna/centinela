/**
 * Entrada: convierte cualquier archivo subido en un NormalizedDoc.
 *
 * - PDF → la parte PDF tal cual + texto plano con unpdf (incluye texto oculto). Sin capa de texto
 *   (escaneado), aviso si la imagen de alguna de las primeras páginas está borrosa.
 * - Imagen → la imagen (reducida a 2000 px / JPEG 85 si pesa > 3,5 MB o mide > 2400 px). Aviso
 *   (`warnings`) si la foto está borrosa (nitidez medida sin modelo por debajo del mínimo).
 * - Correo → texto con cabeceras y cuerpo (más la versión HTML si dice algo distinto), y cada adjunto
 *   como su propia parte. Avisos (`warnings`) si el HTML difiere de forma material del texto (o no
 *   tiene texto), si un adjunto no se pudo leer, si una foto adjunta está borrosa o si hay texto que
 *   se ve distinto de como se lee.
 * - Chat / texto → el texto limpio.
 *
 * Solo para el servidor (usa node:crypto, mailparser, unpdf y sharp).
 */
import type { DocPart, NormalizedDoc } from "@/core/schemas";
import { sha256Hex, toBase64 } from "./bytes";
import { detectFormat } from "./detect";
import { normalizeEmail } from "./email";
import { IngestError } from "./errors";
import { prepareImage } from "./image";
import { blurryImageWarning, blurryPageWarnings, isBlurry } from "./sharpness";
import { MAX_FILE_BYTES, formatBytes } from "./limits";
import { readPdf } from "./pdf";

export { IngestError, type IngestErrorCode } from "./errors";
export { sha256Hex } from "./bytes";
export { ACCEPT_ATTRIBUTE, ACCEPTED_FORMATS_LABEL, MAX_FILE_BYTES } from "./limits";

/**
 * "C:\\fakepath\\factura.pdf" → "factura.pdf". Nunca vacío. Quita controles e invisibles: un forzado
 * de dirección (U+202E) hace que «factura<RLO>fdp.exe» se vea como «facturaexe.pdf» en la pantalla.
 */
function displayName(filename: string): string {
  const base = (filename ?? "").split(/[\\/]/).pop()?.trim() ?? "";
  return base.replace(/[\u0000-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g, "").trim() || "archivo";
}

/**
 * Normaliza un archivo subido.
 * @param bytes contenido original (no se modifica).
 * @param filename nombre con que se subió (se usa como pista de formato y en los mensajes).
 * @param mediaType tipo declarado por el navegador o el correo (pista; mandan los bytes).
 * @throws IngestError con un mensaje en español apto para mostrar al usuario.
 */
export async function normalizeFile(bytes: Uint8Array, filename: string, mediaType?: string): Promise<NormalizedDoc> {
  const name = displayName(filename);
  if (bytes.byteLength === 0) {
    throw new IngestError(`El archivo «${name}» está vacío.`, "empty");
  }
  if (bytes.byteLength > MAX_FILE_BYTES) {
    throw new IngestError(
      `El archivo «${name}» pesa ${formatBytes(bytes.byteLength)} y el máximo es ${formatBytes(MAX_FILE_BYTES)}.`,
      "too_large",
    );
  }

  const fileHash = sha256Hex(bytes);
  const detected = detectFormat(bytes, name, mediaType);
  const meta: Record<string, string> = { sizeBytes: String(bytes.byteLength) };

  switch (detected.kind) {
    case "pdf": {
      const { pages, text, pageSharpness } = await readPdf(bytes, name);
      if (pages != null) meta.pages = String(pages);
      meta.textLayer = text ? "true" : "false";
      if (pageSharpness && pageSharpness.length > 0) {
        meta.pageSharpness = pageSharpness.map((p) => `${p.page}:${Math.round(p.sharpness)}`).join(" ");
      }
      const warnings = blurryPageWarnings(pageSharpness);
      return {
        fileHash,
        filename: name,
        mediaType: detected.mediaType,
        kind: "pdf",
        parts: [{ type: "pdf", base64: toBase64(bytes) }],
        plainText: text,
        meta,
        ...(warnings.length > 0 ? { warnings } : {}),
      };
    }

    case "image": {
      const img = await prepareImage(bytes, detected.mediaType, detected.native, name);
      return {
        fileHash,
        filename: name,
        mediaType: detected.mediaType,
        kind: "image",
        parts: [img.part],
        plainText: null,
        meta: { ...meta, ...img.meta },
        ...(img.sharpness != null && isBlurry(img.sharpness) ? { warnings: [blurryImageWarning(img.sharpness)] } : {}),
      };
    }

    case "email": {
      const email = await normalizeEmail(bytes, name);
      return {
        fileHash,
        filename: name,
        mediaType: detected.mediaType,
        kind: "email",
        parts: email.parts,
        plainText: email.plainText,
        meta: { ...meta, ...email.meta },
        warnings: email.warnings,
      };
    }

    case "chat":
    case "text": {
      if (detected.text.trim() === "") {
        throw new IngestError(`El archivo «${name}» no tiene texto.`, "empty");
      }
      meta.encoding = detected.encoding;
      if (detected.kind === "chat" && detected.participants.length > 0) {
        meta.participants = detected.participants.join(", ");
      }
      if (detected.suspiciousInvisible > 0) meta.invisibleChars = String(detected.suspiciousInvisible);
      const part: DocPart = { type: "text", label: detected.kind === "chat" ? "chat" : "texto", text: detected.text };
      return {
        fileHash,
        filename: name,
        mediaType: detected.mediaType,
        kind: detected.kind,
        parts: [part],
        plainText: detected.text,
        meta,
      };
    }
  }
}
