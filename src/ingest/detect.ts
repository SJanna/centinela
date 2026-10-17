/**
 * Detección del formato de un archivo: bytes mágicos primero, después extensión / mediaType
 * y, para texto, el contenido (cabeceras de correo, líneas de chat).
 */
import { IngestError, unsupported } from "./errors";
import { cleanText, countSuspiciousInvisible, decodeText, htmlToText, type TextEncodingName } from "./text";

export type NativeImageMediaType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

export type Detected =
  | { kind: "pdf"; mediaType: "application/pdf" }
  /** native = el modelo la acepta tal cual; si no, hay que convertirla a JPEG (TIFF, AVIF, HEIC). */
  | { kind: "image"; mediaType: NativeImageMediaType; native: true }
  | { kind: "image"; mediaType: "image/tiff" | "image/avif" | "image/heic"; native: false }
  | { kind: "email"; mediaType: "message/rfc822" }
  | {
      kind: "chat" | "text";
      mediaType: string;
      /** Texto ya limpio (y convertido si era HTML). */
      text: string;
      encoding: TextEncodingName;
      /** Participantes detectados en un chat, en orden de aparición. */
      participants: string[];
      /** Caracteres invisibles sospechosos que traía el original. */
      suspiciousInvisible: number;
    };

// ───────────────────────── Bytes mágicos ─────────────────────────

type Magic =
  | { type: "pdf" }
  | { type: "image"; mediaType: NativeImageMediaType }
  | { type: "convertible"; mediaType: "image/tiff" | "image/avif" | "image/heic" }
  | { type: "known_unsupported"; description: string; hint?: string };

function startsWith(bytes: Uint8Array, sig: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (bytes[offset + i] !== sig[i]) return false;
  return true;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  let s = "";
  for (let i = start; i < Math.min(end, bytes.length); i++) s += String.fromCharCode(bytes[i]);
  return s;
}

/** Busca "%PDF-" en los primeros 1024 bytes (los lectores de PDF toleran basura al inicio). */
function pdfOffset(bytes: Uint8Array): number {
  const limit = Math.min(bytes.length - 5, 1024);
  for (let i = 0; i <= limit; i++) {
    if (bytes[i] === 0x25 && bytes[i + 1] === 0x50 && bytes[i + 2] === 0x44 && bytes[i + 3] === 0x46 && bytes[i + 4] === 0x2d) {
      return i;
    }
  }
  return -1;
}

const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1"]);
const AVIF_BRANDS = new Set(["avif", "avis"]);

