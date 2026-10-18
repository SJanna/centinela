/**
 * Correo (.eml / message/rfc822): cabeceras + cuerpo como texto, y cada adjunto como su propia
 * parte (PDF, imagen, texto o correo reenviado como adjunto).
 *
 * Lo que una persona ve y la lectura no queda como aviso (`warnings`): una versión HTML que no dice
 * lo mismo que el texto plano (ver email-bodies.ts) o que no tiene texto (solo imágenes), un adjunto
 * que no se pudo leer, o texto que se ve distinto de como se lee (orden invertido, letras de otro
 * alfabeto que imitan latinas: ver lookalike.ts). Con cualquier aviso el correo nunca se paga (LEC-1
 * y la guardia).
 */
import { simpleParser, type AddressObject, type EmailAddress, type ParsedMail } from "mailparser";
import type { DocPart, IngestWarning } from "@/core/schemas";
import { asBuffer, toBase64 } from "./bytes";
import { detectFormat, extensionOf } from "./detect";
import { compareEmailBodies } from "./email-bodies";
import { IngestError, type IngestErrorCode } from "./errors";
import { prepareImage } from "./image";
import { MAX_EMAIL_ATTACHMENTS, MAX_EMAIL_DEPTH, MIN_ATTACHMENT_IMAGE_SIDE } from "./limits";
import { hasDirectionOverride, latinSkeleton, mixedScriptWords, reversedSegment } from "./lookalike";
import { readPdf } from "./pdf";
import { cleanText, decodeText, htmlToText } from "./text";

export interface EmailContent {
  parts: DocPart[];
  plainText: string;
  meta: Record<string, string>;
  /** Avisos (también los de un correo adjunto). Vacío si no hay. */
  warnings: IngestWarning[];
}

/** Etiqueta de la parte con el texto del HTML cuando aporta algo que el texto plano no tiene. */
export const HTML_VERSION_LABEL = "correo (versión HTML)";
/** Encabezado del mismo texto dentro de plainText. */
export const HTML_VERSION_BLOCK = "--- Correo (versión HTML) ---";

const SKIP_TINY_IMAGE = "imagen muy pequeña, posible logo o firma";

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

interface Body {
  /** Cuerpo principal: el texto plano o, si no hay, el texto del HTML. */
  text: string;
  /** Texto del HTML cuando el correo trae las dos versiones y el HTML aporta algo que el texto no tiene. */
  htmlVersion: string | null;
  /** Aviso si las dos versiones difieren de forma material. */
  warning: IngestWarning | null;
}

const HTML_MISMATCH = "El correo trae una versión HTML distinta del texto plano";

function bodyOf(mail: ParsedMail, htmlRawText: string): Body {
  const text = typeof mail.text === "string" && mail.text.trim() !== "" ? cleanText(mail.text) : "";
  const html = htmlRawText.trim() !== "" ? cleanText(htmlRawText) : "";
  if (!text) return { text: html, htmlVersion: null, warning: null };
  if (!html) {
    if (typeof mail.html !== "string" || mail.html.trim() === "") return { text, htmlVersion: null, warning: null };
    // Hay HTML pero sin texto: una persona ve imágenes (un recibo, por ejemplo) y la lectura, el texto plano.
    return {
      text,
      htmlVersion: null,
      warning: {
        code: "html_text_mismatch",
        message: `${HTML_MISMATCH}: la versión HTML no tiene texto (solo imágenes, enlaces o formato), así que lo que ve una persona no es lo que se lee`,
      },
    };
  }
  // Las dos versiones: el cliente de correo le muestra a una persona el HTML. Si el HTML aporta algo,
  // su texto también se lee (lectores y detectores); si la diferencia es material, además se avisa.
  const cmp = compareEmailBodies(text, html);
  const material = cmp.reasons.length > 0;
  return {
    text,
    htmlVersion: cmp.htmlAddsContent || material ? html : null,
    warning: material
      ? { code: "html_text_mismatch", message: `${HTML_MISMATCH}: ${cmp.reasons.join("; ")}` }
      : null,
  };
}

/**
 * Texto que se ve distinto de como se lee: letras con el orden invertido (forzados de dirección
 * U+202D/U+202E, <bdo dir="rtl">, unicode-bidi: bidi-override) o palabras que mezclan letras
 * latinas con letras de otro alfabeto que las imitan («РАGАDО», «CloudMеtrics»). Se mira el
 * remitente, el asunto, el texto plano y el HTML sin limpiar (la limpieza quita los forzados de dirección).
 */
