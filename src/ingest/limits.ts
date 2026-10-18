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

/**
 * Lado largo (px) al que se reduce una imagen para medir su nitidez (1200 × 1600 en una foto vertical
 * 3:4; igual girada). Una imagen más chica se mide a su tamaño.
 */
export const SHARPNESS_SIDE = 1600;

/**
 * Nitidez mínima (varianza del laplaciano a SHARPNESS_SIDE px). Por debajo, la entrada deja el aviso
 * `blurry_image` y la factura nunca se paga sola. En el set de estrés las fotos con el total borroso
 * miden 49–107 y las demás 181 o más (ver src/ingest/sharpness.ts).
 */
export const MIN_IMAGE_SHARPNESS = 120;

/**
 * Páginas de un PDF escaneado (sin capa de texto) cuya nitidez se mide: la imagen más grande de cada
 * una, si mide al menos MIN_SCANNED_PAGE_SIDE px de lado largo. PDF.js decodifica cada imagen (~0,7 s
 * por página): las demás páginas no se miden.
 */
export const MAX_SHARPNESS_PDF_PAGES = 3;
export const MIN_SCANNED_PAGE_SIDE = 600;

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