export function sniffMagic(bytes: Uint8Array, ext: string): Magic | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { type: "pdf" };
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { type: "image", mediaType: "image/png" };
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { type: "image", mediaType: "image/jpeg" };
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return { type: "image", mediaType: "image/webp" };
  if (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a") return { type: "image", mediaType: "image/gif" };
  if (startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) || startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a])) {
    return { type: "convertible", mediaType: "image/tiff" };
  }
  if (ascii(bytes, 4, 8) === "ftyp") {
    const brands = [ascii(bytes, 8, 12)];
    const boxSize = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
    for (let o = 16; o + 4 <= Math.min(boxSize, 64); o += 4) brands.push(ascii(bytes, o, o + 4));
    if (brands.some((b) => AVIF_BRANDS.has(b))) return { type: "convertible", mediaType: "image/avif" };
    if (brands.some((b) => HEIC_BRANDS.has(b))) return { type: "convertible", mediaType: "image/heic" };
    return { type: "known_unsupported", description: "video o audio" };
  }
  // Basura antes de %PDF- solo si además dice ser PDF.
  if (ext === "pdf" && pdfOffset(bytes) > 0) return { type: "pdf" };

  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])) {
    const office: Record<string, string> = {
      docx: "documento de Word (.docx)",
      xlsx: "hoja de cálculo de Excel (.xlsx)",
      pptx: "presentación de PowerPoint (.pptx)",
      odt: "documento de texto (.odt)",
      ods: "hoja de cálculo (.ods)",
    };
    if (office[ext]) return { type: "known_unsupported", description: office[ext], hint: "Expórtalo como PDF y súbelo de nuevo." };
    return { type: "known_unsupported", description: "archivo comprimido (.zip)", hint: "Descomprímelo y sube la factura directamente." };
  }
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    if (ext === "msg") {
      return {
        type: "known_unsupported",
        description: "correo de Outlook (.msg)",
        hint: "Guarda el correo como .eml o reenvíalo con la factura adjunta.",
      };
    }
    return { type: "known_unsupported", description: "documento de Office antiguo", hint: "Expórtalo como PDF y súbelo de nuevo." };
  }
  if (ascii(bytes, 0, 6) === "Rar!\u001a\u0007") return { type: "known_unsupported", description: "archivo comprimido (.rar)", hint: "Descomprímelo y sube la factura directamente." };
  if (startsWith(bytes, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return { type: "known_unsupported", description: "archivo comprimido (.7z)", hint: "Descomprímelo y sube la factura directamente." };
  if (startsWith(bytes, [0x1f, 0x8b])) return { type: "known_unsupported", description: "archivo comprimido (.gz)", hint: "Descomprímelo y sube la factura directamente." };
  if (ascii(bytes, 0, 2) === "BM" && bytes.length > 26 && [12, 40, 52, 56, 64, 108, 124].includes(bytes[14]) && bytes[15] === 0) {
    return { type: "known_unsupported", description: "imagen BMP", hint: "Guárdala como PNG o JPG y súbela de nuevo." };
  }
  if (ascii(bytes, 0, 5) === "{\\rtf") return { type: "known_unsupported", description: "documento RTF", hint: "Expórtalo como PDF y súbelo de nuevo." };
  if (ascii(bytes, 0, 4) === "%!PS") return { type: "known_unsupported", description: "archivo PostScript", hint: "Conviértelo a PDF y súbelo de nuevo." };
  return null;
}

// ───────────────────────── Nombre y tipo declarado ─────────────────────────

export function extensionOf(filename: string): string {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(filename.trim());
  return m ? m[1].toLowerCase() : "";
}

/** "text/plain; charset=utf-8" → "text/plain". Los genéricos cuentan como sin pista. */
function normalizeMediaType(mediaType: string | undefined): string {
  const mt = (mediaType ?? "").split(";")[0].trim().toLowerCase();
  if (mt === "application/octet-stream" || mt === "binary/octet-stream" || mt === "application/unknown") return "";
  return mt;
}

const BINARY_EXTENSIONS: Record<string, string> = {
  pdf: "PDF",
  png: "imagen PNG",
  jpg: "imagen JPG",
  jpeg: "imagen JPG",
  webp: "imagen WEBP",
  gif: "imagen GIF",
  tif: "imagen TIFF",
  tiff: "imagen TIFF",
  heic: "foto HEIC",
  heif: "foto HEIF",
  avif: "imagen AVIF",
};

const TEXT_MEDIA_BY_EXT: Record<string, string> = {
  txt: "text/plain",
  text: "text/plain",
  log: "text/plain",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  md: "text/markdown",
  json: "application/json",
  xml: "application/xml",
  html: "text/html",
  htm: "text/html",
};

// ───────────────────────── Correo ─────────────────────────

const STRONG_EMAIL_HEADERS = new Set([
  "from",
  "mime-version",
  "received",
  "return-path",
  "message-id",
  "delivered-to",
  "dkim-signature",
  "arc-seal",
  "authentication-results",
]);

const KNOWN_EMAIL_HEADERS = new Set([
  ...STRONG_EMAIL_HEADERS,
  "to",
  "cc",
  "bcc",
  "subject",
  "date",
  "sent",
  "reply-to",
  "sender",
  "content-type",
  "content-transfer-encoding",
  "in-reply-to",
  "references",
  "thread-topic",
  "thread-index",
  "importance",
]);

const HEADER_LINE = /^([!-9;-~]+):(?:[ \t]|$)/;

/**
 * ¿El texto empieza con un bloque de cabeceras de correo? Exige que todas las líneas hasta la
 * primera vacía sean cabeceras, al menos dos conocidas y al menos una fuerte (From, MIME-Version,
 * Received…), para no confundir una factura en texto («Fecha: …», «Total: …») con un correo.
 */
export function looksLikeEmail(text: string): boolean {
  const lines = text.split("\n");
  let i = 0;
  if (lines[0]?.startsWith("From ")) i = 1; // formato mbox
  let headers = 0;
  let known = 0;
  let strong = 0;
  for (; i < lines.length && i < 300; i++) {
    const line = lines[i];
    if (line.trim() === "") break;
    if (/^[ \t]/.test(line) && headers > 0) continue; // cabecera plegada
    const m = HEADER_LINE.exec(line);
    if (!m) return false;
    headers++;
    const name = m[1].toLowerCase();
    if (KNOWN_EMAIL_HEADERS.has(name) || name.startsWith("x-")) known++;
    if (STRONG_EMAIL_HEADERS.has(name)) strong++;
  }
  return headers > 0 && strong >= 1 && known >= 2;
}

// ───────────────────────── Chat ─────────────────────────

const DATE = String.raw`(?:\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}|\d{4}-\d{2}-\d{2})`;
const TIME = String.raw`\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]\.?\s*m\.?)?`;
const SPEAKER = String.raw`([^:\n\]]{1,60}?)`;

/** Líneas de chat con fecha y hora: WhatsApp iOS, Android y copiado desde WhatsApp Web. */
const TIMESTAMPED_LINES: RegExp[] = [
  // [20/10/26, 9:41:05] Nombre: mensaje
  new RegExp(String.raw`^\[${DATE},?\s+${TIME}\]\s*${SPEAKER}:(?:\s|$)`, "i"),
  // 20/10/2026 09:41 - Nombre: mensaje · 20/10/26, 9:41 a. m. - Nombre: mensaje
  new RegExp(String.raw`^${DATE},?\s+${TIME}\s+[-–]\s+${SPEAKER}:(?:\s|$)`, "i"),
  // [9:41 a. m., 20/10/2026] Nombre: mensaje
  new RegExp(String.raw`^\[${TIME},\s*${DATE}\]\s*${SPEAKER}:(?:\s|$)`, "i"),
];

/** «Nombre: mensaje» sin fecha. */
const SPEAKER_LINE = /^([\p{L}][\p{L}\p{M}\p{N} .'’_-]{0,40}?):\s+\S/u;

/** Claves típicas de una factura en texto: «Total: …» no es una persona hablando. */
const FIELD_WORDS = new Set(
  (
    "total subtotal iva igv icms iss impuesto impuestos tax taxes vat banco bank cuenta account conta fecha date data " +
    "cantidad quantity descripcion description descricao nombre name nit rut rfc cuit cnpj cpf ruc moneda currency moeda " +
    "concepto valor value precio price preco tarifa rate horas hours periodo period factura invoice fatura numero number " +
    "no nro vence vencimiento due swift aba routing iban clabe cbu beneficiario beneficiary direccion address telefono phone " +
    "email correo ciudad city pais country cliente client customer proveedor vendor supplier nota notas note notes " +
    "observaciones referencia reference monto importe amount de para asunto from to subject cc bcc emisor receptor " +
    "item items detalle servicio servicios service services unidad unidades unit units dias days mes month ano year " +
    "codigo code tipo type estado status saldo balance pago payment pagos forma metodo method plazo terminos terms " +
    "contacto contact empresa company razon social attn atencion re fwd rv datos retencion descuento neto bruto base " +
    "anticipo abono cuota interes mora agencia vencimento pix chave tomador prestador servico bill billing remit " +
    "remittance attention po orden order pedido"
  ).split(" "),
);

function normalizeKey(key: string): string {
  return key
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * ¿«Clave» es un campo de factura y no una persona? Mira la primera y la última palabra
 * («Fecha de emisión», «Valor total»), así «María de los Ángeles» sigue siendo una persona.
 */
function isFieldKey(key: string): boolean {
  const norm = normalizeKey(key);
  if (!norm) return true;
  const words = norm.split(" ");
  if (words.length > 4) return true;
  if (words.some((w) => /^\d+$/.test(w))) return true;
  return FIELD_WORDS.has(words[0]) || FIELD_WORDS.has(words[words.length - 1]);
}

export interface ChatAnalysis {
  isChat: boolean;
  participants: string[];
}

/**
 * ¿El texto es una conversación? Sí si hay líneas de chat con fecha y hora (dos o más, o la
 * primera línea), si el nombre del archivo lo dice (export de WhatsApp) o si hay líneas
 * «Nombre: mensaje» que se repiten entre al menos dos personas.
 */
export function analyzeChat(text: string, filename = ""): ChatAnalysis {
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  const timestampedSpeakers: string[] = [];
  let firstLineTimestamped = false;
  lines.forEach((line, idx) => {
    for (const re of TIMESTAMPED_LINES) {
      const m = re.exec(line.trim());
      if (m) {
        timestampedSpeakers.push(m[1].trim());
        if (idx === 0) firstLineTimestamped = true;
        break;
      }
    }
  });
  const filenameSaysChat = /whats ?app|chat|telegram|conversaci[oó]n|mensajes/i.test(filename);

  if (timestampedSpeakers.length >= 2 || (timestampedSpeakers.length === 1 && firstLineTimestamped)) {
    return { isChat: true, participants: uniqueInOrder(timestampedSpeakers) };
  }

  const speakers: string[] = [];
  for (const line of lines) {
    const m = SPEAKER_LINE.exec(line.trim());
    if (m && !isFieldKey(m[1])) speakers.push(m[1].trim());
  }
  const distinct = uniqueInOrder(speakers);
  const repeatedConversation =
    speakers.length >= 3 &&
    distinct.length >= 2 &&
    speakers.length / distinct.length >= 1.5 &&
    speakers.length >= 0.3 * lines.length;
  if (repeatedConversation) return { isChat: true, participants: distinct };
  if (filenameSaysChat) return { isChat: true, participants: uniqueInOrder([...timestampedSpeakers, ...distinct]) };
  return { isChat: false, participants: [] };
}

function uniqueInOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const key = v.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(v);
    }
  }
  return out.slice(0, 20);
}

// ───────────────────────── Detección completa ─────────────────────────

/**
 * Decide qué es el archivo. Lanza IngestError si no se puede leer.
 * Orden: bytes mágicos → extensión / mediaType declarado → contenido del texto.
 */
export function detectFormat(bytes: Uint8Array, filename: string, mediaType?: string): Detected {
  const ext = extensionOf(filename);
  const hint = normalizeMediaType(mediaType);

  const magic = sniffMagic(bytes, ext);
  if (magic) {
    switch (magic.type) {
      case "pdf":
        return { kind: "pdf", mediaType: "application/pdf" };
      case "image":
        return { kind: "image", mediaType: magic.mediaType, native: true };
      case "convertible":
        return { kind: "image", mediaType: magic.mediaType, native: false };
      case "known_unsupported":
        throw unsupported(`${magic.description} («${filename}»)`, magic.hint);
    }
  }

  // SVG es texto, pero es una imagen: sin esto se leía como texto o se rechazaba como «dañado»
  // según el tipo que mandara el navegador.
  if (ext === "svg" || ext === "svgz" || hint === "image/svg+xml") {
    throw unsupported(`imagen SVG («${filename}»)`, "Guárdala como PNG o PDF y súbela de nuevo.");
  }

  // Sin firma conocida: dice ser binario (PDF, imagen) pero no lo es.
  const declaredBinary =
    BINARY_EXTENSIONS[ext] ??
    (hint === "application/pdf" ? "PDF" : hint.startsWith("image/") ? `imagen (${hint})` : undefined);
  if (declaredBinary) {
    throw new IngestError(
      `El archivo «${filename}» dice ser ${declaredBinary} pero su contenido no lo es: puede estar dañado o tener la extensión equivocada.`,
      "corrupt",
    );
  }
  const decoded = decodeText(bytes);
  if (!decoded) {
    throw unsupported(`«${filename}» no es un PDF, una imagen, un correo ni un texto que se pueda leer`);
  }

  const suspiciousInvisible = countSuspiciousInvisible(decoded.text);
  const text = cleanText(decoded.text);

  if (ext === "eml" || hint === "message/rfc822" || looksLikeEmail(text)) {
    return { kind: "email", mediaType: "message/rfc822" };
  }

  const isHtml =
    ext === "html" || ext === "htm" || hint === "text/html" || /^\s*(<!doctype html|<html[\s>])/i.test(text.slice(0, 512));
  if (isHtml) {
    return {
      kind: "text",
      mediaType: "text/html",
      text: cleanText(htmlToText(text)),
      encoding: decoded.encoding,
      participants: [],
      suspiciousInvisible,
    };
  }

  const isXml = ext === "xml" || hint === "application/xml" || hint === "text/xml" || /^\s*<\?xml\s/i.test(text.slice(0, 128));
  const textMediaType = isXml
    ? "application/xml"
    : TEXT_MEDIA_BY_EXT[ext] ?? (hint.startsWith("text/") ? hint : "text/plain");

  if (!isXml) {
    const chat = analyzeChat(text, filename);
    if (chat.isChat) {
      return { kind: "chat", mediaType: "text/plain", text, encoding: decoded.encoding, participants: chat.participants, suspiciousInvisible };
    }
  }
  return { kind: "text", mediaType: textMediaType, text, encoding: decoded.encoding, participants: [], suspiciousInvisible };
}
