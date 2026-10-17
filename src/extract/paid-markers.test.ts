import { describe, expect, it } from "vitest";
import { detectPaidDocumentMarkers } from "./paid-markers";
import { SAMPLE_INVOICE_TEXT } from "./test-utils";

const RECEIPT = /recibo o comprobante/;
const PAID = /ya se hizo o ya se recibió/;
const STAMP = /Sello/;

const POSITIVES: Array<[string, string, RegExp]> = [
  // [idioma, línea, razón esperada]
  ["en", "Payment receipt", RECEIPT],
  ["en", "Payment receipt # CM-INV-2026-1004", RECEIPT],
  ["en", "Receipt of payment for invoice 1401", RECEIPT],
  ["en", "Payment received on 2026-08-10 by wire transfer. Thank you.", PAID],
  ["en", "Your payment has been received.", PAID],
  ["en", "We received your payment of USD 1,200.00.", PAID],
  ["en", "Paid on 2026-08-12", PAID],
  ["en", "Invoice paid in full.", PAID],
  ["en", "This invoice has already been paid.", PAID],
  ["en", "Thank you for your payment!", PAID],
  ["en", "Amount paid: $1,200.00", PAID],
  ["es", "RECIBO DE PAGO", RECEIPT],
  ["es", "Recibo de caja N° 0045", RECEIPT],
  ["es", "Comprobante de pago N° 778", RECEIPT],
  ["es", "Constancia de pago de octubre", RECEIPT],
  ["es", "Les enviamos el recibo de pago de octubre de 2026.", RECEIPT],
  ["es", "Adjuntamos el comprobante de pago de la factura FV-12.", RECEIPT],
  ["es", "Pago recibido el 2026-07-12 mediante transferencia.", PAID],
  ["es", "Hemos recibido su pago, gracias.", PAID],
  ["es", "Factura pagada el 10/08/2026.", PAID],
  ["es", "Esta factura ya fue pagada.", PAID],
  ["es", "La cuenta de cobro ya está pagada.", PAID],
  ["es", "Servicio ya pagado.", PAID],
  ["es", "El valor ya se pagó por transferencia.", PAID],
  ["es", "Total pagado: COP 12.000.000", PAID],
  ["es", "Pagado en su totalidad.", PAID],
  ["es", "Gracias por su pago.", PAID],
  ["pt", "COMPROVANTE DE PAGAMENTO", RECEIPT],
  ["pt", "Recibo de pagamento nº 20264324", RECEIPT],
  ["pt", "Pagamento recebido em 2026-07-19 por transferência. Obrigado.", PAID],
  ["pt", "Recebemos o seu pagamento.", PAID],
  ["pt", "Esta fatura já foi paga.", PAID],
  ["pt", "Valor pago: R$ 9.500,00", PAID],
  ["pt", "Obrigado pelo pagamento.", PAID],
];

