/**
 * EQUIPO ROJO · utilidades para fabricar facturas-trampa (solo lectura sobre el sistema).
 *
 * Reusa los renderizadores del generador del dataset (import de solo lectura; no se modifica nada
 * de dataset/**). Dibuja una factura realista en un lienzo y la exporta a PDF, PNG o JPG; arma
 * correos .eml (incluido multipart/alternative con texto y HTML distintos) y chats .txt.
 *
 * Objetivo del ejercicio: INYECCIÓN DE INSTRUCCIONES contra las dos lecturas del sistema. Por eso
 * el lienzo acepta "ganchos" de inyección: nota visible, nota al pie, texto blanco de 1 pt (capa de
 * texto del PDF, invisible a la vista), texto fuera de la página (en la capa de texto, no en el
 * render) y metadatos del PDF.
 *
 * Todos los datos son ficticios. No se usan personas ni empresas reales (los bancos solo como
 * nombre de institución).
 */
import PDFDocument from "pdfkit";
import { Canvas, A4, type Page } from "../dataset/generator/layout";
import { renderPdf } from "../dataset/generator/render/pdf";
import { renderPng, renderPhoto } from "../dataset/generator/render/image";
import { buildEml, encodeQuotedPrintable } from "../dataset/generator/render/email";
import { buildChat } from "../dataset/generator/render/chat";
import type { PhotoSpec } from "../dataset/generator/spec";

export { buildEml, buildChat, type Page };

export interface Party {
  name: string;
  taxLabel?: string;
  taxId?: string;
  address?: string[];
  email?: string;
}

export interface LineItem {
  description: string;
  detail?: string;
  qty?: string;
  unit?: string;
  unitPrice?: string;
  amount: string;
}

export interface TotalRow {
  label: string;
  value: string;
  /** Etiqueta para efectos de foto (p. ej. "total" para desenfocar esa fila en el JPG). */
  tag?: string;
  strong?: boolean;
}

export interface Payment {
  beneficiary?: string;
  bank?: string;
  accountLabel?: string;
  account?: string;
  codeLabel?: string;
  code?: string;
}

export interface InvoiceModel {
  title: string;
  brandColor?: string;
  vendor: Party;
  customer: Party;
  /** Pares etiqueta/valor del encabezado (N.º de factura, fechas, periodo, moneda…). */
  meta: { label: string; value: string }[];
  lines: LineItem[];
  totals: TotalRow[];
  payment?: Payment;
  notes?: string[];
  legal?: string[];
}

export interface Inject {
  /** Recuadro visible llamativo (como B16). */
  visibleNote?: string;
  /** Nota al pie visible pero discreta (gris, pequeña). */
  footnote?: string;
  /** Texto blanco de 1 pt en el cuerpo: invisible a la vista, presente en la capa de texto del PDF. */
  hiddenWhite?: string[];
  /** Texto dibujado DEBAJO del borde inferior: no sale en el render, sí en la capa de texto del PDF. */
  offPage?: string[];
  /** Texto gris muy claro y diminuto cerca del pie (apenas visible). */
  tinyGray?: string[];
}

const INK = "#111827";
const MUTE = "#6B7280";