function deceptiveText(mail: ParsedMail, htmlRawText: string): IngestWarning[] {
  const rawHtml = typeof mail.html === "string" ? mail.html : null;
  const texts = [
    addressText(mail.from),
    addressText(mail.replyTo),
    mail.subject ?? "",
    typeof mail.text === "string" ? mail.text : "",
    htmlRawText,
  ];
  const out: IngestWarning[] = [];
  const joined = texts.join("\n");
  if (hasDirectionOverride(joined, rawHtml)) {
    const seg = reversedSegment(joined, rawHtml);
    const example = seg && seg.read && seg.shown ? ` («${seg.read}» se ve «${seg.shown}»)` : "";
    out.push({
      code: "deceptive_text",
      message: `El correo trae texto con caracteres o estilos que invierten el orden de las letras al mostrarlo${example}: lo que ve una persona no es lo que se lee`,
    });
  }
  const mixed = mixedScriptWords(joined);
  if (mixed.length > 0) {
    const shown = mixed.map((w) => `«${w}», se ve «${latinSkeleton(w)}»`).join("; ");
    out.push({
      code: "deceptive_text",
      message: `El correo mezcla letras de alfabetos distintos en una misma palabra (${shown}): puede imitar otra palabra`,
    });
  }
  return out;
}

/** Tipo declarado sin parámetros, en minúsculas («application/pkcs7-signature»). */
function baseType(contentType: string | undefined): string {
  return (contentType ?? "").split(";")[0].trim().toLowerCase();
}

function startsWithText(content: Uint8Array, prefix: string): boolean {
  const head = Buffer.from(content.subarray(0, 512)).toString("utf8").replace(/^\uFEFF/, "").trimStart().toUpperCase();
  return head.startsWith(prefix);
}

/**
 * Adjuntos inequívocamente benignos que no pueden contener una factura ni un comprobante: una firma
 * S/MIME (smime.p7s, application/pkcs7-signature, contenido DER), una tarjeta de contacto (.vcf,
 * text/vcard, empieza con BEGIN:VCARD) o una invitación de calendario (.ics, text/calendar, empieza
 * con BEGIN:VCALENDAR). Hace falta el tipo o la extensión Y el contenido: un .docx renombrado a
 * «comprobante.ics» no cuenta.
 */
export function isBenignAttachment(name: string, contentType: string | undefined, content: Uint8Array): boolean {
  const type = baseType(contentType);
  const ext = extensionOf(name);
  if (type === "application/pkcs7-signature" || type === "application/x-pkcs7-signature" || ext === "p7s") {
    return content.byteLength > 0 && content[0] === 0x30; // SEQUENCE de ASN.1 (DER)
  }
  if (type === "text/vcard" || type === "text/x-vcard" || type === "text/directory" || ext === "vcf" || ext === "vcard") {
    return startsWithText(content, "BEGIN:VCARD");
  }
  if (type === "text/calendar" || type === "application/ics" || ext === "ics") {
    return startsWithText(content, "BEGIN:VCALENDAR");
  }
  return false;
}

/**
 * Motivos de omisión que NO son «no se pudo leer»: el adjunto se abrió y no puede traer un documento
 * legible (vacío, o una imagen de menos de MIN_ATTACHMENT_IMAGE_SIDE px de lado: logo, firma, píxel de
 * rastreo). Todo lo demás (formato no soportado, PDF con contraseña, dañado, demasiado grande o con
 * demasiadas páginas, correo anidado demasiado profundo, por encima del máximo de adjuntos) es un aviso.
 */
const NOT_UNREADABLE: ReadonlySet<string> = new Set([SKIP_REASON.empty, SKIP_TINY_IMAGE]);

