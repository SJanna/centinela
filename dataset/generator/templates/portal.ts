/**
 * Plantilla «portal»: captura de pantalla del portal de facturación de un SaaS (navegador con
 * barra de direcciones, menú lateral oscuro, tarjetas con el monto y el vencimiento, detalle
 * de la factura y datos para transferencia). Pensada para PNG.
 */
import { Canvas, tint } from "../layout";
import { formatDate, formatPeriod, formatQuantity } from "../format";
import type { DocumentSpec, EvidenceKey } from "../spec";
import { moneyOf, td } from "./common";
import { drawLogo } from "./logos";

const INK = "#0F172A";
const MUTED = "#64748B";
const HAIR = "#E2E8F0";

export const PORTAL_SIZE = { width: 1000, height: 700 } as const;

export function renderPortal(spec: DocumentSpec): Canvas {
  const c = new Canvas(PORTAL_SIZE.width, PORTAL_SIZE.height, "#F8FAFC");
  const W = c.width;
  const H = c.height;
  const L = spec.locale;
  const money = moneyOf(spec);
  const brand = spec.brand ?? { color: "#4F46E5", accent: null, logo: "bars" as const, initials: null, wordmark: spec.vendor.name, tagline: null };
  const color = brand.color;

  // ── Navegador
  c.rect(0, 0, W, 36, { fill: "#DEE1E6" });
  [["#FF5F57", 18], ["#FEBC2E", 36], ["#28C840", 54]].forEach(([col, x]) => c.circle(x as number, 18, 5.5, { fill: col as string }));
  c.rect(78, 7, 250, 29, { fill: "#FFFFFF", radius: 8 });
  drawLogo(c, brand, 90, 15, 12, { bg: color, fg: "#FFFFFF" });
  c.text(108, 25, `Invoice ${spec.invoiceNumber} · ${brand.wordmark}`, { size: 9, color: "#3C4043" });
  c.rect(0, 36, W, 34, { fill: "#FFFFFF" });
  c.rect(96, 42, 760, 22, { fill: "#F1F3F4", radius: 11 });
  c.path("M110 50 h7 v8 h-7 Z M111.5 50 v-2.5 a2 2 0 0 1 4 0 v2.5", { fill: null, stroke: "#5F6368", lineWidth: 1.1 });
  c.text(126, 57, td(spec, "url", "billing.example.com"), { size: 9.5, color: "#3C4043" });
  c.path("M24 49 l-4 4 l4 4", { fill: null, stroke: "#5F6368", lineWidth: 1.4, lineCap: "round" });
  c.path("M42 49 l4 4 l-4 4", { fill: null, stroke: "#BDC1C6", lineWidth: 1.4, lineCap: "round" });
  c.path("M72.5 50 A5 5 0 1 0 73.5 55", { fill: null, stroke: "#5F6368", lineWidth: 1.3, lineCap: "round" });
  c.path("M70.5 48.5 l3 1.6 l-1.6 3", { fill: null, stroke: "#5F6368", lineWidth: 1.3, lineCap: "round" });
  c.line(0, 70, W, 70, "#DADCE0", 1);

  // ── Menú lateral
  const SW = 196;
  c.rect(0, 70.5, SW, H - 70.5, { fill: "#0B1220" });
  drawLogo(c, brand, 20, 90, 26, { bg: color, fg: "#FFFFFF" });
  c.text(54, 108, brand.wordmark, { size: 13, font: "sansBold", color: "#FFFFFF" });
  const nav = ["Overview", "Dashboards", "Monitors", "Alerts", "Integrations", "Billing", "Settings"];
  nav.forEach((item, i) => {
    const ny = 156 + i * 30;
    const active = item === "Billing";
    if (active) c.rect(12, ny - 15, SW - 24, 24, { fill: "#FFFFFF", opacity: 0.08, radius: 6 });
    if (active) c.rect(12, ny - 15, 3, 24, { fill: color, radius: 1.5 });
    c.circle(32, ny - 3, 3.2, { fill: active ? color : "#475569" });
    c.text(46, ny + 1, item, { size: 10, font: active ? "sansBold" : "sans", color: active ? "#FFFFFF" : "#94A3B8" });
  });
  c.rect(12, H - 66, SW - 24, 46, { fill: "#FFFFFF", opacity: 0.05, radius: 8 });
  c.circle(34, H - 43, 11, { fill: tint(color, 0.2) });
  c.text(34, H - 39.5, "AL", { size: 8, font: "sansBold", color: "#FFFFFF", align: "center" });
  c.text(52, H - 46, spec.customer.name, { size: 9, font: "sansBold", color: "#FFFFFF" });
  c.text(52, H - 34, td(spec, "plan", "Team plan"), { size: 8, color: "#94A3B8" });

  // ── Encabezado de la página
  const X = SW + 32;
  const R = W - 32;
  const bw = c.text(X, 100, "Billing  ›  Invoices  ›", { size: 9, color: MUTED });
  c.text(X + bw + 5, 100, spec.invoiceNumber, { size: 9, color: INK });
  const tw = c.field("invoiceNumber", X, 134, `Invoice ${spec.invoiceNumber}`, { size: 20, font: "sansBold", color: INK });
  c.rect(X + tw + 12, 118, 46, 20, { fill: "#FEF3C7", radius: 10 });
  c.text(X + tw + 35, 132, td(spec, "status", "Open"), { size: 9, font: "sansBold", color: "#B45309", align: "center" });
  c.rect(R - 230, 116, 112, 28, { fill: "#FFFFFF", stroke: HAIR, lineWidth: 1, radius: 7 });
  c.text(R - 174, 134, "Download PDF", { size: 9.5, font: "sansBold", color: INK, align: "center" });
  c.rect(R - 108, 116, 108, 28, { fill: color, radius: 7 });
  c.text(R - 54, 134, "Payment details", { size: 9.5, font: "sansBold", color: "#FFFFFF", align: "center" });

  // ── Tarjetas
  const cardY = 160;
  const gap = 14;
  const cw = (R - X - 2 * gap) / 3;
  const card = (i: number, label: string, value: string, key: EvidenceKey | null, sub: string | null, tags: string[] = []) => {
    const x = X + i * (cw + gap);
    c.rect(x, cardY, cw, 78, { fill: "#FFFFFF", stroke: HAIR, lineWidth: 1, radius: 10 });
    c.text(x + 16, cardY + 24, label, { size: 9, color: MUTED });
    const style = { size: i === 0 ? 22 : 15, font: "sansBold" as const, color: INK, tags };
    const vw = key ? c.field(key, x + 16, cardY + 54, value, style) : c.text(x + 16, cardY + 54, value, style);
    if (key === "total") c.citeWithLabel("total", label, value);
    if (sub) c.text(x + 16 + vw + 6, cardY + 54, sub, { size: 10, font: "sansBold", color: MUTED });
  };
  card(0, "Amount due", money(spec.total), "total", spec.currency, ["total"]);
  card(1, "Due date", spec.dueDate ? formatDate(spec.dueDate, L, "medium") : "—", spec.dueDate ? "dueDate" : null, null);
  card(2, "Billing period", spec.servicePeriod ? formatPeriod(spec.servicePeriod, L, "range") : "—", spec.servicePeriod ? "servicePeriod" : null, null);

  // ── Detalle de la factura
  const detY = 254;
  const detW = (R - X) * 0.6;
  c.rect(X, detY, detW, H - detY - 24, { fill: "#FFFFFF", stroke: HAIR, lineWidth: 1, radius: 10 });
  const dx = X + 18;
  const dr = X + detW - 18;
  let y = detY + 26;
  c.text(dx, y, "Invoice details", { size: 11, font: "sansBold", color: INK });
  y += 22;
  const half = (detW - 36) / 2;
  c.text(dx, y, "From", { size: 8, font: "sansBold", color: MUTED });
  c.text(dx + half, y, "Billed to", { size: 8, font: "sansBold", color: MUTED });
  y += 14;
  c.field("vendorName", dx, y, spec.vendor.name, { size: 9.5, font: "sansBold", color: INK });
  c.field("billToName", dx + half, y, spec.customer.name, { size: 9.5, font: "sansBold", color: INK });
  let vy = y + 13;
  for (const line of spec.vendor.address.slice(0, 2)) {
    c.text(dx, vy, line, { size: 8.5, color: MUTED });
    vy += 12;
  }
  if (spec.vendor.taxId) c.field("vendorTaxId", dx, vy, `${spec.vendor.taxIdLabel ?? "Tax ID"} ${spec.vendor.taxId}`, { size: 8.5, color: MUTED });
  let cy = y + 13;
  for (const line of spec.customer.address.slice(0, 2)) {
    c.text(dx + half, cy, line, { size: 8.5, color: MUTED });
    cy += 12;
  }
  c.text(dx + half, cy, `Issued ${formatDate(spec.issueDate, L, "medium")}`, { size: 8.5, color: MUTED });
  c.cite("issueDate", formatDate(spec.issueDate, L, "medium"));
  y = Math.max(vy, cy) + 24;

  const colQty = dr - 170;
  const colUnit = dr - 85;
  c.text(dx, y, "DESCRIPTION", { size: 7.5, font: "sansBold", color: MUTED, letterSpacing: 0.5 });
  c.text(colQty, y, "QTY", { size: 7.5, font: "sansBold", color: MUTED, align: "right", letterSpacing: 0.5 });
  c.text(colUnit, y, "UNIT PRICE", { size: 7.5, font: "sansBold", color: MUTED, align: "right", letterSpacing: 0.5 });
  c.text(dr, y, "AMOUNT", { size: 7.5, font: "sansBold", color: MUTED, align: "right", letterSpacing: 0.5 });
  y += 8;
  c.line(dx, y, dr, y, HAIR, 1);
  y += 18;
  for (const line of spec.lines) {
    c.text(dx, y, line.description, { size: 9.5, color: INK });
    if (line.quantity != null) c.text(colQty, y, formatQuantity(line.quantity, line.unit, L), { size: 9.5, color: INK, align: "right" });
    if (line.unitPrice != null) c.text(colUnit, y, money(line.unitPrice), { size: 9.5, color: INK, align: "right" });
    c.text(dr, y, money(line.amount), { size: 9.5, color: INK, align: "right" });
    if (line.detail) {
      y += 13;
      c.text(dx, y, line.detail, { size: 8, color: MUTED });
    }
    y += 12;
    c.line(dx, y, dr, y, HAIR, 1);
    y += 18;
  }
  const sx = dx + half;
  const sum = (label: string, value: string, key: EvidenceKey, bold = false, tags: string[] = []) => {
    c.text(sx, y, label, { size: 9.5, font: bold ? "sansBold" : "sans", color: bold ? INK : MUTED });
    c.field(key, dr, y, value, { size: 9.5, font: bold ? "sansBold" : "sans", color: INK, align: "right", tags });
    if (key === "total") c.citeWithLabel("total", label, value);
    y += 18;
  };
  if (spec.subtotal != null) sum("Subtotal", money(spec.subtotal), "subtotal");
  if (spec.tax) sum(spec.tax.label, money(spec.tax.amount), "tax");
  c.line(sx, y - 11, dr, y - 11, HAIR, 1);
  sum("Total", money(spec.total), "total", true, ["total"]);
  c.text(sx, y, "Currency", { size: 9.5, color: MUTED });
  c.field("currency", dr, y, spec.currency, { size: 9.5, color: INK, align: "right" });

  // Actividad
  const actY = H - 128;
  c.line(dx, actY - 22, dr, actY - 22, HAIR, 1);
  c.text(dx, actY, "Activity", { size: 10, font: "sansBold", color: INK });
  const issued = formatDate(spec.issueDate, L, "medium");
  const events: Array<[string, string]> = [
    ["Invoice finalized", issued],
    [`Invoice sent to ${spec.customer.email ?? spec.customer.name}`, issued],
    ["Payment reminder scheduled", spec.dueDate ? formatDate(spec.dueDate, L, "medium") : "—"],
  ];
  events.forEach(([label, when], i) => {
    const ey = actY + 22 + i * 22;
    c.circle(dx + 4, ey - 3.5, 3.5, { fill: i === 0 ? color : "#CBD5E1" });
    if (i < events.length - 1) c.line(dx + 4, ey + 2, dx + 4, ey + 15, HAIR, 1);
    c.text(dx + 16, ey, label, { size: 9, color: INK });
    c.text(dr, ey, when, { size: 8.5, color: MUTED, align: "right" });
  });

  // ── Datos para transferencia
  const px = X + detW + gap;
  const pw = R - px;
  c.rect(px, detY, pw, 236, { fill: "#FFFFFF", stroke: HAIR, lineWidth: 1, radius: 10 });
  let py = detY + 26;
  c.text(px + 18, py, td(spec, "paymentTitle", "Pay by bank transfer"), { size: 11, font: "sansBold", color: INK });
  py += 16;
  c.text(px + 18, py, td(spec, "paymentSubtitle", "ACH or domestic wire"), { size: 8.5, color: MUTED });
  py += 22;
  if (spec.payment) {
    const p = spec.payment;
    const rows: Array<[string, string, EvidenceKey | null]> = [
      ["Beneficiary", p.beneficiaryName, "beneficiaryName"],
      ["Bank", p.bankName, "bankName"],
      [p.accountLabel, p.accountNumber, "accountNumber"],
    ];
    if (p.routingOrSwift) rows.push([p.routingLabel ?? "Routing", p.routingOrSwift, "routingOrSwift"]);
    rows.push(["Reference", spec.invoiceNumber, null]);
    for (const [label, value, key] of rows) {
      c.text(px + 18, py, label, { size: 8, color: MUTED });
      py += 13;
      if (key) c.field(key, px + 18, py, value, { size: 10, font: "sansBold", color: INK });
      else c.text(px + 18, py, value, { size: 10, font: "sansBold", color: INK });
      py += 17;
    }
  }
  c.rect(px, detY + 250, pw, H - detY - 274, { fill: tint(color, 0.93), radius: 10 });
  const help = td(spec, "helpText", "Questions about this invoice?");
  c.text(px + 18, detY + 276, help, { size: 9.5, font: "sansBold", color: INK });
  if (spec.vendor.email) c.text(px + 18, detY + 292, spec.vendor.email, { size: 9, color });
  return c;
}
