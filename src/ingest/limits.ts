/**
 * Límites y formatos aceptados de la entrada.
 * Este archivo no importa nada de Node: la pantalla puede usarlo (p. ej. en `<input accept>`).
 */

const MB = 1024 * 1024;

/** Tamaño máximo del archivo subido. */
export const MAX_FILE_BYTES = 15 * MB;

/** Por encima de este peso una imagen se reduce antes de enviarla al modelo (base64 < 5 MB). */
export const MAX_IMAGE_BYTES = 3.5 * MB;

/** Por encima de este lado (px) una imagen se reduce. */
export const MAX_IMAGE_SIDE = 2400;

/** Lado máximo (px) de una imagen reducida. */
export const RESIZED_IMAGE_SIDE = 2000;

/** Calidad JPEG de una imagen reducida. */
export const RESIZED_JPEG_QUALITY = 85;

/** Imágenes adjuntas a un correo con lado mayor por debajo de esto se ignoran (logos, firmas, píxeles de rastreo). */
export const MIN_ATTACHMENT_IMAGE_SIDE = 64;

/** Páginas máximas de un PDF (límite del modelo). */
export const MAX_PDF_PAGES = 100;

/** Adjuntos máximos que se procesan de un correo. */
export const MAX_EMAIL_ATTACHMENTS = 10;

/** Profundidad máxima de correos adjuntos dentro de correos. */
export const MAX_EMAIL_DEPTH = 2;

/** Valor para `<input type="file" accept>`. */
export const ACCEPT_ATTRIBUTE = [
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".tif",
  ".tiff",
  ".eml",
  ".txt",
  ".csv",
  ".xml",
  ".html",
  ".htm",
  "application/pdf",
  "image/*",
  "message/rfc822",
  "text/plain",
].join(",");

/** Frase para la pantalla: qué se puede subir. */
export const ACCEPTED_FORMATS_LABEL = "PDF, imagen (PNG, JPG, WEBP o GIF), correo (.eml) o texto (.txt, chat de WhatsApp)";

/** 16_986_931 → "16,2 MB" · 2048 → "2 KB". */
export function formatBytes(n: number): string {
  if (n >= MB) return `${(n / MB).toFixed(1).replace(".", ",")} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}