describe("detectPaidDocumentMarkers · positivos", () => {
  it.each(POSITIVES)("[%s] %s", (_lang, line, reason) => {
    const found = detectPaidDocumentMarkers(`Factura N.º 1\nTotal: USD 100\n${line}\nSaludos`);
    expect(found.map((f) => f.text)).toContain(line);
    expect(found.some((f) => reason.test(f.reason))).toBe(true);
  });

  it.each([
    ["PAID"],
    ["PAGADO"],
    ["PAGADA"],
    ["PAGO"],
    ["*** PAGADO ***"],
    ["PAID ✓"],
    ["PAGADO 12/08/2026"],
    ["P A G A D O"],
  ])("sello aislado en su propia línea: «%s»", (stamp) => {
    const found = detectPaidDocumentMarkers(`FACTURA FV-12\n${stamp}\nTotal COP 1.000`);
    expect(found).toEqual([{ text: stamp, reason: expect.stringMatching(STAMP) }]);
  });

  it("títulos con letras separadas o que la entrada de PDF ya unió", () => {
    for (const title of ["R E C I B O  D E  P A G O", "RECIBODEPAGO", "PAYMENTRECEIPT", "PAGAMENTORECEBIDO"]) {
      const found = detectPaidDocumentMarkers(`Camila Restrepo Dev S.A.S.\n${title}\nN° CRD-3485`);
      // La cita es la línea original con los espacios colapsados.
      expect(found.map((f) => f.text), title).toEqual([title.replace(/\s+/g, " ")]);
    }
  });

  it("devuelve la línea original, una sola vez aunque active varias marcas, en el orden del documento", () => {
    const text = "Payment receipt\nInvoice 1401\nTotal USD 5.205,00\nPayment received on 2026-08-12. Thank you for your payment.";
    expect(detectPaidDocumentMarkers(text)).toEqual([
      { text: "Payment receipt", reason: "Se presenta como recibo o comprobante de un pago ya hecho" },
      { text: "Payment received on 2026-08-12. Thank you for your payment.", reason: "Dice que el pago ya se hizo o ya se recibió" },
    ]);
  });

  it("con tildes, mayúsculas raras, ancho completo o invisibles", () => {
    for (const line of ["PAGO RECIBIDO EL 2026-07-12", "Ｐａｙｍｅｎｔ ｒｅｃｅｉｐｔ", "Recibo de pa​go", "Comprovante de Pagamento"]) {
      expect(detectPaidDocumentMarkers(`Factura\n${line}\nTotal 10`).map((f) => f.text), line).toEqual([line]);
    }
  });
});

const NEGATIVES: Array<[string, string]> = [
  ["factura colombiana", SAMPLE_INVOICE_TEXT],
  ["etiquetas de una factura en español", "Forma de pago: transferencia\nDatos para el pago\nCondiciones de pago: 30 días\nFecha de pago: 2026-11-15\nPagar a: Camila Restrepo\nSaldo por pagar: COP 1.200.000\nTOTAL A PAGAR COP 1.200.000"],
  ["etiquetas de una invoice", "Payment terms: Net 30\nPayment details\nAmount due: $1,200.00\nBalance due $1,200.00\nPay to: CloudMetrics Inc.\nPayable to CloudMetrics Inc.\nPayment due within 30 days."],
  ["etiquetas de una nota fiscal", "Dados para pagamento (transferência internacional):\nForma de pagamento: PIX\nVencimento: 15/11/2026\nValor a pagar: R$ 9.500,00"],
  ["títulos de una factura en mayúsculas", "FORMA DE PAGO\nCrédito 15 días\nDATOS PARA EL PAGO\nTOTALAPAGAR COP 8.880.000\nDATOSPARAELPAGO"],
  ["condiciones con «if» / «si»", "If paid in full by October 15, a 2% discount applies.\nSi ya realizó el pago, ignore este aviso: pago recibido después del corte no aplica.\nIf payment has been received, please disregard this notice."],
  ["pagos recibidos tarde (plural o con «after»)", "Payments received after the due date are subject to a 1.5% late fee.\nPayment received after the due date will incur interest."],
  ["pedidos de enviar el comprobante", "Favor enviar el comprobante de pago a pagos@proveedor.co\nEnvíe el recibo de pago escaneado.\nPlease send the payment receipt to ap@vendor.com\nPor favor, envie o comprovante de pagamento para financeiro@testa.com.br"],
  ["futuro u obligación", "The balance must be paid in full by the due date.\nAmount to be paid on or before November 15.\nEl saldo será pagado el 30 de noviembre.\nDebe ser pagada el día 15."],
  ["montos pagados en cero", "Amount paid: $0.00\nTotal pagado: COP 0\nValor pago: R$ 0,00\nAmount due: $1,200.00"],
  ["cortesías antes del pago", "Thank you for your payment in advance.\nGracias por su pago oportuno.\nGracias por su pago puntual.\nThank you for your business!"],
  ["«pago» dentro de una línea, no como sello", "Pago\nPago inmediato con descuento del 2 %.\nPAGO POR TRANSFERENCIA\nUnpaid\nNOT PAID"],
  ["palabras que contienen las marcas", "Prepaid plan (12 months)\nUnpaid balance: USD 0\nRecibo-de-entrega 778"],
];

