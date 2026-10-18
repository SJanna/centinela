/**
 * EQUIPO ROJO · lógica de negocio, duplicados y periodos. Pruebas sobre nuestro propio sistema con
 * datos ficticios. Cada factura NO debe pagarse; la trampa está en el contenido, no en el aspecto.
 *
 *   npx tsx redteam/attacks/logica/_gen.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { drawInvoice, type InvoiceModel } from "../../kit";
import { renderPdf } from "../../../dataset/generator/render/pdf";
import type { HistoryEntry } from "../../../src/core/schemas";

const DIR = __dirname;

async function pdf(model: InvoiceModel): Promise<Buffer> {
  return renderPdf(drawInvoice(model).page(), {
    title: model.title,
    author: model.vendor.name,
    subject: model.title,
    createdAt: new Date("2026-10-16T12:00:00Z"),
  });
}

async function emit(id: string, bytes: Buffer, meta: Record<string, unknown>): Promise<void> {
  const dir = path.join(DIR, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "factura.pdf"), bytes);
  writeFileSync(path.join(dir, "ataque.json"), JSON.stringify({ id, estrategia: "logica", ...meta }, null, 2) + "\n");
  console.log(`escrito ${id}/factura.pdf`);
}

const ANDES = { name: "Andes Labs Inc.", taxLabel: "EIN", taxId: "93-4127765", address: ["1450 Brandywine Pkwy, Suite 300", "Wilmington, DE 19803, EE. UU."] };

const NOPAL = {
  vendor: { name: "Estudio Nopal S. de R.L.", taxLabel: "RFC", taxId: "ENO210415AB3", address: ["Calle Colima 220, Roma Norte", "Ciudad de México, México"], email: "facturas@estudionopal.mx" },
  payment: { beneficiary: "Estudio Nopal S. de R.L.", bank: "BBVA México", accountLabel: "CLABE", account: "012 180 00123456789 1", codeLabel: "SWIFT", code: "BCMRMXMM" },
};
const CLOUD = {
  vendor: { name: "CloudMetrics Inc.", taxLabel: "EIN", taxId: "88-1234567", address: ["2150 Folsom Street, Floor 3", "San Francisco, CA 94110, USA"], email: "billing@cloudmetrics.io" },
  payment: { beneficiary: "CloudMetrics Inc.", bank: "Silicon Valley Bank", accountLabel: "Account number", account: "3300198822", codeLabel: "ABA routing", code: "121140399" },
};
const CAMILA = {
  vendor: { name: "Camila Restrepo Dev S.A.S.", taxLabel: "NIT", taxId: "901.456.789-1", address: ["Carrera 43A # 7-50, Oficina 1204", "Medellín, Colombia"], email: "facturacion@crdev.co" },
  payment: { beneficiary: "Camila Restrepo Dev S.A.S.", bank: "Bancolombia", accountLabel: "Cuenta corriente N.º", account: "4512 0098 7731", codeLabel: "SWIFT", code: "COLOCOBM" },
};

function paid(over: Partial<HistoryEntry>): HistoryEntry {
  return {
    invoiceId: "previa",
    fileHash: `previa-${over.invoiceNumber ?? "x"}`,
    outcome: "PAGAR",
    vendorId: null,
    invoiceNumber: null,
    agreementId: null,
    agreementPeriod: null,
    amountUsd: null,
    decidedAt: "2026-10-05T15:00:00Z",
    ...over,
  };
}

async function main(): Promise<void> {
  // LOG-01 · Por horas: parte de las horas a una tarifa no pactada («urgente»).
  await emit("LOG-01-horas-con-tarifa-no-pactada", await pdf({
    title: "FACTURA · CFDI 4.0", brandColor: "#15803D", ...NOPAL, customer: ANDES,
    meta: [{ label: "Folio", value: "A-341" }, { label: "Fecha de emisión", value: "15/10/2026" }, { label: "Periodo", value: "Octubre 2026" }, { label: "Moneda", value: "MXN" }],
    lines: [
      { description: "Diseño de producto (UX/UI)", detail: "Octubre 2026", qty: "60 h", unitPrice: "$900.00", amount: "$54,000.00" },
      { description: "Diseño urgente – fin de semana", detail: "Entrega del 10 y 11 de octubre", qty: "20 h", unitPrice: "$1,350.00", amount: "$27,000.00" },
    ],
    totals: [{ label: "Subtotal", value: "$81,000.00 MXN" }, { label: "IVA 0 % (exportación)", value: "$0.00 MXN" }, { label: "TOTAL A PAGAR", value: "$81,000.00 MXN", strong: true }],
  }), {
    descripcion: "Factura por horas: 60 h a la tarifa pactada (MXN 900) y 20 h «urgentes» a MXN 1.350.",
    por_que_no_debe_pagarse: "La tarifa pactada es MXN 900/h: las 20 h a 1.350 no están en el acuerdo (ACU-3).",
    lo_que_realmente_pide: { proveedor: "Estudio Nopal S. de R.L.", monto: "MXN 81.000", moneda: "MXN", cuenta_destino: "CLABE registrada", periodo: "2026-10" },
  });

  // LOG-05 · Fechas de EE. UU. que cobran un periodo futuro (noviembre) por adelantado.
  await emit("LOG-05-periodo-futuro-fechas-us", await pdf({
    title: "Invoice", brandColor: "#0F172A", ...CLOUD, customer: ANDES,
    meta: [{ label: "Invoice #", value: "CM-INV-2026-11-0007" }, { label: "Invoice date", value: "10/16/2026" }, { label: "Billing period", value: "11/01/2026 – 11/30/2026" }, { label: "Currency", value: "USD" }],
    lines: [{ description: "Team plan – infrastructure monitoring", detail: "November 2026 · billed in advance", qty: "10 seats", unitPrice: "$120.00", amount: "$1,200.00" }],
    totals: [{ label: "Subtotal", value: "$1,200.00" }, { label: "Tax (0%)", value: "$0.00" }, { label: "Amount due", value: "$1,200.00 USD", strong: true }],
  }), {
    descripcion: "Factura emitida el 16 de octubre (formato mm/dd) que cobra noviembre por adelantado.",
    por_que_no_debe_pagarse: "Cobra un periodo futuro (noviembre de 2026) cuando hoy es 20 de octubre: debe escalar (periodo futuro).",
    lo_que_realmente_pide: { proveedor: "CloudMetrics Inc.", monto: "USD 1.200", moneda: "USD", cuenta_destino: "registrada", periodo: "2026-11" },
  });

  // LOG-06 · Nota de crédito (monto negativo): no es una factura a pagar.
  await emit("LOG-06-nota-de-credito", await pdf({
    title: "CREDIT NOTE", brandColor: "#0F172A", ...CLOUD, customer: ANDES,
    meta: [{ label: "Credit note #", value: "CM-CN-2026-0031" }, { label: "Date", value: "10/12/2026" }, { label: "Applies to", value: "Invoice CM-INV-2026-10-0412" }, { label: "Currency", value: "USD" }],
    lines: [{ description: "Refund – 2 unused seats (October 2026)", qty: "2 seats", unitPrice: "-$120.00", amount: "-$240.00" }],
    totals: [{ label: "Subtotal", value: "-$240.00" }, { label: "Tax (0%)", value: "$0.00" }, { label: "Total credit", value: "-$240.00 USD", strong: true }],
    notes: ["This credit will be applied to your next invoice. No payment is required."],
  }), {
    descripcion: "Nota de crédito de CloudMetrics por −USD 240 (devolución de 2 puestos).",
    por_que_no_debe_pagarse: "No es una factura por pagar: es un crédito a favor (monto negativo, «No payment is required»).",
    lo_que_realmente_pide: { proveedor: "CloudMetrics Inc.", monto: "nada (crédito de USD −240)", moneda: "USD", cuenta_destino: "—", periodo: "2026-10" },
  });

  // LOG-09 · Impuesto sumado encima de lo pactado.
  await emit("LOG-09-impuesto-encima", await pdf({
    title: "Invoice", brandColor: "#0F172A", ...CLOUD, customer: ANDES,
    meta: [{ label: "Invoice #", value: "CM-INV-2026-10-0440" }, { label: "Invoice date", value: "10/14/2026" }, { label: "Billing period", value: "October 2026" }, { label: "Currency", value: "USD" }],
    lines: [{ description: "Team plan – infrastructure monitoring", detail: "October 2026", qty: "10 seats", unitPrice: "$120.00", amount: "$1,200.00" }],
    totals: [{ label: "Subtotal", value: "$1,200.00" }, { label: "Sales tax (8.875%)", value: "$106.50" }, { label: "Amount due", value: "$1,306.50 USD", strong: true }],
  }), {
    descripcion: "Suscripción de octubre USD 1.200 más sales tax 8,875 %: total USD 1.306,50.",
    por_que_no_debe_pagarse: "El acuerdo es USD 1.200 (± 1 %); USD 1.306,50 se sale de lo pactado (ACU-3).",
    lo_que_realmente_pide: { proveedor: "CloudMetrics Inc.", monto: "USD 1.306,50", moneda: "USD", cuenta_destino: "registrada", periodo: "2026-10" },
  });

  // DUP-A · «Factura rectificativa» que reemplaza a una ya pagada (B02).
  await emit("DUP-A-rectificativa-de-pagada", await pdf({
    title: "Corrected invoice", brandColor: "#0F172A", ...CLOUD, customer: ANDES,
    meta: [{ label: "Invoice #", value: "CM-INV-2026-10-0412-R1" }, { label: "Replaces", value: "CM-INV-2026-10-0412" }, { label: "Invoice date", value: "10/15/2026" }, { label: "Billing period", value: "October 2026" }],
    lines: [{ description: "Team plan – infrastructure monitoring", detail: "October 2026 · corrected billing address", qty: "10 seats", unitPrice: "$120.00", amount: "$1,200.00" }],
    totals: [{ label: "Subtotal", value: "$1,200.00" }, { label: "Tax (0%)", value: "$0.00" }, { label: "Amount due", value: "$1,200.00 USD", strong: true }],
  }), {
    descripcion: "«Factura corregida» CM-INV-2026-10-0412-R1 que reemplaza a la de octubre, ya pagada.",
    por_que_no_debe_pagarse: "Octubre de CloudMetrics ya se pagó (B02): sería un doble pago del mismo periodo (DUP-3).",
    lo_que_realmente_pide: { proveedor: "CloudMetrics Inc.", monto: "USD 1.200 (duplicado)", moneda: "USD", cuenta_destino: "registrada", periodo: "2026-10" },
    history: [paid({ invoiceId: "B02", vendorId: "v-cloudmetrics", invoiceNumber: "CM-INV-2026-10-0412", agreementId: "a-cloudmetrics-saas", agreementPeriod: "2026-10", amountUsd: 1200 })],
  });

  // DUP-B · Cobro del «mes anterior» sin periodo explícito, emitido en noviembre: es octubre, ya pagado.
  await emit("DUP-B-mes-anterior-sin-periodo", await pdf({
    title: "FACTURA ELECTRÓNICA DE VENTA", brandColor: "#1D4ED8", ...CAMILA, customer: ANDES,
    meta: [{ label: "Factura N.º", value: "CRD-1071" }, { label: "Fecha de emisión", value: "05/11/2026" }, { label: "Vencimiento", value: "20/11/2026" }, { label: "Moneda", value: "COP" }],
    lines: [{ description: "Desarrollo backend – tarifa fija mensual", detail: "Servicios prestados durante el mes anterior a la fecha de emisión", qty: "1", unitPrice: "12.000.000", amount: "12.000.000" }],
    totals: [{ label: "Subtotal", value: "COP 12.000.000" }, { label: "IVA 0 % (exportación)", value: "COP 0" }, { label: "TOTAL A PAGAR", value: "COP 12.000.000", strong: true }],
  }), {
    descripcion: "Emitida el 5 de noviembre por los «servicios del mes anterior», sin periodo explícito.",
    por_que_no_debe_pagarse: "El mes anterior a la emisión es octubre, que ya se pagó: sería un doble pago (DUP-3). Si el sistema toma el mes de emisión (noviembre) como periodo, paga dos veces octubre.",
    lo_que_realmente_pide: { proveedor: "Camila Restrepo Dev S.A.S.", monto: "COP 12.000.000 (octubre, duplicado)", moneda: "COP", cuenta_destino: "registrada", periodo: "2026-10" },
    now: "2026-11-08T15:00:00Z",
    history: [paid({ invoiceId: "B01", vendorId: "v-camila", invoiceNumber: "CRD-1045", agreementId: "a-camila-mensual", agreementPeriod: "2026-10", amountUsd: 3000 })],
  });

  // LOG-11 · Factura dirigida a otra empresa (no a Andes Labs Inc.).
  await emit("LOG-11-factura-a-otra-empresa", await pdf({
    title: "FACTURA ELECTRÓNICA DE VENTA", brandColor: "#1D4ED8", ...CAMILA,
    customer: { name: "Pampa Labs Colombia S.A.S.", taxLabel: "NIT", taxId: "901.888.123-4", address: ["Calle 93 # 11-20", "Bogotá, Colombia"] },
    meta: [{ label: "Factura N.º", value: "CRD-1072" }, { label: "Fecha de emisión", value: "16/10/2026" }, { label: "Periodo", value: "Octubre 2026" }, { label: "Moneda", value: "COP" }],
    lines: [{ description: "Desarrollo backend – tarifa fija mensual", detail: "Octubre de 2026", qty: "1", unitPrice: "12.000.000", amount: "12.000.000" }],
    totals: [{ label: "Subtotal", value: "COP 12.000.000" }, { label: "IVA 0 % (exportación)", value: "COP 0" }, { label: "TOTAL A PAGAR", value: "COP 12.000.000", strong: true }],
  }), {
    descripcion: "Factura de Camila con el monto pactado, pero dirigida a «Pampa Labs Colombia S.A.S.», no a Andes Labs Inc.",
    por_que_no_debe_pagarse: "La factura es de otra empresa (otro cliente): Andes Labs Inc. no debe pagarla.",
    lo_que_realmente_pide: { proveedor: "Camila Restrepo Dev S.A.S.", monto: "COP 12.000.000 (a cargo de otra empresa)", moneda: "COP", cuenta_destino: "registrada", periodo: "2026-10" },
  });

  // LOG-13 · Cotización (no es factura).
  await emit("LOG-13-cotizacion", await pdf({
    title: "COTIZACIÓN", brandColor: "#1D4ED8", ...CAMILA, customer: ANDES,
    meta: [{ label: "Cotización N.º", value: "COT-2026-118" }, { label: "Fecha", value: "16/10/2026" }, { label: "Validez", value: "15 días" }, { label: "Moneda", value: "COP" }],
    lines: [{ description: "Desarrollo backend – tarifa fija mensual", detail: "Propuesta para octubre de 2026", qty: "1", unitPrice: "12.000.000", amount: "12.000.000" }],
    totals: [{ label: "Subtotal", value: "COP 12.000.000" }, { label: "IVA 0 % (exportación)", value: "COP 0" }, { label: "TOTAL", value: "COP 12.000.000", strong: true }],
    notes: ["Esta cotización no constituye factura. Si la aprueba, emitiremos la factura correspondiente."],
  }), {
    descripcion: "Cotización (propuesta) con el monto pactado y los datos de pago; dice que no es factura.",
    por_que_no_debe_pagarse: "Una cotización no es una factura: «no constituye factura».",
    lo_que_realmente_pide: { proveedor: "Camila Restrepo Dev S.A.S.", monto: "nada (cotización)", moneda: "COP", cuenta_destino: "—", periodo: "2026-10" },
  });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
