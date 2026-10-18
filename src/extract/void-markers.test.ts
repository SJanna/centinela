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

describe("detectVoidDocumentMarkers: anulaciones con algo en medio (hallazgo SEG-2)", () => {
  it.each([
    "La factura CRD-1088 fue anulada",
    "Factura electrónica anulada ante la DIAN",
    "Invoice INV-42 has been voided",
    "Invoice #42 is void",
    "Asunto: Factura CRD-1088 anulada",
    "Asunto: Anulación de la factura CRD-1088",
    "Invoice cancellation notice",
    "Cancelamento da fatura 778",
    "Esta factura queda sin efecto",
    "Factura Nº 123 anulada",
    "La factura CRD-1088 fue anulada y reemplazada por la CRD-1089. No pagar.",
  ])("«%s» → anulada", (text) => {
    const found = detectVoidDocumentMarkers(text);
    expect(found).toHaveLength(1);
    expect(found[0].kind).toBe("void");
  });
});

describe("detectVoidDocumentMarkers: sellos en cualquier caja o acompañados (hallazgos SEG-3 y SEG-4)", () => {
  it.each([
    ["Anulada", "void"],
    ["Estado: Anulada", "void"],
    ["ANULADA – NO PAGAR", "void"],
    ["VOID – DO NOT PAY", "void"],
    ["ESTADO: ANULADA", "void"],
    ["Status: VOID", "void"],
    ["ANULADA POR ERROR", "void"],
    ["ANULADA Reemplazada por CRD-1089", "void"],
    ["VOID INVOICE", "void"],
    ["Invoice (VOID)", "void"],
    ["PROFORMA N.º PF-1", "draft"],
    ["Proforma N.º PF-2026-1107", "draft"],
    ["Proforma", "draft"],
    ["Borrador", "draft"],
    ["Draft", "draft"],
    ["DRAFT - NOT AN INVOICE", "draft"],
    ["TOTAL A PAGAR COP 12.000.000 ANULADA", "void"],
    ["ANULA DA", "void"],
    ["SPECIMEN", "draft"],
  ])("«%s» → %s", (text, kind) => {
    const found = detectVoidDocumentMarkers(text);
    expect(found.map((m) => m.text)).toEqual([text]);
    expect(found[0].kind).toBe(kind);
  });

  it("una línea con varias marcas une las razones y elige la clase principal", () => {
    const [m] = detectVoidDocumentMarkers("DRAFT - NOT AN INVOICE");
    expect(m.kind).toBe("draft");
    expect(m.reason).toBe("Es un borrador, una proforma o un documento de muestra, no una factura definitiva; Dice que no es una factura válida");
  });
});

describe("detectVoidDocumentMarkers: nota crédito solo cuando nombra al documento (hallazgo AUT-2)", () => {
  it.each(["NOTA CRÉDITO", "CREDIT NOTE", "CREDIT NOTE #", "NOTA DE CRÉDITO N° NC-45", "Nota crédito electrónica NC-45", "Este documento es una nota crédito.", "This is a credit note.", "Tipo de documento: Nota crédito"])(
    "«%s» → nota crédito",
    (text) => {
      expect(detectVoidDocumentMarkers(text).map((m) => m.kind)).toEqual(["credit_note"]);
    },
  );

  it.each([
    "Esta factura no tiene nota crédito asociada.",
    "Esta factura no tiene notas crédito asociadas.",
    "No aplica nota crédito.",
    "Las devoluciones se tramitan mediante nota crédito.",
    "Cualquier reclamo se atenderá con nota de crédito dentro de los 30 días.",
    "Nº de nota de crédito: N/A",
    "Credit Note: none",
    "Credit memo CM-201 applied: -$100.00",
    "Descuento por pronto pago aplicado mediante nota crédito",
    "Desarrollo del módulo de nota crédito electrónica DIAN — octubre",
    "No credit memo applies to this invoice.",
    "No credit notes are pending.",
  ])("«%s» → nada", (text) => {
    expect(detectVoidDocumentMarkers(text)).toEqual([]);
  });
});

describe("detectVoidDocumentMarkers: no marca conversación ni referencias a otros documentos (hallazgos AUT-1, AUT-3 a AUT-6)", () => {
  it.each([
    // AUT-1: lo que dice quien paga, preguntas, otra factura, citas de un correo anterior.
    "14/10/2026, 10:10 - Lucía Méndez: Dale. Si hay algún ajuste nos mandan nota crédito.",
    "14/10/2026, 10:10 - Lucía Méndez: ¿Esto no es una factura proforma, no?",
    "14/10/2026, 10:11 - Martín: No no, es la Factura E definitiva.",
    "14/10/2026, 10:12 - Martín: la 0003-00000870 que te mandé el lunes tenía mal el CBU. Esa factura está anulada, vale esta.",
    "La nota crédito de septiembre ya la aplicamos, así que esta va completa.",
    "> Hi Ignacio, could you send us a proforma invoice for October first?",
    "> Hi Ignacio, is there a credit note pending from September?",
    "El 14 oct 2026, a las 10:02, Lucía Méndez escribió:\nLa factura 1301 fue anulada por error en el NIT, ¿nos reenvían la corregida",
    // AUT-3: condiciones y facturas que reemplazan a otra.
    "If your order is cancelled, this invoice is void.",
    "Invoice is cancelled automatically if not paid within 90 days.",
    "Cancellation policy: the invoice is cancelled only if unpaid.",
    "Esta factura reemplaza la factura anulada FE-1020.",
    "Esta factura sustituye a la factura cancelada A-1020.",
    "Comprobante cancelado y sustituido por el presente.",
    "Note: if the engagement is cancelled before delivery, this invoice is void and no payment is due.",
    "La factura será anulada si no se paga en 90 días.",
    "La factura no fue anulada.",
    // AUT-4: la proforma aprobada que la factura liquida.
    "Según prefactura PF-0045 aprobada por el cliente el 10/10/2026",
    "Ref.: Factura proforma PF-12 aprobada por Compras",
    "This invoice matches the proforma invoice PF-88 approved by your team on October 5.",
    "Proforma no aprobada",
    // AUT-5: «specimen» como palabra de un servicio.
    "Specimen collection fee",
    "Lab specimen handling — 4 units",
    "SPECIMEN COLLECTION FEE",
    // AUT-6: una cuenta de cobro que dice que no es factura (sí se paga).
    "Este documento no es una factura electrónica; es una cuenta de cobro de persona natural.",
    "CUENTA DE COBRO N.º 12\nEsta cuenta de cobro no es factura.",
    "Payment by BANK DRAFT",
  ])("«%s» → nada", (text) => {
    expect(detectVoidDocumentMarkers(text)).toEqual([]);
  });

  it("en un correo, lo citado de un mensaje anterior no cuenta, pero un sello en el adjunto sí", () => {
    const mail = ["Asunto: Factura 1302", "", "Adjunto la factura.", "", "> ¿Nos mandan la proforma invoice primero?", "", "--- Adjunto: factura.pdf ---", "ANULADA"].join("\n");
    expect(detectVoidDocumentMarkers(mail).map((m) => m.text)).toEqual(["ANULADA"]);
  });
});
