/**
 * Texto del documento: dónde están los fragmentos sospechosos y cómo se reparte un correo o un chat
 * en partes que se pueden dibujar. Funciones puras, sin modelo.
 */

export interface SuspiciousNeedle {
  text: string;
  reason: string;
}

export interface TextSpan {
  start: number;
  end: number;
  /** Motivo de la primera instrucción que cae en este tramo. */
  reason: string;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function allMatches(text: string, re: RegExp): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  for (const m of text.matchAll(re)) {
    if (m.index === undefined || m[0].length === 0) continue;
    out.push({ start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/**
 * Busca cada instrucción sospechosa en el texto. Primero tal cual (espacios flexibles, sin
 * distinguir mayúsculas); si no aparece, letra por letra con espacios opcionales, porque el texto
 * de un PDF a veces sale con letras separadas ("TOTA L A PAG A R"). Une los tramos que se pisan.
 */
export function findSuspiciousSpans(text: string, needles: readonly SuspiciousNeedle[]): TextSpan[] {
  if (!text) return [];
  const found: TextSpan[] = [];
  const seen = new Set<string>();
  for (const needle of needles) {
    const clean = needle.text.replace(/\s+/g, " ").trim();
    const key = clean.toLowerCase();
    if (clean.length < 3 || seen.has(key)) continue;
    seen.add(key);
    const words = clean.split(" ").map(escapeRegExp);
    let matches = allMatches(text, new RegExp(words.join("\\s+"), "giu"));
    if (matches.length === 0 && clean.length <= 400) {
      const chars = Array.from(clean.replace(/\s+/g, "")).map(escapeRegExp);
      matches = allMatches(text, new RegExp(chars.join("\\s*"), "giu"));
    }
    for (const m of matches) found.push({ ...m, reason: needle.reason });
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: TextSpan[] = [];
  for (const span of found) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }
  return merged;
}

/** Trozo de texto con su marca: sospechoso (gana siempre), cita de un dato leído o nada. */
export interface MarkedPiece {
  text: string;
  start: number;
  span: TextSpan | null;
  evidence: boolean;
}

/**
 * Parte un texto por dos juegos de tramos: los sospechosos y las citas de datos leídos. Donde se
 * pisan, manda el sospechoso. Las claves (start) no cambian al cambiar las citas, así el marcador
 * sospechoso no se vuelve a animar con cada hover.
 */
export function splitByMarks(text: string, suspicious: readonly TextSpan[], evidence: readonly TextSpan[]): MarkedPiece[] {
  const cuts = new Set<number>([0, text.length]);
  for (const s of [...suspicious, ...evidence]) {
    cuts.add(Math.max(0, Math.min(text.length, s.start)));
    cuts.add(Math.max(0, Math.min(text.length, s.end)));
  }
  const points = [...cuts].sort((a, b) => a - b);
  const out: MarkedPiece[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    const end = points[i + 1];
    if (end <= start) continue;
    const sus = suspicious.find((s) => s.start <= start && s.end >= end) ?? null;
    const ev = !sus && evidence.some((s) => s.start <= start && s.end >= end);
    const prev = out[out.length - 1];
    // Une trozos contiguos con la misma marca (un sospechoso queda en una sola pieza).
    if (prev && prev.span === sus && prev.evidence === ev) {
      prev.text += text.slice(start, end);
      continue;
    }
    out.push({ text: text.slice(start, end), start, span: sus, evidence: ev });
  }
  return out;
}

// ───────────────────────── Correo ─────────────────────────

export interface EmailView {
  from: string;
  to: string;
  cc: string | null;
  subject: string;
  date: string;
  attachments: string[];
  body: string;
  /** Texto de cada adjunto leído ("--- Adjunto: factura.pdf ---"). */
  attachmentTexts: { title: string; text: string }[];
}

const HEADER_LINE = /^(De|Responder a|Para|CC|Asunto|Fecha|Adjuntos|Adjuntos no leídos):\s?(.*)$/;
const ATTACHMENT_BLOCK = /^--- (Correo adjunto|Adjunto): (.+) ---$/;

/** Reparte el texto normalizado de un correo (cabeceras, cuerpo y adjuntos). */
export function parseEmail(plainText: string, meta: Record<string, string>): EmailView {
  const cut = plainText.indexOf("\n\n");
  const headerText = cut >= 0 ? plainText.slice(0, cut) : "";
  const rest = cut >= 0 ? plainText.slice(cut + 2) : plainText;

  const headers: Record<string, string> = {};
  for (const line of headerText.split("\n")) {
    const m = HEADER_LINE.exec(line);
    if (m) headers[m[1]] = m[2];
  }

  const blocks = rest.split(/\n\n(?=--- (?:Correo adjunto|Adjunto): .+ ---\n)/);
  const body = blocks[0] ?? "";
  const attachmentTexts = blocks.slice(1).map((block) => {
    const nl = block.indexOf("\n");
    const first = nl >= 0 ? block.slice(0, nl) : block;
    const m = ATTACHMENT_BLOCK.exec(first);
    return { title: m ? m[2] : first, text: nl >= 0 ? block.slice(nl + 1) : "" };
  });

  const attachmentsRaw = meta.attachments ?? headers["Adjuntos"] ?? "";
  return {
    from: meta.from || headers["De"] || "(sin remitente)",
    to: meta.to || headers["Para"] || "(sin destinatario)",
    cc: meta.cc || headers["CC"] || null,
    subject: meta.subject || headers["Asunto"] || "(sin asunto)",
    date: meta.date || headers["Fecha"] || "",
    attachments: attachmentsRaw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    body,
    attachmentTexts,
  };
}

// ───────────────────────── Chat ─────────────────────────

export interface ChatMessage {
  kind: "message" | "system";
  author: string | null;
  stamp: string | null;
  text: string;
}

const DATE = String.raw`\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}`;
const TIME = String.raw`\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]\.?\s*m\.?)?`;
const SPEAKER = String.raw`([^:\n]{1,60}?)`;

const MESSAGE_LINES: { re: RegExp; stamp: (m: RegExpExecArray) => string }[] = [
  // [20/10/26, 9:41:05] Nombre: mensaje
  { re: new RegExp(String.raw`^\[(${DATE}),?\s+(${TIME})\]\s*${SPEAKER}:\s?(.*)$`, "i"), stamp: (m) => `${m[1]} ${m[2]}` },
  // 20/10/2026, 09:41 - Nombre: mensaje
  { re: new RegExp(String.raw`^(${DATE}),?\s+(${TIME})\s+[-–]\s+${SPEAKER}:\s?(.*)$`, "i"), stamp: (m) => `${m[1]} ${m[2]}` },
  // [9:41 a. m., 20/10/2026] Nombre: mensaje
  { re: new RegExp(String.raw`^\[(${TIME}),\s*(${DATE})\]\s*${SPEAKER}:\s?(.*)$`, "i"), stamp: (m) => `${m[2]} ${m[1]}` },
];
const SYSTEM_LINE = new RegExp(String.raw`^\[?(${DATE}),?\s+(${TIME})\]?\s+[-–]\s+(.*)$`, "i");

/**
 * Reparte un chat exportado (estilo WhatsApp) en mensajes. Las líneas sin fecha se suman al mensaje
 * anterior. Si no hay líneas con fecha, prueba con "Nombre: mensaje" de los participantes conocidos.
 * Devuelve null si no reconoce ningún mensaje.
 */
export function parseChat(plainText: string, participants: readonly string[] = []): ChatMessage[] | null {
  const lines = plainText.split("\n");
  const out: ChatMessage[] = [];
  let recognized = 0;

  const known = participants.map((p) => p.trim()).filter((p) => p.length > 0);

  for (const raw of lines) {
    const line = raw.trimEnd();
    let matched = false;
    for (const pattern of MESSAGE_LINES) {
      const m = pattern.re.exec(line.trim());
      if (m) {
        out.push({ kind: "message", author: m[3].trim(), stamp: pattern.stamp(m), text: m[4] ?? "" });
        recognized++;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    const sys = SYSTEM_LINE.exec(line.trim());
    if (sys) {
      out.push({ kind: "system", author: null, stamp: `${sys[1]} ${sys[2]}`, text: sys[3] });
      recognized++;
      continue;
    }
    const speaker = known.find((p) => line.startsWith(`${p}:`));
    if (speaker) {
      out.push({ kind: "message", author: speaker, stamp: null, text: line.slice(speaker.length + 1).trim() });
      recognized++;
      continue;
    }
    const last = out[out.length - 1];
    if (last) last.text = last.text ? `${last.text}\n${line}` : line;
    else if (line.trim() !== "") out.push({ kind: "system", author: null, stamp: null, text: line });
  }

  if (recognized === 0) return null;
  return out.map((m) => ({ ...m, text: m.text.replace(/\n+$/, "") }));
}