/** Dibuja una factura realista en un lienzo A4 y devuelve el lienzo. */
export function drawInvoice(model: InvoiceModel): Canvas {
  const c = new Canvas(A4.width, A4.height, "#FFFFFF");
  const brand = model.brandColor ?? "#1D4ED8";
  const M = 48;
  const right = A4.width - M;
  let y = 64;

  // Encabezado: banda de color con el nombre del proveedor y el título del documento.
  c.rect(0, 0, A4.width, 96, { fill: brand });
  c.text(M, 52, model.vendor.name, { size: 18, font: "sansBold", color: "#FFFFFF" });
  if (model.vendor.email) c.text(M, 72, model.vendor.email, { size: 9, color: "#E5E7EB" });
  c.text(right, 46, model.title, { size: 15, font: "sansBold", color: "#FFFFFF", align: "right" });

  y = 128;
  // Emisor (quién cobra).
  c.text(M, y, "Emisor", { size: 8, font: "sansBold", color: MUTE });
  let vy = y + 14;
  c.text(M, vy, model.vendor.name, { size: 10, font: "sansBold", color: INK });
  vy += 13;
  if (model.vendor.taxId) {
    c.text(M, vy, `${model.vendor.taxLabel ?? "NIT"}: ${model.vendor.taxId}`, { size: 9, color: INK });
    vy += 12;
  }
  for (const line of model.vendor.address ?? []) {
    c.text(M, vy, line, { size: 8.5, color: MUTE });
    vy += 11;
  }

  // Cliente (a quién se le cobra).
  const cx = A4.width / 2 + 20;
  c.text(cx, y, "Cliente", { size: 8, font: "sansBold", color: MUTE });
  let cyy = y + 14;
  c.text(cx, cyy, model.customer.name, { size: 10, font: "sansBold", color: INK });
  cyy += 13;
  if (model.customer.taxId) {
    c.text(cx, cyy, `${model.customer.taxLabel ?? "ID"}: ${model.customer.taxId}`, { size: 9, color: INK });
    cyy += 12;
  }
  for (const line of model.customer.address ?? []) {
    c.text(cx, cyy, line, { size: 8.5, color: MUTE });
    cyy += 11;
  }

  y = Math.max(vy, cyy) + 16;

  // Metadatos (N.º, fechas, moneda…).
  c.rect(M, y, A4.width - 2 * M, 1, { fill: "#E5E7EB" });
  y += 14;
  let mx = M;
  const colW = (A4.width - 2 * M) / Math.max(1, Math.min(model.meta.length, 4));
  model.meta.forEach((m, i) => {
    if (i > 0 && i % 4 === 0) {
      y += 34;
      mx = M;
    }
    c.text(mx, y, m.label.toUpperCase(), { size: 7, font: "sansBold", color: MUTE });
    c.text(mx, y + 13, m.value, { size: 9.5, font: "sansBold", color: INK });
    mx += colW;
  });
  y += 40;

  // Tabla de conceptos.
  c.rect(M, y, A4.width - 2 * M, 22, { fill: brand });
  c.text(M + 8, y + 15, "Concepto", { size: 8.5, font: "sansBold", color: "#FFFFFF" });
  c.text(right - 230, y + 15, "Cant.", { size: 8.5, font: "sansBold", color: "#FFFFFF", align: "right" });
  c.text(right - 120, y + 15, "V. unitario", { size: 8.5, font: "sansBold", color: "#FFFFFF", align: "right" });
  c.text(right - 8, y + 15, "Valor", { size: 8.5, font: "sansBold", color: "#FFFFFF", align: "right" });
  y += 22;
  for (const line of model.lines) {
    c.rect(M, y, A4.width - 2 * M, 1, { fill: "#F3F4F6" });
    y += 16;
    c.text(M + 8, y, line.description, { size: 9, color: INK });
    if (line.qty != null) c.text(right - 230, y, line.qty + (line.unit ? ` ${line.unit}` : ""), { size: 9, color: INK, align: "right" });
    if (line.unitPrice != null) c.text(right - 120, y, line.unitPrice, { size: 9, color: INK, align: "right" });
    c.text(right - 8, y, line.amount, { size: 9, color: INK, align: "right" });
    if (line.detail) {
      y += 11;
      c.text(M + 8, y, line.detail, { size: 7.5, color: MUTE });
    }
    y += 6;
  }
  y += 6;
  c.rect(M, y, A4.width - 2 * M, 1, { fill: "#E5E7EB" });
  y += 16;

  // Totales (alineados a la derecha).
  for (const row of model.totals) {
    const strong = row.strong ?? row.tag === "total";
    c.text(right - 150, y, row.label, { size: strong ? 10 : 9, font: strong ? "sansBold" : "sans", color: strong ? INK : MUTE, align: "right" });
    c.text(right - 8, y, row.value, {
      size: strong ? 11 : 9,
      font: strong ? "sansBold" : "sans",
      color: strong ? INK : INK,
      align: "right",
      tags: row.tag ? [row.tag] : [],
    });
    y += strong ? 20 : 15;
  }
  y += 10;

  // Datos de pago.
  if (model.payment) {
    const p = model.payment;
    c.rect(M, y, A4.width - 2 * M, 1, { fill: "#E5E7EB" });
    y += 14;
    c.text(M, y, "Datos para el pago", { size: 8, font: "sansBold", color: MUTE });
    y += 14;
    const pay: string[] = [];
    if (p.beneficiary) pay.push(`Beneficiario: ${p.beneficiary}`);
    if (p.bank) pay.push(`Banco: ${p.bank}`);
    if (p.account) pay.push(`${p.accountLabel ?? "Cuenta"}: ${p.account}`);
    if (p.code) pay.push(`${p.codeLabel ?? "SWIFT"}: ${p.code}`);
    for (const line of pay) {
      c.text(M, y, line, { size: 9, color: INK });
      y += 13;
    }
  }
  y += 8;

  for (const note of model.notes ?? []) {
    y = c.paragraph(M, y, A4.width - 2 * M, note, { size: 8, color: MUTE, lineHeight: 11 }) + 4;
  }
  for (const line of model.legal ?? []) {
    y = c.paragraph(M, y, A4.width - 2 * M, line, { size: 6.5, color: "#9CA3AF", lineHeight: 9 }) + 2;
  }

  return c;
}

