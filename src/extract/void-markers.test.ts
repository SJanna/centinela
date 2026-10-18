import { describe, expect, it } from "vitest";
import { detectVoidDocumentMarkers } from "./void-markers";

const texts = (t: string) => detectVoidDocumentMarkers(t).map((m) => m.text);

describe("detectVoidDocumentMarkers: marca", () => {
  it.each([
    ["sello ANULADA", "FACTURA ELECTRÓNICA DE VENTA\nANULADA\nTotal COP 12.000.000", "ANULADA"],
    ["sello con signos y fecha", "*** VOID 12 OCT 2026 ***\nInvoice INV-1", "*** VOID 12 OCT 2026 ***"],
    ["sello con letras separadas", "A N U L A D A\nTotal", "A N U L A D A"],
    ["sello DRAFT", "DRAFT\nInvoice #123", "DRAFT"],
    ["sello PRO FORMA", "PRO FORMA\nTotal USD 1,200.00", "PRO FORMA"],
    ["frase: factura anulada", "Esta factura fue anulada el 12/10/2026 por error en el NIT.", "Esta factura fue anulada el 12/10/2026 por error en el NIT."],
    ["frase en inglés", "This invoice has been voided.", "This invoice has been voided."],
    ["nota crédito", "NOTA CRÉDITO N.º NC-0012\nValor COP 12.000.000", "NOTA CRÉDITO N.º NC-0012"],
    ["credit note", "Credit Note CN-77", "Credit Note CN-77"],
    ["factura proforma", "Factura proforma N.º 45", "Factura proforma N.º 45"],
    ["proforma invoice", "PROFORMA INVOICE", "PROFORMA INVOICE"],
    ["no válido como factura", "Documento no válido como factura", "Documento no válido como factura"],
    ["sin validez fiscal", "Representación sin validez fiscal", "Representación sin validez fiscal"],
    ["not an invoice", "This is not an invoice. Total USD 1,200.00", "This is not an invoice. Total USD 1,200.00"],
    ["proforma: not a tax invoice", "This proforma is not a tax invoice.", "This proforma is not a tax invoice."],
    ["no es una factura", "Este documento no es una factura de venta.", "Este documento no es una factura de venta."],
    ["fatura cancelada", "Fatura cancelada pelo emitente", "Fatura cancelada pelo emitente"],
  ])("%s", (_name, text, line) => {
    expect(texts(text)).toContain(line);
  });
});

describe("detectVoidDocumentMarkers: no marca", () => {
  it.each([
    ["nota fiscal de serviço", "NOTA FISCAL DE SERVIÇO ELETRÔNICA - NFS-e\nValor R$ 9.500,00"],
    ["nota suelta", "Nota: pagar antes del 31/10/2026.\nNotas adicionales"],
    ["muestra como verbo", "La tabla muestra las horas del mes."],
    ["original / copia", "ORIGINAL\nCOPIA CLIENTE"],
    ["sello de pagado (otro detector)", "PAGADO"],
    ["factura normal", "FACTURA ELECTRÓNICA DE VENTA\nTotal a pagar: COP 12.000.000\nForma de pago: transferencia"],
    ["anulada en minúsculas sin contexto", "en caso de error será anulada y reemplazada"],
    ["sample en minúscula en una frase", "Please find a sample of the dashboard attached. Total USD 1,200.00"],
  ])("%s", (_name, text) => {
    expect(detectVoidDocumentMarkers(text)).toEqual([]);
  });
});
