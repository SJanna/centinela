/**
 * Correo MIME (.eml) determinista: cabeceras fijas, cuerpo en quoted-printable (UTF-8) y,
 * si hay adjunto, multipart/mixed con el PDF en base64.
 */
import type { EmailMeta } from "../spec";

const CRLF = "\r\n";

function isAscii(s: string): boolean {
  return /^[\x20-\x7E]*$/.test(s);
}

/**
 * Palabras codificadas RFC 2047 si hace falta: "Facturación" → "=?UTF-8?B?…?=". Cada palabra
 * codificada mide como máximo 75 caracteres y no parte un carácter UTF-8; si hay varias, se
 * pliegan en líneas de continuación.
 */
export function encodeHeaderWord(s: string): string {
  if (isAscii(s)) return s;
  const words: string[] = [];
  let chunk = "";
  for (const ch of s) {
    if (Buffer.byteLength(chunk + ch, "utf8") > 45) {
      words.push(chunk);
      chunk = "";
    }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w, "utf8").toString("base64")}?=`).join(`${CRLF} `);
}

/** Parte una lista de direcciones por comas, sin partir nombres entre comillas ni lo que va entre <>. */
function splitAddresses(list: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  let angle = false;
  for (const ch of list) {
    if (ch === '"' && !angle) quoted = !quoted;
    else if (ch === "<" && !quoted) angle = true;
    else if (ch === ">" && !quoted) angle = false;
    if (ch === "," && !quoted && !angle) {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out;
}

/** "Nombre <correo>" con el nombre codificado si no es ASCII. Admite varias direcciones separadas por coma. */
export function encodeAddressList(list: string): string {
  return splitAddresses(list)
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((addr) => {
      const m = /^(.*?)\s*<([^>]+)>$/.exec(addr);
      if (!m) return addr;
      const name = m[1].replace(/^"|"$/g, "").trim();
      if (!name) return `<${m[2]}>`;
      const encoded = isAscii(name) ? (/[,;:@"]/.test(name) ? `"${name}"` : name) : encodeHeaderWord(name);
      return `${encoded} <${m[2]}>`;
    })
    .join(", ");
}

/**
 * Codificación quoted-printable (RFC 2045) de texto UTF-8: líneas de hasta 76 caracteres,
 * sin partir nunca una secuencia =XX ni un carácter de varios bytes.
 */
export function encodeQuotedPrintable(text: string): string {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const chars = [...line];
    const tokens = chars.map((ch, i) => {
      const isLast = i === chars.length - 1;
      const code = ch.codePointAt(0) ?? 0;
      const printable = (code >= 33 && code <= 126 && code !== 61) || ((code === 32 || code === 9) && !isLast);
      if (printable) return ch;
      return [...Buffer.from(ch, "utf8")].map((b) => `=${b.toString(16).toUpperCase().padStart(2, "0")}`).join("");
    });
    let current = "";
    for (const token of tokens) {
      if (current.length + token.length > 75) {
        out.push(`${current}=`);
        current = "";
      }
      current += token;
    }
    // Un espacio al final de una línea partida queda protegido por el "=" del salto suave.
    out.push(current);
  }
  return out.join(CRLF);
}

function base64Lines(bytes: Buffer): string {
  const b64 = bytes.toString("base64");
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 76) lines.push(b64.slice(i, i + 76));
  return lines.join(CRLF);
}

export interface EmailAttachment {
  filename: string;
  contentType: string;
  bytes: Buffer;
}

export function buildEml(meta: EmailMeta, attachment: EmailAttachment | null): Buffer {
  const body = meta.body.join("\n");
  const headers = [
    `From: ${encodeAddressList(meta.from)}`,
    `To: ${encodeAddressList(meta.to)}`,
    ...(meta.cc ? [`Cc: ${encodeAddressList(meta.cc)}`] : []),
    `Subject: ${encodeHeaderWord(meta.subject)}`,
    `Date: ${meta.date}`,
    `Message-ID: ${meta.messageId}`,
    "MIME-Version: 1.0",
  ];
  const textPart = [
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: quoted-printable",
    "",
    encodeQuotedPrintable(body),
  ].join(CRLF);

  const id = meta.messageId.replace(/[^A-Za-z0-9]/g, "").slice(0, 24);
  // Con versión HTML: multipart/alternative (texto y HTML). Sin ella, el cuerpo es solo texto (como antes).
  let bodyPart = textPart;
  if (meta.html) {
    const alt = `----=_Alt_${id}`;
    bodyPart = [
      `Content-Type: multipart/alternative; boundary="${alt}"`,
      "",
      `--${alt}`,
      textPart,
      "",
      `--${alt}`,
      "Content-Type: text/html; charset=utf-8",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      encodeQuotedPrintable(meta.html.join("\n")),
      "",
      `--${alt}--`,
      "",
    ].join(CRLF);
  }

  if (!attachment) {
    return Buffer.from([...headers, bodyPart, ""].join(CRLF), "utf8");
  }

  const boundary = `----=_Part_${id}`;
  const parts = [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    "This is a multi-part message in MIME format.",
    "",
    `--${boundary}`,
    bodyPart,
    "",
    `--${boundary}`,
    `Content-Type: ${attachment.contentType}; name="${attachment.filename}"`,
    `Content-Disposition: attachment; filename="${attachment.filename}"`,
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(attachment.bytes),
    "",
    `--${boundary}--`,
    "",
  ];
  return Buffer.from(parts.join(CRLF), "utf8");
}