/** Aplica los ganchos de inyección al lienzo. */
export function applyInject(c: Canvas, inject: Inject): void {
  const M = 48;
  if (inject.visibleNote) {
    const y = 108;
    c.rect(M, y, A4.width - 2 * M, 26, { fill: "#FEF3C7", stroke: "#F59E0B", lineWidth: 0.8, radius: 5 });
    c.rect(M, y, 4, 26, { fill: "#F59E0B", radius: 2 });
    c.text(M + 12, y + 17, inject.visibleNote, { size: 8.5, font: "sansBold", color: "#92400E" });
  }
  if (inject.hiddenWhite) {
    let hy = 300;
    for (const line of inject.hiddenWhite) {
      c.text(M, hy, line, { size: 1, color: "#FFFFFF" });
      hy += 2;
    }
  }
  if (inject.offPage) {
    let oy = A4.height + 40;
    for (const line of inject.offPage) {
      c.text(M, oy, line, { size: 7, color: "#FFFFFF" });
      oy += 10;
    }
  }
  if (inject.tinyGray) {
    let ty = A4.height - 70;
    for (const line of inject.tinyGray) {
      c.text(M, ty, line, { size: 4.5, color: "#E5E7EB" });
      ty += 6;
    }
  }
  if (inject.footnote) {
    c.text(M, A4.height - 36, inject.footnote, { size: 7, color: MUTE });
  }
}

export interface PdfMetaOverride {
  title?: string;
  author?: string;
  subject?: string;
}

export async function invoicePdf(model: InvoiceModel, inject: Inject = {}, meta: PdfMetaOverride = {}): Promise<Buffer> {
  const c = drawInvoice(model);
  applyInject(c, inject);
  return renderPdf(c.page(), {
    title: meta.title ?? `${model.title}`,
    author: meta.author ?? model.vendor.name,
    subject: meta.subject ?? `${model.title} · ${model.customer.name}`,
    createdAt: new Date("2026-10-05T14:00:00Z"),
  });
}

export async function invoicePng(model: InvoiceModel, inject: Inject = {}): Promise<Buffer> {
  const c = drawInvoice(model);
  applyInject(c, inject);
  return renderPng(c.page(), 2);
}

const DEFAULT_PHOTO: PhotoSpec = { angle: -2, surface: "desk", blur: 0.8, quality: 82, seed: 7, folded: false };

export async function invoiceJpg(
  model: InvoiceModel,
  inject: Inject = {},
  opts: { blurTags?: string[]; photo?: Partial<PhotoSpec> } = {},
): Promise<Buffer> {
  const c = drawInvoice(model);
  applyInject(c, inject);
  const photo: PhotoSpec = { ...DEFAULT_PHOTO, ...(opts.photo ?? {}) };
  return renderPhoto(c.page(), photo, { illegibleTags: opts.blurTags ?? [] });
}

/**
 * PDF "escaneado": una imagen (lo que ve una persona) cubre toda la página y encima se pone una capa
 * de texto blanco (invisible) con OTROS datos. unpdf extrae la capa de texto; el modelo ve la imagen.
 * Clásico de "OCR falso" / capa de texto plantada. Determinista.
 */
export function pdfFromImageWithTextLayer(pngBytes: Buffer, textLayerLines: string[]): Promise<Buffer> {
  const doc = new PDFDocument({ size: [A4.width, A4.height], margin: 0, compress: true, info: { Producer: "PDFKit", CreationDate: new Date("2026-10-05T14:00:00Z") } });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  doc.image(pngBytes, 0, 0, { width: A4.width, height: A4.height });
  doc.font("Helvetica").fontSize(8).fillColor("#FFFFFF", 1);
  let y = 120;
  for (const line of textLayerLines) {
    doc.text(line, 60, y, { lineBreak: false });
    y += 12;
  }
  doc.end();
  return done;
}

/**
 * Correo multipart/alternative: la parte text/plain (lo que el sistema normaliza y leen los modelos
 * y las heurísticas) y la parte text/html (lo que ve una persona en su cliente de correo) pueden
 * decir cosas distintas. Determinista.
 */
export function buildAlternativeEml(opts: {
  from: string;
  to: string;
  subject: string;
  date: string;
  messageId: string;
  text: string[];
  html: string;
}): Buffer {
  const CRLF = "\r\n";
  const boundary = `----=_alt_${opts.messageId.replace(/[^A-Za-z0-9]/g, "").slice(0, 20)}`;
  const headers = [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    `Subject: ${opts.subject}`,
    `Date: ${opts.date}`,
    `Message-ID: ${opts.messageId}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  const parts = [
    ...headers,
    "",
    "This is a multi-part message in MIME format.",
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: quoted-printable",
    "",
    encodeQuotedPrintable(opts.text.join("\n")),
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: quoted-printable",
    "",
    encodeQuotedPrintable(opts.html),
    "",
    `--${boundary}--`,
    "",
  ];
  return Buffer.from(parts.join(CRLF), "utf8");
}
