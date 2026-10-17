/**
 * Correo (.eml / message/rfc822): cabeceras + cuerpo como texto, y cada adjunto como su propia
 * parte (PDF, imagen, texto o correo reenviado como adjunto).
 */
import { simpleParser, type AddressObject, type EmailAddress, type ParsedMail } from "mailparser";
import type { DocPart } from "@/core/schemas";
import { asBuffer, toBase64 } from "./bytes";
import { detectFormat } from "./detect";
import { IngestError, type IngestErrorCode } from "./errors";
import { prepareImage } from "./image";
import { MAX_EMAIL_ATTACHMENTS, MAX_EMAIL_DEPTH, MIN_ATTACHMENT_IMAGE_SIDE } from "./limits";
import { readPdf } from "./pdf";
import { cleanText, decodeText, htmlToText } from "./text";

export interface EmailContent {
  parts: DocPart[];
  plainText: string;
  meta: Record<string, string>;
}

const SKIP_REASON: Record<IngestErrorCode, string> = {
  empty: "vacío",
  too_large: "demasiado grande",
  unsupported: "formato no soportado",
  encrypted: "PDF con contraseña",
  corrupt: "archivo dañado",
  too_many_pages: "demasiadas páginas",
};

function formatAddress(a: EmailAddress): string[] {
  if (a.group && a.group.length > 0) return a.group.flatMap(formatAddress);
  const name = (a.name ?? "").trim();
  const address = (a.address ?? "").trim();
  if (name && address && name !== address) return [`${name} <${address}>`];
  return [address || name].filter((s) => s !== "");
}

/** «Nombre <correo>» separados por coma (sin las comillas que agrega mailparser). */
function addressText(value: AddressObject | AddressObject[] | undefined): string {
  if (!value) return "";
  const list = Array.isArray(value) ? value : [value];
  return list.flatMap((a) => (a.value.length > 0 ? a.value.flatMap(formatAddress) : [a.text])).join(", ");
}

/** Texto en una sola línea (sin expresiones regulares: con rachas largas de espacios eran cuadráticas). */
function oneLine(s: string): string {
  return cleanText(s)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .join(" ");
}

/** Zonas con nombre que admite RFC 5322 (obsoletas pero aún usadas), en minutos respecto de UTC. */
const NAMED_ZONES: Record<string, number> = {
  UT: 0,
  UTC: 0,
  GMT: 0,
  Z: 0,
  EST: -300,
  EDT: -240,
  CST: -360,
  CDT: -300,
  MST: -420,
  MDT: -360,
  PST: -480,
  PDT: -420,
};

/** Desfase (minutos) con que se escribió la cabecera Date: "-0300" → -180, "GMT" → 0. null si no se reconoce. */
export function dateHeaderOffsetMinutes(rawDate: string): number | null {
  const value = rawDate.replace(/\([^()]*\)/g, " ").trim(); // sin comentarios: "-0300 (-03)"
  const numeric = /([+-])(\d{2})(\d{2})$/.exec(value);
  if (numeric) {
    const hours = Number(numeric[2]);
    const minutes = Number(numeric[3]);
    if (hours > 14 || minutes > 59) return null;
    return (numeric[1] === "-" ? -1 : 1) * (hours * 60 + minutes);
  }
  const zone = value.slice(value.lastIndexOf(" ") + 1).toUpperCase();
  return /^[A-Z]{1,5}$/.test(zone) ? (NAMED_ZONES[zone] ?? null) : null;
}

/**
 * Fecha del correo en ISO 8601 con la zona del remitente ("2026-10-31T22:14:22-03:00"). En UTC,
 * un correo enviado el 31 de octubre a las 22:14 en Buenos Aires quedaba el 1 de noviembre y
 * corría el mes de la factura (periodo pagado, vigencia del acuerdo, límite mensual).
 * Si la zona no se reconoce, UTC con «Z».
 */