describe("detectPaidDocumentMarkers · negativos (facturas normales)", () => {
  it.each(NEGATIVES)("%s", (_name, text) => {
    expect(detectPaidDocumentMarkers(text)).toEqual([]);
  });

  it("texto vacío", () => {
    expect(detectPaidDocumentMarkers("")).toEqual([]);
  });
});

// ───────────────────────── Revisión adversarial (17 oct) ─────────────────────────
// Variantes de documento ya pagado que el detector dejaba pasar (se pagaban si las dos lecturas
// decían «invoice»), y frases normales de una factura que las reglas nuevas no deben marcar.

const ADVERSARIAL_POSITIVES: Array<[string, string]> = [
  // español
  ["es", "Pago aplicado el 2026-08-10"],
  ["es", "PAGO APLICADO"],
  ["es", "Su pago fue aplicado a la factura FV-12."],
  ["es", "Pago acreditado"],
  ["es", "Pago confirmado"],
  ["es", "Confirmación de pago"],
  ["es", "Pago realizado el 10/08/2026 por transferencia."],
  ["es", "Pago efectuado el 10/08/2026"],
  ["es", "Pago exitoso"],
  ["es", "Transacción aprobada"],
  ["es", "Estado: Pagado"],
  ["es", "Estado de la factura: PAGADA"],
  ["es", "Factura liquidada"],
  ["es", "Factura saldada"],
  ["es", "La factura fue pagada."],
  ["es", "Esta factura está pagada."],
  ["es", "Saldo pendiente: COP 0"],
  ["es", "Saldo a pagar: $0,00"],
  ["es", "Gracias por tu pago."],
  ["es", "Recibimos su transferencia del 10/08."],
  ["es", "Acusamos recibo de su pago."],
  ["es", "Recibí de Andes Labs Inc. la suma de COP 12.000.000 por servicios de octubre."],
  ["es", "Recibo oficial de pago N° 45"],
  ["es", "Recibo N° 0045"],
  ["es", "Sí, la factura ya fue pagada el 10/08."],
  ["es", "Una vez más, gracias por su pago."],
  ["es", "Caso 4521: pago recibido el 10/08."],
  ["es", "Se pagó el 10/08 por transferencia."],
  ["es", "Pagado con tarjeta de crédito"],
  ["es", "Comprobante de transferencia"],
  // inglés
  ["en", "Payment confirmation"],
  ["en", "PAYMENT CONFIRMATION"],
  ["en", "Payment confirmed"],
  ["en", "Payment successful"],
  ["en", "Payment completed on 2026-08-10"],
  ["en", "Payment applied to invoice 1401"],
  ["en", "Your payment was successful."],
  ["en", "Payment acknowledgement"],
  ["en", "Settled on 2026-08-10"],
  ["en", "Invoice settled"],
  ["en", "Status: Paid"],
  ["en", "Invoice status: PAID"],
  ["en", "Fully paid"],
  ["en", "This invoice is paid."],
  ["en", "This invoice was paid."],
  ["en", "Paid via wire transfer"],
  ["en", "Paid by credit card ending 4242"],
  ["en", "Paid with Visa"],
  ["en", "Date paid: Aug 10, 2026"],
  ["en", "Balance due: $0.00"],
  ["en", "Amount due USD 0.00"],
  ["en", "Thanks for your payment!"],
  ["en", "Thanks for paying!"],
  ["en", "Once again, thank you for your payment."],
  ["en", "Receipt"],
  ["en", "RECEIPT #1234-5678"],
  ["en", "Receipt from CloudMetrics Inc."],
  ["en", "Receipt for invoice 1401"],
  ["en", "Payment of USD 1,200.00 received"],
  ["en", "Received with thanks"],
  ["en", "Received from Andes Labs Inc. the sum of USD 1,200.00"],
  ["en", "We send you the payment receipt for October."],
  ["en", "Per your request, payment receipt attached."],
  ["en", "Payment receipt May 2026"],
  ["en", "After reviewing our records, we confirm that payment was received on 10/08."],
  ["es", "Después de revisar, confirmamos que su pago fue aplicado el 10/08."],
  ["en", "Your payment receipt is available in your account."],
  // portugués
  ["pt", "Fatura quitada"],
  ["pt", "Recibo de quitação"],
  ["pt", "Termo de quitação"],
  ["pt", "Dou plena quitação do valor de R$ 9.500,00."],
  ["pt", "Fatura paga"],
  ["pt", "A fatura foi paga."],
  ["pt", "Pagamento confirmado"],
  ["pt", "Pagamento efetuado em 10/08/2026"],
  ["pt", "Pagamento realizado em 10/08/2026"],
  ["pt", "Pagamento aprovado"],
  ["pt", "Confirmação de pagamento"],
  ["pt", "Já pago"],
  ["pt", "Status: Pago"],
  ["pt", "Situação: Paga"],
  ["pt", "Recebemos a sua transferência."],
  ["pt", "Valor recebido: R$ 9.500,00"],
  ["pt", "Recebi de Andes Labs Inc. a importância de R$ 9.500,00"],
  // recibos de tarjeta y saldo en cero
  ["en", "Charged to your card ending 4242"],
  ["en", "Your card was charged USD 1,200.00."],
  ["en", "Amount remaining: $0.00"],
  ["en", "Balance: $0.00"],
  ["es", "Saldo: $0,00"],
  ["pt", "Valor em aberto: R$ 0,00"],
];

