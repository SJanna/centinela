/**
 * Plantilla «latam»: factura genérica latinoamericana en español (Colombia, México, Perú,
 * Chile…). Banda superior con el color del proveedor, tarjetas de cliente y fechas, tabla con
 * encabezado teñido, total destacado, datos bancarios y pie legal con código QR o timbre.
 */
import { Canvas, drawQrLike, drawStackedBarcode, shade, tint, wrapText } from "../layout";
import { amountInWords, formatDate, formatPeriod, formatQuantity } from "../format";
import type { DocumentSpec, EvidenceKey } from "../spec";
import { drawHiddenText, drawVisibleNote, fitSize, moneyOf, td } from "./common";
import { drawLogo } from "./logos";

const INK = "#0F172A";
const MUTED = "#64748B";
const HAIR = "#E2E8F0";
const CARD = "#F8FAFC";

export function renderLatam(spec: DocumentSpec): Canvas {
  const c = new Canvas();
  const W = c.width;
  const H = c.height;
  const M = 40;
  const L = spec.locale;
  const money = moneyOf(spec);
  const brand = spec.brand ?? { color: "#334155", accent: null, logo: "dots" as const, initials: null, wordmark: spec.vendor.name, tagline: null };
  const color = brand.color;
  const accent = brand.accent ?? "#FFFFFF";

  // ── Banda superior
  const bandH = 118;
  c.rect(0, 0, W, bandH, { fill: color });
  c.circle(W - 70, 4, 120, { fill: "#FFFFFF", opacity: 0.06 });
  c.circle(W - 4, bandH - 6, 64, { fill: "#FFFFFF", opacity: 0.05 });
  c.rect(0, bandH - 4, W, 4, { fill: accent, opacity: brand.accent ? 1 : 0.18 });
  drawLogo(c, brand, M, 34, 46, { bg: "#FFFFFF", fg: color });
  const nameSize = fitSize(spec.vendor.name, "sansBold", 15, 250);
  c.field("vendorName", M + 60, 50, spec.vendor.name, { size: nameSize, font: "sansBold", color: "#FFFFFF" });
  if (spec.vendor.taxId) {
    c.field("vendorTaxId", M + 60, 65, `${spec.vendor.taxIdLabel ?? "ID"} ${spec.vendor.taxId}`, { size: 8.5, font: "sansBold", color: "#FFFFFF", opacity: 0.92 });
  }
  const addr = spec.vendor.address.join(" · ");
  c.text(M + 60, 78, addr, { size: fitSize(addr, "sans", 7.5, 260), color: "#FFFFFF", opacity: 0.85 });
  const contact = [spec.vendor.email, spec.vendor.phone].filter(Boolean).join(" · ");
  if (contact) c.text(M + 60, 90, contact, { size: 7.5, color: "#FFFFFF", opacity: 0.85 });

  const titleSize = fitSize(spec.title, "sansBold", 8.5, 220);
  c.text(W - M, 48, spec.title, { size: titleSize, font: "sansBold", color: "#FFFFFF", align: "right", letterSpacing: 0.8 });
  c.field("invoiceNumber", W - M, 76, `N° ${spec.invoiceNumber}`, { size: 19, font: "sansBold", color: "#FFFFFF", align: "right" });
  const subtitle = td(spec, "subtitle");
  if (subtitle) c.text(W - M, 92, subtitle, { size: 7.5, color: "#FFFFFF", opacity: 0.85, align: "right" });

  // ── Tarjetas: cliente y datos del documento
  const cardY = 138;
  const cardH = 108;
  const leftW = 246;
  c.rect(M, cardY, leftW, cardH, { fill: CARD, stroke: HAIR, lineWidth: 0.8, radius: 8 });
  c.text(M + 14, cardY + 20, "FACTURAR A", { size: 7, font: "sansBold", color, letterSpacing: 0.8 });
  c.field("billToName", M + 14, cardY + 37, spec.customer.name, { size: 10.5, font: "sansBold", color: INK });
  let ly = cardY + 51;
  if (spec.customer.taxId) {
    c.field("billToTaxId", M + 14, ly, `${spec.customer.taxIdLabel ?? "ID"} ${spec.customer.taxId}`, { size: 8, color: MUTED });
    ly += 11.5;
  }
  for (const line of spec.customer.address) {
    c.text(M + 14, ly, line, { size: 8, color: MUTED });
    ly += 11.5;
  }

  const rx = M + leftW + 12;
  const rw = W - M - rx;
  c.rect(rx, cardY, rw, cardH, { fill: CARD, stroke: HAIR, lineWidth: 0.8, radius: 8 });
  const metaItems: Array<[string, string, EvidenceKey | null]> = [
    ["FECHA DE EMISIÓN", formatDate(spec.issueDate, L, "short"), "issueDate"],
    ["VENCIMIENTO", spec.dueDate ? formatDate(spec.dueDate, L, "short") : "—", spec.dueDate ? "dueDate" : null],
    ["PERIODO FACTURADO", spec.servicePeriod ? formatPeriod(spec.servicePeriod, L, "title") : "—", spec.servicePeriod ? "servicePeriod" : null],
    ["MONEDA", spec.currency, "currency"],
  ];
  if (spec.paymentTerms) metaItems.push(["FORMA DE PAGO", spec.paymentTerms, null]);
  const ref = td(spec, "reference");
  if (ref) metaItems.push([td(spec, "referenceLabel", "REFERENCIA"), ref, null]);
  const colW = rw / 2;
  metaItems.slice(0, 6).forEach(([label, value, key], i) => {
    const mx = rx + 14 + (i % 2) * colW;
    const my = cardY + 20 + Math.floor(i / 2) * 32;
    c.text(mx, my, label, { size: 6.8, font: "sansBold", color: MUTED, letterSpacing: 0.6 });
    const vs = fitSize(value, "sansBold", 9.5, colW - 20);
    if (key) c.field(key, mx, my + 13, value, { size: vs, font: "sansBold", color: INK });
    else c.text(mx, my + 13, value, { size: vs, font: "sansBold", color: INK });
  });

  // ── Tabla
  let y = cardY + cardH + 22;
  const colQty = W - M - 212;
  const colUnit = W - M - 108;
  c.rect(M, y, W - 2 * M, 24, { fill: tint(color, 0.9), radius: 5 });
  const head = { size: 7, font: "sansBold" as const, color: shade(color, 0.25), letterSpacing: 0.6 };
  c.text(M + 12, y + 15.5, "DESCRIPCIÓN", head);
  c.text(colQty, y + 15.5, "CANT.", { ...head, align: "right" });
  c.text(colUnit, y + 15.5, "VALOR UNITARIO", { ...head, align: "right" });
  c.text(W - M - 12, y + 15.5, "VALOR TOTAL", { ...head, align: "right" });
  y += 24 + 18;
  for (const line of spec.lines) {
    const descLines = wrapText(line.description, "sans", 9.2, colQty - M - 70);
    const rowTop = y;
    descLines.forEach((d, i) => c.text(M + 12, y + i * 12, d, { size: 9.2, color: INK }));
    y += (descLines.length - 1) * 12;
    if (line.detail) {
      y += 11.5;
      c.text(M + 12, y, line.detail, { size: 7.5, color: MUTED });
    }
    if (line.quantity != null) c.text(colQty, rowTop, formatQuantity(line.quantity, line.unit, L), { size: 9.2, color: INK, align: "right" });
    if (line.unitPrice != null) c.text(colUnit, rowTop, money(line.unitPrice), { size: 9.2, color: INK, align: "right" });
    c.text(W - M - 12, rowTop, money(line.amount), { size: 9.2, font: "sansBold", color: INK, align: "right" });
    y += 10;
    c.line(M, y, W - M, y, HAIR, 0.7);
    y += 18;
  }

  // ── Totales (derecha) y datos bancarios (izquierda)
  const blockTop = y + 4;
  const tw = 228;
  const tx = W - M - tw;
  let ty = blockTop + 10;
  const totRow = (label: string, value: string, key: EvidenceKey) => {
    c.text(tx + 4, ty, label, { size: fitSize(label, "sans", 8.8, tw - 100), color: MUTED });
    c.field(key, W - M - 12, ty, value, { size: 9.2, font: "sansBold", color: INK, align: "right" });
    ty += 8;
    c.line(tx, ty, W - M, ty, HAIR, 0.6);
    ty += 15;
  };
  if (spec.subtotal != null) totRow("Subtotal", money(spec.subtotal), "subtotal");
  if (spec.tax) totRow(spec.tax.label, money(spec.tax.amount), "tax");
  ty += 2;
  c.rect(tx, ty - 12, tw, 42, { fill: color, radius: 7 });
  c.text(tx + 14, ty + 13, "TOTAL A PAGAR", { size: 7.5, font: "sansBold", color: "#FFFFFF", letterSpacing: 0.8 });
  const totalText = money(spec.total);
  c.field("total", W - M - 14, ty + 15, totalText, {
    size: fitSize(totalText, "sansBold", 15, tw - 120),
    font: "sansBold",
    color: "#FFFFFF",
    align: "right",
    tags: ["total"],
  });
  c.citeWithLabel("total", "TOTAL A PAGAR", totalText);
  ty += 42;

  let py = blockTop;
  if (spec.payment) {
    const p = spec.payment;
    const pw = tx - M - 16;
    const rows: Array<[string, string, EvidenceKey]> = [
      ["Titular", p.beneficiaryName, "beneficiaryName"],
      ["Banco", p.bankName, "bankName"],
      [p.accountLabel, p.accountNumber, "accountNumber"],
    ];
    if (p.routingOrSwift) rows.push([p.routingLabel ?? "SWIFT", p.routingOrSwift, "routingOrSwift"]);
    const ph = 34 + rows.length * 15;
    c.rect(M, py - 4, pw, ph, { fill: CARD, stroke: HAIR, lineWidth: 0.8, radius: 8 });
    c.text(M + 14, py + 14, "DATOS PARA EL PAGO", { size: 7, font: "sansBold", color, letterSpacing: 0.8 });
    let ry = py + 32;
    for (const [label, value, key] of rows) {
      c.text(M + 14, ry, label, { size: 8, color: MUTED });
      c.field(key, M + 98, ry, value, { size: fitSize(value, "sansBold", 9, pw - 110), font: "sansBold", color: INK });
      ry += 15;
    }
    py += ph;
  }
  y = Math.max(py, ty) + 22;

  // ── Valor en letras (no se dibuja si el total debe quedar ilegible en la foto)
  const words = spec.blurTotal ? null : amountInWords(spec.total, spec.currency);
  if (words) {
    const wl = c.text(M, y, "SON:", { size: 7, font: "sansBold", color, letterSpacing: 0.8 });
    c.text(M + wl + 8, y, words, { size: fitSize(words, "sansBold", 8.5, W - 2 * M - wl - 8), font: "sansBold", color: INK });
    y += 8;
    c.line(M, y, W - M, y, HAIR, 0.7);
    y += 22;
  }

  // ── Observaciones y nota visible
  y = drawVisibleNote(c, spec, M, y, W - 2 * M);
  if (spec.notes.length > 0) {
    c.text(M, y, "OBSERVACIONES", { size: 7, font: "sansBold", color, letterSpacing: 0.8 });
    y += 13;
    for (const note of spec.notes) {
      y = c.paragraph(M, y, W - 2 * M, note, { size: 8.2, color: MUTED, lineHeight: 11.5 });
      y += 2;
    }
  }

  // ── Pie legal con QR o timbre
  const footerTop = H - 128;
  const code = td(spec, "code");
  const codeW = code === "barcode" ? 150 : code === "qr" ? 64 : 0;
  if (code === "qr") drawQrLike(c, W - M - 64, footerTop, 64, `${spec.vendor.taxId}|${spec.invoiceNumber}|${spec.total}`);
  if (code === "barcode") {
    drawStackedBarcode(c, W - M - 150, footerTop, 150, 46, `${spec.vendor.taxId}|${spec.invoiceNumber}`);
    c.text(W - M - 75, footerTop + 58, td(spec, "barcodeCaption", "Timbre electrónico"), { size: 6.5, color: MUTED, align: "center" });
  }
  let fy = footerTop + 8;
  const legalW = W - 2 * M - (codeW ? codeW + 18 : 0);
  for (const l of spec.legal) {
    for (const part of wrapText(l, "sans", 6.8, legalW)) {
      c.text(M, fy, part, { size: 6.8, color: MUTED });
      fy += 9.5;
    }
  }
  c.rect(0, H - 30, W, 30, { fill: tint(color, 0.92) });
  c.rect(0, H - 30, W, 1.5, { fill: color });
  const foot = [spec.vendor.name, spec.vendor.email, spec.vendor.phone].filter(Boolean).join("  ·  ");
  c.text(M, H - 12, foot, { size: 7, color: shade(color, 0.3) });
  c.text(W - M, H - 12, "Página 1 de 1", { size: 7, color: shade(color, 0.3), align: "right" });
  drawHiddenText(c, spec, M, H - 40);
  return c;
}
