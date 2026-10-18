/**
 * Plantilla «nota_servico»: Nota Fiscal de Serviços Eletrônica (NFS-e) brasileña, en portugués.
 * Formulario con recuadros: prestador, tomador, discriminación de servicios, valor total,
 * cuadrícula de retenciones y "outras informações" con los datos bancarios.
 */
import { Canvas, wrapText } from "../layout";
import { formatDate, formatNumber, formatPeriod, formatQuantity } from "../format";
import type { DocumentSpec, EvidenceKey } from "../spec";
import { drawHiddenText, drawVisibleNote, fitSize, moneyOf, td } from "./common";
import { drawLogo } from "./logos";

const INK = "#111827";
const MUTED = "#4B5563";
const LINE = "#374151";
const BAR = "#E5E7EB";

export function renderNotaServico(spec: DocumentSpec): Canvas {
  const c = new Canvas();
  const W = c.width;
  const H = c.height;
  const X0 = 28;
  const X1 = W - 28;
  const L = spec.locale;
  const money = moneyOf(spec);
  const num = (n: number) => formatNumber(n, L, 2);

  c.rect(X0, 28, X1 - X0, H - 56, { fill: null, stroke: LINE, lineWidth: 0.9 });

  // ── Cabecera
  const headH = 92;
  const rightW = 168;
  c.line(X0, 28 + headH, X1, 28 + headH, LINE, 0.9);
  c.line(X1 - rightW, 28, X1 - rightW, 28 + headH, LINE, 0.9);
  if (spec.brand) drawLogo(c, spec.brand, X0 + 12, 44, 42, { bg: spec.brand.color, fg: "#FFFFFF" });
  if (spec.brand) c.text(X0 + 33, 98, spec.brand.wordmark, { size: 6.5, font: "sansBold", color: MUTED, align: "center" });
  const cx = X0 + 64 + (X1 - rightW - X0 - 64) / 2;
  c.text(cx, 58, td(spec, "issuerHeader", "NOTA FISCAL DE SERVIÇOS"), { size: 9, font: "sansBold", color: MUTED, align: "center", letterSpacing: 0.6 });
  c.text(cx, 76, spec.title, { size: fitSize(spec.title, "sansBold", 12.5, X1 - rightW - X0 - 90), font: "sansBold", color: INK, align: "center" });
  const rps = td(spec, "rps");
  if (rps) c.text(cx, 92, rps, { size: 8, color: MUTED, align: "center" });
  const cells: Array<[string, string, EvidenceKey | null, number]> = [
    ["Número da Nota", spec.invoiceNumber, "invoiceNumber", 12],
    ["Data e Hora de Emissão", `${formatDate(spec.issueDate, L, "short")}${spec.issueTime ? ` ${spec.issueTime}` : ""}`, "issueDate", 9.5],
    ["Código de Verificação", td(spec, "verificationCode", "—"), null, 9.5],
  ];
  cells.forEach(([label, value, key, size], i) => {
    const top = 28 + i * (headH / 3);
    if (i > 0) c.line(X1 - rightW, top, X1, top, LINE, 0.6);
    c.text(X1 - rightW + 8, top + 10, label, { size: 6.8, color: MUTED });
    if (key) c.field(key, X1 - 8, top + 25, value, { size, font: "sansBold", color: INK, align: "right" });
    else c.text(X1 - 8, top + 25, value, { size, font: "sansBold", color: INK, align: "right" });
  });

  let y = 28 + headH;
  const section = (title: string) => {
    c.rect(X0, y, X1 - X0, 14, { fill: BAR });
    c.line(X0, y + 14, X1, y + 14, LINE, 0.6);
    c.text(W / 2, y + 10, title, { size: 7.8, font: "sansBold", color: INK, align: "center", letterSpacing: 0.8 });
    y += 14;
  };
  const kv = (x: number, yy: number, label: string, value: string, key: EvidenceKey | null = null, maxW = 400) => {
    const lw = c.text(x, yy, label, { size: 8, color: MUTED });
    const vs = fitSize(value, "sansBold", 8.5, maxW - lw - 4);
    if (key) c.field(key, x + lw + 4, yy, value, { size: vs, font: "sansBold", color: INK });
    else c.text(x + lw + 4, yy, value, { size: vs, font: "sansBold", color: INK });
  };

  // ── Prestador
  section("PRESTADOR DE SERVIÇOS");
  const v = spec.vendor;
  kv(X0 + 10, y + 16, `${v.taxIdLabel ?? "CPF/CNPJ"}:`, v.taxId ?? "—", v.taxId ? "vendorTaxId" : null, 260);
  kv(X0 + 290, y + 16, "Inscrição Municipal:", td(spec, "municipalRegistration", "—"), null, 230);
  kv(X0 + 10, y + 30, "Nome/Razão Social:", v.name, "vendorName", 500);
  kv(X0 + 10, y + 44, "Endereço:", v.address.slice(0, 2).join(" – "), null, 520);
  kv(X0 + 10, y + 58, "Município:", td(spec, "city", "São Paulo"), null, 200);
  kv(X0 + 200, y + 58, "UF:", td(spec, "state", "SP"), null, 80);
  if (v.email) kv(X0 + 290, y + 58, "E-mail:", v.email, null, 240);
  y += 68;

  // ── Tomador
  section("TOMADOR DE SERVIÇOS");
  const cu = spec.customer;
  kv(X0 + 10, y + 16, "Nome/Razão Social:", cu.name, "billToName", 500);
  kv(X0 + 10, y + 30, "CPF/CNPJ:", "—", null, 200);
  kv(X0 + 200, y + 30, "Identificação no exterior:", `${cu.taxIdLabel ?? ""} ${cu.taxId ?? ""}`.trim() || "—", cu.taxId ? "billToTaxId" : null, 330);
  kv(X0 + 10, y + 44, "Endereço:", cu.address.join(" – "), null, 520);
  kv(X0 + 10, y + 58, "País:", td(spec, "customerCountry", "Estados Unidos"), null, 200);
  if (cu.email) kv(X0 + 290, y + 58, "E-mail:", cu.email, null, 240);
  y += 68;

  // ── Discriminação
  section("DISCRIMINAÇÃO DOS SERVIÇOS");
  const colQty = X1 - 200;
  const colUnit = X1 - 100;
  y += 16;
  c.text(X0 + 10, y, "Descrição", { size: 7.5, font: "sansBold", color: MUTED });
  c.text(colQty, y, "Qtde.", { size: 7.5, font: "sansBold", color: MUTED, align: "right" });
  c.text(colUnit, y, "Valor unitário", { size: 7.5, font: "sansBold", color: MUTED, align: "right" });
  c.text(X1 - 10, y, "Valor total", { size: 7.5, font: "sansBold", color: MUTED, align: "right" });
  y += 6;
  c.line(X0 + 10, y, X1 - 10, y, BAR, 0.8);
  y += 14;
  for (const line of spec.lines) {
    const desc = wrapText(line.description, "sans", 9, colQty - X0 - 80);
    desc.forEach((d, i) => c.text(X0 + 10, y + i * 12, d, { size: 9, color: INK }));
    if (line.quantity != null) c.text(colQty, y, formatQuantity(line.quantity, line.unit, L), { size: 9, color: INK, align: "right" });
    if (line.unitPrice != null) c.text(colUnit, y, money(line.unitPrice), { size: 9, color: INK, align: "right" });
    c.text(X1 - 10, y, money(line.amount), { size: 9, color: INK, align: "right" });
    y += desc.length * 12 + 6;
  }
  y += 6;
  if (spec.servicePeriod) {
    kv(X0 + 10, y, "Competência:", formatPeriod(spec.servicePeriod, L, "title"), "servicePeriod", 200);
  }
  if (spec.dueDate) kv(X0 + 200, y, "Vencimento:", formatDate(spec.dueDate, L, "short"), "dueDate", 160);
  kv(X0 + 360, y, "Moeda:", td(spec, "currencyText", spec.currency), "currency", 180);
  y += 14;
  const discNote = td(spec, "serviceNote");
  if (discNote) {
    y = c.paragraph(X0 + 10, y, X1 - X0 - 20, discNote, { size: 8, color: MUTED, lineHeight: 11 });
  }
  y = Math.max(y + 6, 470);

  // ── Valor total
  c.line(X0, y, X1, y, LINE, 0.9);
  c.rect(X0, y, X1 - X0, 30, { fill: "#F3F4F6" });
  const label = "VALOR TOTAL DO SERVIÇO =";
  const totalText = money(spec.total);
  const lw = c.text(W / 2 - 50, y + 20, label, { size: 11.5, font: "sansBold", color: INK, align: "center" });
  c.field("total", W / 2 - 50 + lw / 2 + 8, y + 20, totalText, { size: 12.5, font: "sansBold", color: INK, tags: ["total"] });
  c.citeWithLabel("total", label, totalText);
  y += 30;
  c.line(X0, y, X1, y, LINE, 0.9);

  // ── Retenções
  const grid = (items: Array<[string, string, EvidenceKey | null]>) => {
    const cw = (X1 - X0) / items.length;
    items.forEach(([lab, val, key], i) => {
      const x = X0 + i * cw;
      if (i > 0) c.line(x, y, x, y + 28, LINE, 0.6);
      c.text(x + 6, y + 10, lab, { size: fitSize(lab, "sans", 6.6, cw - 10), color: MUTED });
      if (key) c.field(key, x + cw - 6, y + 23, val, { size: 9, font: "sansBold", color: INK, align: "right" });
      else c.text(x + cw - 6, y + 23, val, { size: 9, font: "sansBold", color: INK, align: "right" });
    });
    y += 28;
    c.line(X0, y, X1, y, LINE, 0.6);
  };
  const zero = num(0);
  grid([
    ["INSS (R$)", zero, null],
    ["IRRF (R$)", zero, null],
    ["CSLL (R$)", zero, null],
    ["COFINS (R$)", zero, null],
    ["PIS/PASEP (R$)", zero, null],
  ]);
  const code = td(spec, "serviceCode");
  if (code) {
    c.text(X0 + 6, y + 10, "Código do Serviço", { size: 6.6, color: MUTED });
    c.text(X0 + 6, y + 23, code, { size: fitSize(code, "sans", 8.5, X1 - X0 - 12), color: INK });
    y += 28;
    c.line(X0, y, X1, y, LINE, 0.6);
  }
  const gridItems: Array<[string, string, EvidenceKey | null]> = [];
  if (spec.subtotal != null) gridItems.push(["Valor dos Serviços (R$)", num(spec.subtotal), "subtotal"]);
  gridItems.push(["Valor Total das Deduções (R$)", zero, null]);
  gridItems.push(["Base de Cálculo (R$)", num(spec.subtotal ?? spec.total), null]);
  gridItems.push(["Alíquota (%)", td(spec, "aliquota", zero), null]);
  if (spec.tax) gridItems.push([spec.tax.label, num(spec.tax.amount), "tax"]);
  grid(gridItems);

  // ── Outras informações
  section("OUTRAS INFORMAÇÕES");
  y += 14;
  for (const note of spec.notes) {
    y = c.paragraph(X0 + 10, y, X1 - X0 - 20, note, { size: 8.2, color: INK, lineHeight: 11.5 });
    y += 2;
  }
  y += 6;
  if (spec.payment) {
    const p = spec.payment;
    c.text(X0 + 10, y, "Dados para pagamento (transferência internacional):", { size: 8.2, font: "sansBold", color: INK });
    y += 14;
    kv(X0 + 10, y, "Favorecido:", p.beneficiaryName, "beneficiaryName", 260);
    kv(X0 + 290, y, "Banco:", p.bankName, "bankName", 240);
    y += 13;
    kv(X0 + 10, y, `${p.accountLabel}`, p.accountNumber, "accountNumber", 260);
    if (p.routingOrSwift) kv(X0 + 290, y, p.routingLabel ?? "SWIFT:", p.routingOrSwift, "routingOrSwift", 240);
    y += 18;
  }
  y = drawVisibleNote(c, spec, X0 + 10, y, X1 - X0 - 20);
  c.text(W / 2, H - 38, td(spec, "footer", "Documento emitido por ME ou EPP optante pelo Simples Nacional: NÃO"), { size: 6.8, color: MUTED, align: "center" });
  drawHiddenText(c, spec, X0 + 10, H - 32);
  return c;
}