describe("detectPaidDocumentMarkers · revisión adversarial: variantes que antes pasaban", () => {
  it.each(ADVERSARIAL_POSITIVES)("[%s] %s", (_lang, line) => {
    const found = detectPaidDocumentMarkers(`Factura N.º 1\nTotal: USD 100\n${line}\nCuenta 123`);
    expect(found.map((f) => f.text)).toContain(line);
  });

  it.each([
    ["LIQUIDADO"],
    ["CANCELADO"],
    ["CANCELADA"],
    ["SALDADO"],
    ["QUITADO"],
    ["PAGA"],
    ["SETTLED"],
    ["Pagado"],
    ["Pagada"],
    ["Quitado"],
    ["Paid ✓"],
    ["Pagado ✔"],
    ["PAID 10 AUG 2026"],
    ["PAGADO 10 AGO 2026"],
    ["PAGADO EL 10 DE AGOSTO"],
    ["PAID WITH THANKS"],
  ])("sello en su propia línea: «%s»", (stamp) => {
    const found = detectPaidDocumentMarkers(`FACTURA FV-12\n${stamp}\nTotal COP 1.000`);
    expect(found.map((f) => f.text)).toEqual([stamp]);
  });

  it("recibo en el cuerpo de un correo con vencimiento y datos bancarios, sin la palabra «receipt» en el título", () => {
    const mail = [
      "De: Priya Raman <priya.raman@cloudmetrics.io>",
      "Asunto: Invoice CM-INV-2026-1004 – August 2026",
      "",
      "Hi Andes Labs team,",
      "",
      "Invoice # CM-INV-2026-1004",
      "Due date: 10/08/2026",
      "Total: $1,200.00 USD",
      "Status: Paid",
      "",
      "Bank details:",
      "Account number: 3300198822",
      "ABA routing number: 121140399",
      "",
      "Thanks for your payment!",
    ].join("\n");
    expect(detectPaidDocumentMarkers(mail).map((f) => f.text)).toEqual(["Status: Paid", "Thanks for your payment!"]);
  });
});

