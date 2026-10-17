/**
 * Plantilla «saas»: factura en inglés de una empresa de software de EE. UU.
 * Limpia, mucho blanco, un acento de color, logo arriba a la derecha y el monto a pagar
 * destacado como frase ("$1,200.00 USD due October 15, 2026").
 */
import { Canvas, wrapText } from "../layout";
import { formatDate, formatPeriod, formatQuantity } from "../format";
import type { DocumentSpec } from "../spec";
import { drawHiddenText, drawVisibleNote, moneyOf, td } from "./common";
import { drawLogo } from "./logos";

const INK = "#1A1F36";
const MUTED = "#697386";
const HAIR = "#E3E8EE";
const SOFT = "#F6F8FA";

export function renderSaas(spec: DocumentSpec): Canvas {
  const c = new Canvas();
  const W = c.width;
  const H = c.height;
  const M = 48;
  const L = spec.locale;
  const money = moneyOf(spec);
  const brand = spec.brand ?? { color: "#4F46E5", accent: null, logo: "bars" as const, initials: null, wordmark: spec.vendor.name, tagline: null };

  // Franja de acento y encabezado
  c.rect(0, 0, W, 5, { fill: brand.color });
  c.text(M, 76, spec.title, { size: 26, font: "sansBold", color: INK });
  drawLogo(c, brand, W - M - 34, 46, 34, { bg: brand.color, fg: "#FFFFFF" });
  c.text(W - M - 44, 64, brand.wordmark, { size: 15, font: "sansBold", color: INK, align: "right" });
  if (brand.tagline) c.text(W - M - 44, 76, brand.tagline, { size: 7.5, color: MUTED, align: "right" });

  // Datos del documento
  let y = 112;
  const meta = (label: string, value: string, key?: Parameters<Canvas["field"]>[0]) => {
    c.text(M, y, label, { size: 9, color: MUTED });
    if (key) c.field(key, M + 108, y, value, { size: 9, font: "sansBold", color: INK });
    else c.text(M + 108, y, value, { size: 9, font: "sansBold", color: INK });
    y += 15;
  };
  meta("Invoice number", spec.invoiceNumber, "invoiceNumber");
  meta("Date of issue", formatDate(spec.issueDate, L, "long"), "issueDate");
  if (spec.dueDate) meta("Date due", formatDate(spec.dueDate, L, "long"), "dueDate");
  if (spec.servicePeriod) meta("Billing period", formatPeriod(spec.servicePeriod, L, "range"), "servicePeriod");
  meta("Currency", spec.currency, "currency");
  if (spec.paymentTerms) meta("Payment terms", spec.paymentTerms);

  // Partes
  y += 20;
  const top = y;
  // Emisor
  c.field("vendorName", M, y, spec.vendor.name, { size: 9.5, font: "sansBold", color: INK });
  y += 13;
  for (const line of spec.vendor.address) {
    c.text(M, y, line, { size: 8.5, color: MUTED });
    y += 12;
  }
  if (spec.vendor.email) {
    c.text(M, y, spec.vendor.email, { size: 8.5, color: MUTED });
    y += 12;
  }
  if (spec.vendor.taxId) c.field("vendorTaxId", M, y, `${spec.vendor.taxIdLabel ?? "Tax ID"} ${spec.vendor.taxId}`, { size: 8.5, color: MUTED });
  const vendorBottom = y;
  // Cliente
  let cy = top;
  const cx = M + 180;
  c.text(cx, cy, "Bill to", { size: 9.5, font: "sansBold", color: INK });
  cy += 13;
  for (const line of [spec.customer.name, ...spec.customer.address]) {
    c.text(cx, cy, line, { size: 8.5, color: MUTED });
    cy += 12;
  }
  if (spec.customer.email) {
    c.text(cx, cy, spec.customer.email, { size: 8.5, color: MUTED });
    cy += 12;
  }
  if (spec.customer.taxId) c.text(cx, cy, `${spec.customer.taxIdLabel ?? "Tax ID"} ${spec.customer.taxId}`, { size: 8.5, color: MUTED });
  // Referencias
  const rx = M + 360;
  let ry = top;
  const refs = [
    ["Customer ID", td(spec, "customerId")],
    ["Plan", td(spec, "plan")],
    ["PO number", td(spec, "poNumber")],
  ].filter(([, v]) => v);
  if (refs.length > 0) {
    c.text(rx, ry, "Details", { size: 9.5, font: "sansBold", color: INK });
    ry += 13;
    for (const [k, v] of refs) {
      c.text(rx, ry, `${k}: ${v}`, { size: 8.5, color: MUTED });
      ry += 12;
    }
  }
  y = Math.max(vendorBottom, cy, ry) + 34;

  // Monto destacado
  const heroDate = spec.dueDate ? ` due ${formatDate(spec.dueDate, L, "long")}` : "";
  c.text(M, y, `${money(spec.total)} ${spec.currency}${heroDate}`, { size: 17, font: "sansBold", color: INK, tags: ["total"] });
  y += 18;
  const heroNote = td(spec, "heroNote");
  if (heroNote) {
    c.text(M, y, heroNote, { size: 9, color: MUTED });
    y += 10;
  }
  y += 22;

  // Tabla de conceptos
  const colQty = W - M - 190;
  const colUnit = W - M - 95;
  c.text(M, y, "Description", { size: 8, color: MUTED });
  c.text(colQty, y, "Qty", { size: 8, color: MUTED, align: "right" });
  c.text(colUnit, y, "Unit price", { size: 8, color: MUTED, align: "right" });
  c.text(W - M, y, "Amount", { size: 8, color: MUTED, align: "right" });
  y += 7;
  c.line(M, y, W - M, y, HAIR, 0.8);
  y += 16;
  for (const line of spec.lines) {
    const descLines = wrapText(line.description, "sans", 9.5, colQty - M - 70);
    const rowTop = y;
    descLines.forEach((d, i) => c.text(M, y + i * 12.5, d, { size: 9.5, color: INK }));
    y += (descLines.length - 1) * 12.5;
    if (line.detail) {
      y += 12;
      c.text(M, y, line.detail, { size: 8, color: MUTED });
    }
    if (line.quantity != null) c.text(colQty, rowTop, formatQuantity(line.quantity, line.unit, L), { size: 9.5, color: INK, align: "right" });
    if (line.unitPrice != null) c.text(colUnit, rowTop, money(line.unitPrice), { size: 9.5, color: INK, align: "right" });
    c.text(W - M, rowTop, money(line.amount), { size: 9.5, color: INK, align: "right" });
    y += 10;
    c.line(M, y, W - M, y, HAIR, 0.6);
    y += 16;
  }

  // Resumen
  const sx = W / 2 + 30;
  y += 2;
  const sumRow = (label: string, value: string, opts: { bold?: boolean; key?: Parameters<Canvas["field"]>[0]; tags?: string[] } = {}) => {
    const font = opts.bold ? "sansBold" : "sans";
    c.text(sx, y, label, { size: 9.5, font, color: INK });
    if (opts.key) c.field(opts.key, W - M, y, value, { size: 9.5, font, color: INK, align: "right", tags: opts.tags });
    else c.text(W - M, y, value, { size: 9.5, font, color: INK, align: "right", tags: opts.tags });
    y += 9;
    c.line(sx, y, W - M, y, HAIR, 0.6);
    y += 15;
  };
  if (spec.subtotal != null) sumRow("Subtotal", money(spec.subtotal), { key: "subtotal" });
  if (spec.tax) sumRow(spec.tax.label, money(spec.tax.amount), { key: "tax" });
  sumRow("Total", money(spec.total), { key: "total", tags: ["total"] });
  sumRow("Amount due", `${money(spec.total)} ${spec.currency}`, { bold: true, tags: ["total"] });

  // Pago
  y += 14;
  if (spec.payment) {
    const p = spec.payment;
    const rows: Array<[string, string, Parameters<Canvas["field"]>[0] | null]> = [
      ["Beneficiary", p.beneficiaryName, "beneficiaryName"],
      ["Bank", p.bankName, "bankName"],
      [p.accountLabel, p.accountNumber, "accountNumber"],
    ];
    if (p.routingOrSwift) rows.push([p.routingLabel ?? "Routing", p.routingOrSwift, "routingOrSwift"]);
    rows.push(["Reference", spec.invoiceNumber, null]);
    const boxH = 40 + rows.length * 15;
    c.rect(M, y, W - 2 * M, boxH, { fill: SOFT, radius: 8 });
    c.rect(M, y, 4, boxH, { fill: brand.color, radius: 2 });
    c.text(M + 20, y + 22, td(spec, "paymentTitle", "Pay by bank transfer"), { size: 10, font: "sansBold", color: INK });
    const sub = td(spec, "paymentSubtitle");
    if (sub) c.text(W - M - 18, y + 22, sub, { size: 8, color: MUTED, align: "right" });
    let py = y + 42;
    for (const [label, value, key] of rows) {
      c.text(M + 20, py, label, { size: 8.5, color: MUTED });
      if (key) c.field(key, M + 160, py, value, { size: 9, font: "sansBold", color: INK });
      else c.text(M + 160, py, value, { size: 9, font: "sansBold", color: INK });
      py += 15;
    }
    y += boxH + 22;
  }

  y = drawVisibleNote(c, spec, M, y, W - 2 * M);
  for (const note of spec.notes) {
    y = c.paragraph(M, y, W - 2 * M, note, { size: 8.5, color: MUTED, lineHeight: 12 });
    y += 2;
  }

  // Pie
  c.line(M, H - 58, W - M, H - 58, HAIR, 0.8);
  const footerLeft = `${spec.invoiceNumber} · ${money(spec.total)} ${spec.currency}${heroDate}`;
  // Lleva la etiqueta "total": si el total debe quedar ilegible (foto), el pie tampoco lo deja leer.
  c.text(M, H - 42, footerLeft, { size: 8, color: MUTED, tags: ["total"] });
  c.text(W - M, H - 42, "Page 1 of 1", { size: 8, color: MUTED, align: "right" });
  const legalY = H - 30;
  spec.legal.forEach((l, i) => c.text(M, legalY + i * 10, l, { size: 7, color: MUTED }));
  drawHiddenText(c, spec, M, H - 14);
  return c;
}