export function formatEmailDate(date: Date, rawDateHeader: string | undefined): string {
  const offset = rawDateHeader ? dateHeaderOffsetMinutes(rawDateHeader) : null;
  if (offset == null) return `${date.toISOString().slice(0, 19)}Z`;
  const local = new Date(date.getTime() + offset * 60_000).toISOString().slice(0, 19);
  const abs = Math.abs(offset);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${local}${offset < 0 ? "-" : "+"}${hh}:${mm}`;
}

/** Valor crudo de la primera cabecera Date (sin «Date:» y con los pliegues unidos). */
function rawDateHeader(mail: ParsedMail): string | undefined {
  const line = mail.headerLines?.find((h) => h.key === "date")?.line;
  if (!line) return undefined;
  return line.slice(line.indexOf(":") + 1).replace(/\s+/g, " ").trim();
}

function bodyOf(mail: ParsedMail): string {
  const text = typeof mail.text === "string" ? mail.text : "";
  if (text.trim() !== "") return cleanText(text);
  if (typeof mail.html === "string" && mail.html.trim() !== "") return cleanText(htmlToText(mail.html));
  return "";
}

interface AttachmentOutcome {
  parts: DocPart[];
  /** Bloque para plainText (null si el adjunto no aporta texto). */
  text: string | null;
}

async function processAttachment(
  content: Uint8Array,
  name: string,
  contentType: string | undefined,
  depth: number,
): Promise<AttachmentOutcome | { skipped: string }> {
  if (content.byteLength === 0) return { skipped: SKIP_REASON.empty };
  const detected = detectFormat(content, name, contentType);
  switch (detected.kind) {
    case "pdf": {
      const { text } = await readPdf(content, name);
      return {
        parts: [{ type: "pdf", base64: toBase64(content) }],
        text: text ? `--- Adjunto: ${name} ---\n${text}` : null,
      };
    }
    case "image": {
      const img = await prepareImage(content, detected.mediaType, detected.native, name);
      if (img.width != null && img.height != null && Math.max(img.width, img.height) < MIN_ATTACHMENT_IMAGE_SIDE) {
        return { skipped: "imagen muy pequeña, posible logo o firma" };
      }
      return { parts: [img.part], text: null };
    }
    case "email": {
      if (depth + 1 > MAX_EMAIL_DEPTH) return { skipped: "correo anidado demasiado profundo" };
      const nested = await normalizeEmail(content, name, depth + 1);
      const [first, ...rest] = nested.parts;
      const relabeled: DocPart[] =
        first && first.type === "text" ? [{ ...first, label: `correo adjunto: ${name}` }, ...rest] : nested.parts;
      return { parts: relabeled, text: `--- Correo adjunto: ${name} ---\n${nested.plainText}` };
    }
    case "chat":
    case "text": {
      if (detected.text.trim() === "") return { skipped: SKIP_REASON.empty };
      return {
        parts: [{ type: "text", label: `adjunto: ${name}`, text: detected.text }],
        text: `--- Adjunto: ${name} ---\n${detected.text}`,
      };
    }
  }
}

/**
 * Normaliza un correo. parts = [texto «correo», ...adjuntos]; plainText = cabeceras + cuerpo +
 * texto de los adjuntos. Los adjuntos que no se pueden leer se omiten y se nombran en el texto.
 */
export async function normalizeEmail(bytes: Uint8Array, filename: string, depth = 0): Promise<EmailContent> {
  let mail: ParsedMail;
  try {
    mail = await simpleParser(asBuffer(bytes), {
      skipHtmlToText: true,
      skipImageLinks: true,
      skipTextToHtml: true,
      skipTextLinks: true,
    });
  } catch {
    throw new IngestError(`No se pudo leer el correo «${filename}». Verifica que sea un archivo .eml completo.`, "corrupt");
  }

  const from = oneLine(addressText(mail.from));
  const to = oneLine(addressText(mail.to));
  const cc = oneLine(addressText(mail.cc));
  const replyTo = oneLine(addressText(mail.replyTo));
  const subject = oneLine(mail.subject ?? "");
  const date =
    mail.date instanceof Date && !Number.isNaN(mail.date.getTime()) ? formatEmailDate(mail.date, rawDateHeader(mail)) : "";
  let body = bodyOf(mail);
  if (!body && !from && !to && !subject && !date && mail.attachments.length === 0) {
    // No era un correo de verdad (p. ej. un .eml que solo trae texto): no perder el contenido.
    const decoded = decodeText(bytes);
    if (decoded) body = cleanText(decoded.text);
  }

  const names: string[] = [];
  const skipped: string[] = [];
  const attachmentParts: DocPart[] = [];
  const attachmentTexts: string[] = [];
  let included = 0;

  for (const [i, att] of mail.attachments.entries()) {
    const name = oneLine(att.filename ?? "") || `adjunto-${i + 1}`;
    names.push(name);
    if (included >= MAX_EMAIL_ATTACHMENTS) {
      skipped.push(`${name} (se leen como máximo ${MAX_EMAIL_ATTACHMENTS} adjuntos)`);
      continue;
    }
    let outcome: AttachmentOutcome | { skipped: string };
    try {
      outcome = await processAttachment(att.content, name, att.contentType, depth);
    } catch (err) {
      outcome = { skipped: err instanceof IngestError ? SKIP_REASON[err.code] : "no se pudo leer" };
    }
    if ("skipped" in outcome) {
      skipped.push(`${name} (${outcome.skipped})`);
      continue;
    }
    included++;
    attachmentParts.push(...outcome.parts);
    if (outcome.text) attachmentTexts.push(outcome.text);
  }

  const headerLines = [
    `De: ${from || "(sin remitente)"}`,
    ...(replyTo && replyTo !== from ? [`Responder a: ${replyTo}`] : []),
    `Para: ${to || "(sin destinatario)"}`,
    ...(cc ? [`CC: ${cc}`] : []),
    `Asunto: ${subject || "(sin asunto)"}`,
    `Fecha: ${date || "(sin fecha)"}`,
    ...(names.length > 0 ? [`Adjuntos: ${names.join(", ")}`] : []),
    ...(skipped.length > 0 ? [`Adjuntos no leídos: ${skipped.join(", ")}`] : []),
  ];
  const emailText = `${headerLines.join("\n")}\n\n${body || "(correo sin texto)"}`;
  const plainText = [emailText, ...attachmentTexts].join("\n\n");

  const meta: Record<string, string> = {
    from,
    to,
    subject,
    date,
    attachments: names.join(", "),
  };
  if (cc) meta.cc = cc;
  if (replyTo) meta.replyTo = replyTo;
  if (skipped.length > 0) meta.skippedAttachments = skipped.join(", ");

  return {
    parts: [{ type: "text", label: "correo", text: emailText }, ...attachmentParts],
    plainText,
    meta,
  };
}