const ADVERSARIAL_NEGATIVES: Array<[string, string]> = [
  ["formas y medios de pago", "Forma de pago: Pago por transferencia\nPago a 30 días\nMedio de pago: PSE\nPagamento via PIX ou boleto\nPayment method: wire transfer"],
  [
    "pagos futuros, generales o con condición",
    [
      "El pago realizado después del vencimiento genera intereses de mora.",
      "Todo pago realizado fuera de plazo genera intereses.",
      "Una vez realizado el pago, envíe el comprobante.",
      "Si el pago fue aplicado, ignore este mensaje.",
      "La factura debe ser pagada antes del 30/11.",
      "La factura deberá estar pagada antes del 30/11.",
      "Una vez que la factura esté pagada, se activa el servicio.",
      "Pagamento efetuado após o vencimento sofrerá multa de 2%.",
      "O pagamento deverá ser efetuado até 15/11.",
      "Após a confirmação de pagamento, enviaremos a nota.",
    ].join("\n"),
  ],
  [
    "invoices en inglés",
    [
      "Payment confirmation will be sent by email.",
      "For payment confirmation, email ap@vendor.com.",
      "Please email the payment confirmation to ap@vendor.com",
      "Payments are processed within 3 business days.",
      "Payment processed within 3 business days of receipt.",
      "Invoices can be paid via wire transfer or ACH.",
      "Amount to be paid by credit card: USD 1,200.00",
      "This invoice must be paid with Visa or Mastercard.",
      "When the invoice is paid, the license is renewed.",
      "The license is renewed once the invoice is paid.",
      "Service is suspended until the balance is paid.",
      "Invoice paid after the due date will incur a late fee.",
      "Bank fees paid by sender.",
      "Payment terms: due upon receipt",
      "Thank you for paying on time.",
      "Thanks for paying by bank transfer.",
    ].join("\n"),
  ],
  [
    "saldos que no son cero o que no son el saldo de esta factura",
    "Previous balance due: $0.00\nAmount due: $1,200.00\nSaldo anterior: $0,00\nTotal a pagar: COP 1.200.000 (IVA 0 %)\nTOTAL A PAGAR\nIVA 0%\nCOP 1.200.000\nBalance due 05/11/2026",
  ],
  [
    "estados que no son pagado",
    "Status: Pending payment\nEstado: Pago pendiente\nStatus: Unpaid\nEstado: Pendiente\nSituação: Em aberto\nPayment status: Due\nEstado: Pago parcial",
  ],
  ["liquidación de impuestos (Colombia)", "El IVA fue liquidado a la tarifa general.\nIVA liquidado: COP 0\nValor liquidado: COP 1.200.000\nPedido cancelado por el cliente: no aplica"],
  [
    "recibos que todavía no existen o se piden",
    [
      "A payment receipt will be sent once payment is received.",
      "Payment receipt available on request.",
      "Le enviaremos el recibo de pago cuando se acredite la transferencia.",
      "We will send you a payment receipt.",
      "We’ll email the payment receipt.",
      "El recibo de pago estará disponible en el portal.",
      "Recibo de pago disponible a solicitud.",
    ].join("\n"),
  ],
  [
    "cargos futuros y saldos que no son de esta factura",
    "This amount will be charged to your card on Nov 1.\nYour card will be charged on Nov 1.\nCredit balance: $0.00\nSaldo a favor: $0\nSaldo anterior: 0\nInvoices paid in 30 days receive no discount.\nAvailable balance: $0.00",
  ],
  ["«pago» como fecha o condición", "PAGO 15 DE NOVIEMBRE\nEstado: Pago a 30 días\nPAGO EN DÓLARES\nPAGO: 15/11/2026"],
  [
    "recibos que no son de pago",
    "Recibo de luz\nGoods receipt: see PO 4500012345\nComprobante autorizado AFIP\nEnvíe el comprobante de transferencia a pagos@proveedor.co\nAdjunte el comprobante de consignación.\nConfirmación de pago: pagos@proveedor.co",
  ],
];

describe("detectPaidDocumentMarkers · revisión adversarial: frases normales que no se marcan", () => {
  it.each(ADVERSARIAL_NEGATIVES)("%s", (_name, text) => {
    expect(detectPaidDocumentMarkers(text)).toEqual([]);
  });
});
