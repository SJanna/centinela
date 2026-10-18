/**
 * Plantilla «cuenta_cobro»: cuenta de cobro colombiana con forma de carta.
 * "CUENTA DE COBRO N° …", ciudad y fecha, "DEBE A:", "LA SUMA DE:" (en letras y en números),
 * "POR CONCEPTO DE:", datos para el pago y firma.
 */
import { Canvas, wrapText } from "../layout";
import { copAmountInWords, formatDate, formatPeriod } from "../format";
import type { DocumentSpec } from "../spec";
import { drawHiddenText, drawVisibleNote, fitSize, moneyOf, td } from "./common";
import { drawLogo } from "./logos";

const INK = "#1F2328";
const MUTED = "#57606A";
const RULE = "#D0D7DE";

export function renderCuentaCobro(spec: DocumentSpec): Canvas {
  const c = new Canvas();
  const W = c.width;
  const H = c.height;
  const M = 62;
  const L = spec.locale;
  const money = moneyOf(spec);
  const color = spec.brand?.color ?? "#1F3A93";
  const serif = "serif" as const;
  const serifBold = "serifBold" as const;

  // ── Membrete centrado
  if (spec.brand) drawLogo(c, spec.brand, W / 2 - 18, 34, 36, { bg: color, fg: "#FFFFFF" });
  c.field("vendorName", W / 2, 90, spec.vendor.name, { size: 12.5, font: serifBold, color: INK, align: "center" });
  if (spec.vendor.taxId) c.field("vendorTaxId", W / 2, 103, `${spec.vendor.taxIdLabel ?? "NIT"} ${spec.vendor.taxId}`, { size: 9.5, font: serif, color: MUTED, align: "center" });
  const addr = spec.vendor.address.join(" · ");
  c.text(W / 2, 115, addr, { size: fitSize(addr, serif, 9, W - 2 * M), font: serif, color: MUTED, align: "center" });
  const contact = [spec.vendor.email, spec.vendor.phone].filter(Boolean).join(" · ");
  if (contact) c.text(W / 2, 127, contact, { size: 9, font: serif, color: MUTED, align: "center" });
  c.line(M, 140, W - M, 140, color, 1.4);
  c.line(M, 143, W - M, 143, color, 0.5);

  // ── Título, lugar y fecha
  c.field("invoiceNumber", W / 2, 176, `${spec.title} N° ${spec.invoiceNumber}`, { size: 16, font: serifBold, color: INK, align: "center", letterSpacing: 0.4 });
  const placeDate = `${spec.issuePlace ? `${spec.issuePlace}, ` : ""}${formatDate(spec.issueDate, L, "long")}`;
  c.field("issueDate", W - M, 204, placeDate, { size: 10.5, font: serif, color: INK, align: "right" });

  // ── Cliente
  let y = 232;
  c.text(M, y, td(spec, "salutation", "Señores"), { size: 10.5, font: serif, color: INK });
  y += 15;
  c.field("billToName", M, y, spec.customer.name.toUpperCase(), { size: 11, font: serifBold, color: INK });
  y += 14;
  if (spec.customer.taxId) {
    c.field("billToTaxId", M, y, `${spec.customer.taxIdLabel ?? "ID"} ${spec.customer.taxId}`, { size: 10, font: serif, color: INK });
    y += 13;
  }
  c.text(M, y, spec.customer.address.join(", "), { size: 10, font: serif, color: INK });
  y += 30;

  // ── DEBE A
  c.text(W / 2, y, "DEBE A:", { size: 11, font: serifBold, color: INK, align: "center", letterSpacing: 1 });
  y += 17;
  c.text(W / 2, y, spec.vendor.name, { size: 12, font: serifBold, color: INK, align: "center" });
  y += 14;
  if (spec.vendor.taxId) c.text(W / 2, y, `${spec.vendor.taxIdLabel ?? "NIT"} ${spec.vendor.taxId}`, { size: 10, font: serif, color: INK, align: "center" });
  y += 28;

  // ── LA SUMA DE
  c.text(W / 2, y, "LA SUMA DE:", { size: 11, font: serifBold, color: INK, align: "center", letterSpacing: 1 });
  y += 17;
  const words = spec.currency === "COP" ? copAmountInWords(spec.total) : td(spec, "amountInWords");
  if (words) {
    // El valor en letras también es el total: se desenfoca con él si el total debe quedar ilegible.
    c.text(W / 2, y, words, { size: fitSize(words, serif, 11, W - 2 * M), font: serif, color: INK, align: "center", tags: ["total"] });
    y += 12;
  }
  const totalText = money(spec.total);
  const boxW = 190;
  c.rect(W / 2 - boxW / 2, y, boxW, 30, { fill: "#F6F8FA", stroke: INK, lineWidth: 0.9 });
  c.field("total", W / 2, y + 20.5, totalText, { size: 15, font: serifBold, color: INK, align: "center", tags: ["total"] });
  y += 54;

  // ── POR CONCEPTO DE
  c.text(M, y, "POR CONCEPTO DE:", { size: 11, font: serifBold, color: INK, letterSpacing: 1 });
  y += 16;
  y = c.paragraph(M, y, W - 2 * M, td(spec, "concept", spec.lines.map((l) => l.description).join("; ")), { size: 10.5, font: serif, color: INK, lineHeight: 14 });
  y += 8;

  // Tabla breve
  const colPeriod = W - M - 190;
  const colValue = W - M - 6;
  c.rect(M, y, W - 2 * M, 20, { fill: "#F6F8FA", stroke: RULE, lineWidth: 0.7 });
  c.text(M + 8, y + 13.5, "Concepto", { size: 9.5, font: serifBold, color: INK });
  c.text(colPeriod, y + 13.5, "Periodo", { size: 9.5, font: serifBold, color: INK });
  c.text(colValue, y + 13.5, "Valor", { size: 9.5, font: serifBold, color: INK, align: "right" });
  y += 20;
  for (const line of spec.lines) {
    const desc = wrapText(line.description, serif, 10, colPeriod - M - 20);
    const rowH = 8 + desc.length * 12.5;
    c.rect(M, y, W - 2 * M, rowH, { fill: null, stroke: RULE, lineWidth: 0.7 });
    desc.forEach((d, i) => c.text(M + 8, y + 14 + i * 12.5, d, { size: 10, font: serif, color: INK }));
    if (spec.servicePeriod) c.field("servicePeriod", colPeriod, y + 14, formatPeriod(spec.servicePeriod, L, "title"), { size: 10, font: serif, color: INK });
    c.text(colValue, y + 14, money(line.amount), { size: 10, font: serif, color: INK, align: "right" });
    y += rowH;
  }
  y += 14;
  const sumRow = (label: string, value: string, key: "subtotal" | "tax" | "total", bold = false) => {
    c.text(colPeriod, y, label, { size: 10, font: bold ? serifBold : serif, color: INK });
    c.field(key, colValue, y, value, { size: 10, font: bold ? serifBold : serif, color: INK, align: "right", tags: key === "total" ? ["total"] : [] });
    if (key === "total") c.citeWithLabel("total", label, value);
    y += 14;
  };
  if (spec.subtotal != null) sumRow("Subtotal", money(spec.subtotal), "subtotal");
  if (spec.tax) sumRow(spec.tax.label, money(spec.tax.amount), "tax");
  sumRow("Total a cobrar", totalText, "total", true);
  y += 6;

  c.text(M, y, "Moneda:", { size: 10, font: serifBold, color: INK });
  c.field("currency", M + 52, y, td(spec, "currencyText", spec.currency), { size: 10, font: serif, color: INK });
  y += 14;
  if (spec.dueDate) {
    c.text(M, y, "Fecha límite de pago:", { size: 10, font: serifBold, color: INK });
    c.field("dueDate", M + 118, y, formatDate(spec.dueDate, L, "long"), { size: 10, font: serif, color: INK });
    y += 14;
  }
  y += 10;

  // ── Datos para el pago
  if (spec.payment) {
    const p = spec.payment;
    c.text(M, y, "DATOS PARA EL PAGO", { size: 10.5, font: serifBold, color: INK, letterSpacing: 0.8 });
    y += 15;
    const rows: Array<[string, string, "beneficiaryName" | "bankName" | "accountNumber" | "routingOrSwift"]> = [
      ["Titular:", p.beneficiaryName, "beneficiaryName"],
      ["Banco:", p.bankName, "bankName"],
      [p.accountLabel, p.accountNumber, "accountNumber"],
    ];
    if (p.routingOrSwift) rows.push([p.routingLabel ?? "SWIFT:", p.routingOrSwift, "routingOrSwift"]);
    for (const [label, value, key] of rows) {
      c.text(M, y, label, { size: 10, font: serif, color: MUTED });
      c.field(key, M + 140, y, value, { size: 10, font: serifBold, color: INK });
      y += 13.5;
    }
    y += 6;
  }

  y = drawVisibleNote(c, spec, M, y, W - 2 * M);
  for (const note of spec.notes) {
    y = c.paragraph(M, y, W - 2 * M, note, { size: 9, font: "serifItalic", color: MUTED, lineHeight: 12 });
  }

  // ── Firma
  const sy = Math.max(y + 18, H - 112);
  c.text(M, sy, "Atentamente,", { size: 10.5, font: serif, color: INK });
  const sx = M + 6;
  const base = sy + 38;
  c.path(
    `M${sx} ${base} C${sx + 10} ${base - 30}, ${sx + 22} ${base - 34}, ${sx + 26} ${base - 12} S${sx + 30} ${base + 6}, ${sx + 44} ${base - 14} ` +
      `C${sx + 52} ${base - 26}, ${sx + 58} ${base - 6}, ${sx + 66} ${base - 10} S${sx + 84} ${base - 30}, ${sx + 92} ${base - 6} ` +
      `C${sx + 98} ${base + 6}, ${sx + 112} ${base - 20}, ${sx + 130} ${base - 16} M${sx + 20} ${base - 4} L${sx + 140} ${base - 9}`,
    { fill: null, stroke: "#1E3A8A", lineWidth: 1.3, lineCap: "round" },
  );
  c.line(M, base + 8, M + 190, base + 8, INK, 0.7);
  c.text(M, base + 21, td(spec, "signerName", spec.vendor.name), { size: 10.5, font: serifBold, color: INK });
  const role = td(spec, "signerRole");
  if (role) c.text(M, base + 34, role, { size: 9.5, font: serif, color: MUTED });
  const sid = td(spec, "signerId");
  if (sid) c.text(M, base + 46, sid, { size: 9.5, font: serif, color: MUTED });
  drawHiddenText(c, spec, M, H - 20);
  return c;
}
