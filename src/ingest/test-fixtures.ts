/**
 * Generadores de archivos de prueba en memoria (solo para las pruebas de src/ingest).
 */
import { randomBytes } from "node:crypto";
import PDFDocument from "pdfkit";
import sharp from "sharp";

export interface PdfFixtureOptions {
  /** Líneas visibles por página. */
  pages?: string[][];
  /** Texto oculto (blanco y diminuto) en la primera página. */
  hidden?: string;
  /** Protege el PDF con contraseña de apertura. */
  userPassword?: string;
  /** Solo dibujos, sin capa de texto (como un escaneo). */
  noText?: boolean;
}

export function makePdf(opts: PdfFixtureOptions = {}): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      autoFirstPage: false,
      ...(opts.userPassword ? { userPassword: opts.userPassword, pdfVersion: "1.7" as const } : {}),
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    doc.on("error", reject);
    const pages = opts.pages ?? [["Factura de prueba"]];
    pages.forEach((lines, idx) => {
      doc.addPage();
      if (opts.noText) {
        doc.rect(50, 50, 200, 100).fill("#333333");
      } else {
        doc.fillColor("black").fontSize(12);
        for (const line of lines) doc.text(line);
        if (idx === 0 && opts.hidden) doc.fillColor("white").fontSize(1).text(opts.hidden);
      }
    });
    doc.end();
  });
}

export type FixtureImageFormat = "png" | "jpeg" | "webp" | "gif" | "tiff";

export async function makeImage(
  format: FixtureImageFormat,
  width: number,
  height: number,
  opts: { orientation?: number } = {},
): Promise<Uint8Array> {
  let img = sharp({ create: { width, height, channels: 3, background: { r: 240, g: 200, b: 120 } } });
  if (opts.orientation) img = img.withMetadata({ orientation: opts.orientation });
  const out = await img.toFormat(format).toBuffer();
  return new Uint8Array(out);
}

/** PNG de ruido aleatorio: no se comprime, así que pesa ~ width × height × 3 bytes. */
export async function makeNoisePng(width: number, height: number): Promise<Uint8Array> {
  const raw = randomBytes(width * height * 3);
  const out = await sharp(raw, { raw: { width, height, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer();
  return new Uint8Array(out);
}

export interface EmlAttachment {
  filename: string;
  contentType: string;
  content: Uint8Array | string;
  inline?: boolean;
}

export interface EmlOptions {
  from?: string;
  to?: string;
  subject?: string;
  date?: string;
  replyTo?: string;
  text?: string;
  html?: string;
  attachments?: EmlAttachment[];
}

function wrapBase64(b64: string): string {
  return b64.replace(/.{1,76}/g, "$&\r\n").trimEnd();
}

function encodeHeader(value: string): string {
  return /^[\x00-\x7F]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

/** Correo MIME: simple (solo texto o solo HTML) o multipart con adjuntos en base64. */
export function makeEml(opts: EmlOptions): Uint8Array {
  const headers = [
    `From: ${opts.from ?? "Datos del Sur <facturas@datosdelsur.cl>"}`,
    `To: ${opts.to ?? "pagos@andeslabs.co"}`,
    ...(opts.replyTo ? [`Reply-To: ${opts.replyTo}`] : []),
    `Subject: ${encodeHeader(opts.subject ?? "Factura octubre")}`,
    `Date: ${opts.date ?? "Thu, 15 Oct 2026 09:30:00 -0500"}`,
    "Message-ID: <fixture-1@datosdelsur.cl>",
    "MIME-Version: 1.0",
  ];
  const textPart = (body: string, type: "plain" | "html") =>
    [`Content-Type: text/${type}; charset=utf-8`, "Content-Transfer-Encoding: base64", "", wrapBase64(Buffer.from(body, "utf8").toString("base64"))].join("\r\n");

  const attachments = opts.attachments ?? [];
  if (attachments.length === 0 && !(opts.text != null && opts.html != null)) {
    const body = opts.html != null ? textPart(opts.html, "html") : textPart(opts.text ?? "", "plain");
    return new Uint8Array(Buffer.from([...headers, body].join("\r\n"), "utf8"));
  }

  const boundary = "----=_Centinela_Fixture_Boundary";
  const sections: string[] = [];
  if (opts.text != null && opts.html != null) {
    const alt = "----=_Centinela_Alt_Boundary";
    sections.push(
      [
        `Content-Type: multipart/alternative; boundary="${alt}"`,
        "",
        `--${alt}`,
        textPart(opts.text, "plain"),
        `--${alt}`,
        textPart(opts.html, "html"),
        `--${alt}--`,
      ].join("\r\n"),
    );
  } else if (opts.html != null) {
    sections.push(textPart(opts.html, "html"));
  } else {
    sections.push(textPart(opts.text ?? "", "plain"));
  }
  for (const att of attachments) {
    const content = typeof att.content === "string" ? Buffer.from(att.content, "utf8") : Buffer.from(att.content);
    sections.push(
      [
        `Content-Type: ${att.contentType}; name="${att.filename}"`,
        `Content-Disposition: ${att.inline ? "inline" : "attachment"}; filename="${att.filename}"`,
        ...(att.inline ? [`Content-ID: <${att.filename}@fixture>`] : []),
        "Content-Transfer-Encoding: base64",
        "",
        wrapBase64(content.toString("base64")),
      ].join("\r\n"),
    );
  }
  const raw = [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    "This is a multi-part message in MIME format.",
    ...sections.map((s) => `--${boundary}\r\n${s}`),
    `--${boundary}--`,
    "",
  ].join("\r\n");
  return new Uint8Array(Buffer.from(raw, "utf8"));
}

export function utf8(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, "utf8"));
}