interface AttachmentOutcome {
  parts: DocPart[];
  /** Bloque para plainText (null si el adjunto no aporta texto). */
  text: string | null;
  /** Avisos del adjunto (un PDF que no se pudo abrir) o de un correo adjunto. */
  warnings?: IngestWarning[];
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
      const { pages, text } = await readPdf(content, name);
      return {
        parts: [{ type: "pdf", base64: toBase64(content) }],
        text: text ? `--- Adjunto: ${name} ---\n${text}` : null,
        // PDF.js no lo pudo abrir: va igual a los lectores, pero ni el texto ni los detectores lo vieron.
        ...(pages == null
          ? { warnings: [{ code: "attachment_unreadable" as const, message: `El correo trae un adjunto que no se pudo leer: ${name} (PDF que no se pudo abrir)` }] }
          : {}),
      };
    }
    case "image": {
      const img = await prepareImage(content, detected.mediaType, detected.native, name);
      if (img.width != null && img.height != null && Math.max(img.width, img.height) < MIN_ATTACHMENT_IMAGE_SIDE) {
        return { skipped: SKIP_TINY_IMAGE };
      }
      return { parts: [img.part], text: null };
    }
    case "email": {
      if (depth + 1 > MAX_EMAIL_DEPTH) return { skipped: "correo anidado demasiado profundo" };
      const nested = await normalizeEmail(content, name, depth + 1);
      const [first, ...rest] = nested.parts;
      const relabeled: DocPart[] = (first && first.type === "text" ? [{ ...first, label: `correo adjunto: ${name}` }, ...rest] : nested.parts).map(
        (part) => (part.type === "text" && part.label === HTML_VERSION_LABEL ? { ...part, label: `correo adjunto: ${name} (versión HTML)` } : part),
      );
      return {
        parts: relabeled,
        text: `--- Correo adjunto: ${name} ---\n${nested.plainText}`,
        warnings: nested.warnings.map((w) => ({ ...w, message: `${w.message} (en el correo adjunto «${name}»)` })),
      };
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
 * Normaliza un correo. parts = [texto «correo», versión HTML si aporta algo, ...adjuntos]; plainText =
 * cabeceras + cuerpo + versión HTML + texto de los adjuntos. Los adjuntos que no se pueden leer se
 * omiten, se nombran en el texto y dejan un aviso (salvo los benignos: ver isBenignAttachment).
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
  // Texto del HTML sin limpiar (con los forzados de dirección, que la limpieza quita).
  const htmlRawText = typeof mail.html === "string" && mail.html.trim() !== "" ? htmlToText(mail.html) : "";
  const parsedBody = bodyOf(mail, htmlRawText);
  let body = parsedBody.text;
  const warnings: IngestWarning[] = [...(parsedBody.warning ? [parsedBody.warning] : []), ...deceptiveText(mail, htmlRawText)];
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

  const unreadable = (name: string, reason: string, content: Uint8Array, contentType: string | undefined) => {
    if (NOT_UNREADABLE.has(reason) || isBenignAttachment(name, contentType, content)) return;
    warnings.push({ code: "attachment_unreadable", message: `El correo trae un adjunto que no se pudo leer: ${name} (${reason})` });
  };

  for (const [i, att] of mail.attachments.entries()) {
    const name = oneLine(att.filename ?? "") || `adjunto-${i + 1}`;
    const content: Uint8Array = att.content;
    names.push(name);
    if (included >= MAX_EMAIL_ATTACHMENTS) {
      const reason = `se leen como máximo ${MAX_EMAIL_ATTACHMENTS} adjuntos`;
      skipped.push(`${name} (${reason})`);
      unreadable(name, reason, content, att.contentType);
      continue;
    }
    let outcome: AttachmentOutcome | { skipped: string };
    try {
      outcome = await processAttachment(content, name, att.contentType, depth);
    } catch (err) {
      outcome = { skipped: err instanceof IngestError ? SKIP_REASON[err.code] : "no se pudo leer" };
    }
    if ("skipped" in outcome) {
      skipped.push(`${name} (${outcome.skipped})`);
      unreadable(name, outcome.skipped, content, att.contentType);
      continue;
    }
    included++;
    attachmentParts.push(...outcome.parts);
    if (outcome.text) attachmentTexts.push(outcome.text);
    if (outcome.warnings) warnings.push(...outcome.warnings);
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
  const htmlVersion = parsedBody.htmlVersion;
  const htmlBlock = htmlVersion ? [`${HTML_VERSION_BLOCK}\n${htmlVersion}`] : [];
  const plainText = [emailText, ...htmlBlock, ...attachmentTexts].join("\n\n");

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
    parts: [
      { type: "text", label: "correo", text: emailText },
      ...(htmlVersion ? [{ type: "text" as const, label: HTML_VERSION_LABEL, text: htmlVersion }] : []),
      ...attachmentParts,
    ],
    plainText,
    meta,
    warnings,
  };
}
