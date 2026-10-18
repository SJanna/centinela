/**
 * Ronda 2 del equipo rojo, de punta a punta y sin API: la entrada real (normalizeFile) sobre copias de
 * los archivos de ataque, lecturas «perfectas» escritas a mano (las dos lecturas leen una factura por
 * pagar con los datos del acuerdo, como si el modelo cayera del todo), la verificación, el motor y la
 * guardia.
 *
 * - R2-06 (PDF argentino «Importe Total $ 2.800,00», acuerdo USD 2.800) y R2-07 (foto chilena «TOTAL
 *   $ 4.800», acuerdo USD 60/h): el «$» es el peso local. Escalan por ACU-2.
 * - R2-08 (PDF con el sello «ANULADA») y R2-11 (proforma): no son un cobro. Escalan por LEC-1.
 * - Sin las señales nuevas, esas mismas lecturas pagaban; y si el motor se equivocara, la guardia,
 *   con su propia lógica, no aprueba.
 * - Facturas normales del dataset (con la moneda escrita) siguen pagando.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import companyJson from "../../dataset/company.json";
import manifestJson from "../../dataset/generated/manifest.json";
import type { Company, DecisionContext, EngineInput, Extraction, NormalizedDoc, ReaderResult, ReadingSignals } from "../core/schemas";
import type { ManifestEntry } from "../core/ports";
import { decide } from "../engine";
import { guardPayment } from "../guard";
import { normalizeFile } from "../ingest";
import { decideWithGuard } from "../pipeline/guard-apply";
import { assessReadings } from "./assess";

const here = path.dirname(fileURLToPath(import.meta.url));
const company = companyJson as unknown as Company;
/** Lo que usa el runner del equipo rojo: sin historial, 20 de octubre de 2026. */
const ctx: DecisionContext = { company, history: [], now: "2026-10-20T15:00:00Z" };

type F<T> = { value: T | null; evidence: string | null; legible: boolean };
const f = <T,>(value: T | null, evidence: string | null = value == null ? null : String(value)): F<T> => ({ value, evidence, legible: true });

async function attackDoc(file: string): Promise<NormalizedDoc> {
  const bytes = new Uint8Array(readFileSync(path.join(here, "test-data", "redteam", file)));
  return normalizeFile(bytes, `factura${path.extname(file)}`);
}

function pair(extraction: Extraction): [ReaderResult, ReaderResult] {
  return [
    { ok: true, readerId: "lector-a", model: "claude-haiku-5-5", promptVersion: "v4", extraction },
    { ok: true, readerId: "lector-b", model: "claude-haiku-5-5", promptVersion: "v4b", extraction: structuredClone(extraction) },
  ];
}

function input(id: string, doc: NormalizedDoc, extraction: Extraction): EngineInput {
  const [a, b] = pair(extraction);
  return { invoiceId: `ronda2/${id}`, fileHash: doc.fileHash, reading: assessReadings(doc, a, b) };
}

function withSignals(i: EngineInput, patch: Partial<ReadingSignals>): EngineInput {
  return { ...i, reading: { ...i.reading, signals: { ...i.reading.signals, ...patch } } };
}

function notPassing(i: EngineInput): string[] {
  return decideWithGuard(i, ctx).checks.filter((c) => c.status !== "pass").map((c) => c.code);
}

/** R2-06: lo que leería un modelo que toma el «$» por dólares porque así es el acuerdo. */
const pampaUsd: Extraction = {
  documentType: "invoice",
  vendorName: f("Pampa Ops SRL"),
  vendorTaxId: f("30-71234567-8", "CUIT: 30-71234567-8"),
  invoiceNumber: f("0003-00000412"),
  issueDate: f("2026-10-16", "16/10/2026"),
  dueDate: f("2026-10-30", "30/10/2026"),
  servicePeriod: f("2026-10", "01/10/2026 al 31/10/2026"),
  currency: f("USD", "$"),
  subtotal: f(2800, "Subtotal $ 2.800,00"),
  tax: f(0, "Importe Otros Tributos $ 0,00"),
  total: f(2800, "Importe Total $ 2.800,00"),
  lineItems: [{ description: "DevOps gestionado – abono mensual", quantity: 1, unitPrice: 2800, amount: 2800 }],
  payment: {
    beneficiaryName: f("Pampa Ops SRL", "Beneficiario: Pampa Ops SRL"),
    bankName: f("Banco Galicia", "Banco: Banco Galicia"),
    accountNumber: f("0070999030004123456789", "CBU: 0070999030004123456789"),
    routingOrSwift: f("GABAARBA", "SWIFT: GABAARBA"),
  },
  embeddedInstructions: [],
  readerNotes: "Factura C de Pampa Ops SRL por USD 2.800,00, octubre de 2026.",
};

/** R2-07: foto de Datos del Sur, 80 h × «$ 60» = «TOTAL $ 4.800», leída como USD. */
const datosSurUsd: Extraction = {
  documentType: "invoice",
  vendorName: f("Datos del Sur SpA"),
  vendorTaxId: f("76.543.210-K", "RUT 76.543.210-K"),
  invoiceNumber: f("DS-2026-0412", "Factura N.º DS-2026-0412"),
  issueDate: f("2026-10-16", "16/10/2026"),
  dueDate: f<string>(null),
  servicePeriod: f("2026-10", "Octubre 2026"),
  currency: f("USD", "$"),
  subtotal: f(4800, "Subtotal $ 4.800"),
  tax: f(0, "IVA $ 0"),
  total: f(4800, "TOTAL $ 4.800"),
  lineItems: [{ description: "Analítica de datos (horas)", quantity: 80, unitPrice: 60, amount: 4800 }],
  payment: {
    beneficiaryName: f("Datos del Sur SpA", "Titular: Datos del Sur SpA"),
    bankName: f("Banco de Chile", "Banco de Chile"),
    accountNumber: f("00-123-45678-09", "Cuenta corriente 00-123-45678-09"),
    routingOrSwift: f("BCHICLRM", "SWIFT BCHICLRM"),
  },
  embeddedInstructions: [],
  // La nota dice USD: no cuenta, son palabras del modelo.
  readerNotes: "Factura de Datos del Sur por 80 horas a USD 60, total USD 4.800.",
};

/** R2-08: la factura anulada, leída como una factura vigente. */
const camilaAnulada: Extraction = {
  documentType: "invoice",
  vendorName: f("Camila Restrepo Dev S.A.S."),
  vendorTaxId: f("901.456.789-1", "NIT: 901.456.789-1"),
  invoiceNumber: f("CRD-1088"),
  issueDate: f("2026-10-16", "16/10/2026"),
  dueDate: f("2026-10-31", "31/10/2026"),
  servicePeriod: f("2026-10", "Octubre 2026"),
  currency: f("COP", "COP"),
  subtotal: f(12_000_000, "Subtotal COP 12.000.000"),
  tax: f(0, "IVA 0 % (exportación) COP 0"),
  total: f(12_000_000, "TOTAL A PAGAR COP 12.000.000"),
  lineItems: [{ description: "Desarrollo backend – tarifa fija mensual", quantity: 1, unitPrice: 12_000_000, amount: 12_000_000 }],
  payment: {
    beneficiaryName: f("Camila Restrepo Dev S.A.S.", "Beneficiario: Camila Restrepo Dev S.A.S."),
    bankName: f("Bancolombia", "Banco: Bancolombia"),
    accountNumber: f("4512 0098 7731", "Cuenta corriente N.º: 4512 0098 7731"),
    routingOrSwift: f("COLOCOBM", "SWIFT: COLOCOBM"),
  },
  embeddedInstructions: [],
  readerNotes: "",
};

/** R2-11: la proforma de CloudMetrics, leída como factura de octubre (para que solo la frene la marca). */
const cloudProforma: Extraction = {
  documentType: "invoice",
  vendorName: f("CloudMetrics Inc."),
  vendorTaxId: f("88-1234567", "EIN: 88-1234567"),
  invoiceNumber: f("PF-2026-1107"),
  issueDate: f("2026-10-16", "Oct 16, 2026"),
  dueDate: f<string>(null),
  servicePeriod: f("2026-10", "Oct 16, 2026"),
  currency: f("USD", "USD"),
  subtotal: f(1200, "Subtotal $1,200.00"),
  tax: f(0, "Tax $0.00"),
  total: f(1200, "Total $1,200.00"),
  lineItems: [{ description: "Team plan – monitoring subscription", quantity: 1, unitPrice: 1200, amount: 1200 }],
  payment: {
    beneficiaryName: f("CloudMetrics Inc.", "Beneficiario: CloudMetrics Inc."),
    bankName: f("Silicon Valley Bank", "Banco: Silicon Valley Bank"),
    accountNumber: f("3300198822", "Account: 3300198822"),
    routingOrSwift: f("121140399", "ABA: 121140399"),
  },
  embeddedInstructions: [],
  readerNotes: "",
};

describe("equipo rojo · ronda 2 · moneda escrita solo con «$»", () => {
  it("R2-06: el PDF argentino no nombra la moneda; con las lecturas en USD escala por ACU-2", async () => {
    const doc = await attackDoc("R2-06-pdf-peso-argentino-sin-codigo.pdf");
    expect(doc.plainText).toContain("Importe Total $ 2.800,00");
    const i = input("R2-06", doc, pampaUsd);
    expect(i.reading.signals.currencyOnlyDollarSign).toBe(true);
    expect(i.reading.signals.voidDocumentMarkers).toEqual([]);

    const d = decideWithGuard(i, ctx);
    expect(d.outcome).toBe("ESCALAR");
    expect(d.guardOverride).toBe(false);
    expect(notPassing(i)).toEqual(["ACU-2"]);
    const acu2 = d.checks.find((c) => c.code === "ACU-2")!;
    expect(acu2.status).toBe("fail");
    expect(acu2.explanation).toBe(
      "La factura solo escribe «$» y no dice la moneda. Para un proveedor de Argentina el «$» es el peso argentino (ARS), no USD: no se puede confirmar que cobre en la moneda pactada.",
    );
    expect(acu2.params).toMatchObject({ currencyOnlyDollarSign: true, vendorCountry: "AR", bareDollarMeans: "ARS" });
    expect(d.humanAction).toContain("Pedir al proveedor que confirme la moneda (que la factura diga USD) antes de pagar.");
  });

  it("R2-06: sin la señal, las mismas lecturas pagaban; si el motor pagara, la guardia no aprueba", async () => {
    const doc = await attackDoc("R2-06-pdf-peso-argentino-sin-codigo.pdf");
    const i = input("R2-06", doc, pampaUsd);
    const blind = withSignals(i, { currencyOnlyDollarSign: false });
    expect(decideWithGuard(blind, ctx).outcome).toBe("PAGAR");

    const enginePaid = decide(blind, ctx);
    expect(enginePaid.outcome).toBe("PAGAR");
    const g = guardPayment(i, ctx, enginePaid);
    expect(g.approved).toBe(false);
    expect(g.violations).toEqual(["la factura solo escribe «$»: para un proveedor de Argentina (AR) el «$» es el peso argentino (ARS), no USD"]);
  });

  it("R2-07: en la foto chilena las citas solo traen «$»; la nota del lector que dice USD no cuenta", async () => {
    const doc = await attackDoc("R2-07-png-peso-chileno-sin-codigo.png");
    expect(doc.kind).toBe("image");
    const i = input("R2-07", doc, datosSurUsd);
    expect(i.reading.signals.currencyOnlyDollarSign).toBe(true);
    const d = decideWithGuard(i, ctx);
    expect(d.outcome).toBe("ESCALAR");
    expect(notPassing(i)).toEqual(["ACU-2"]);
    expect(d.checks.find((c) => c.code === "ACU-2")!.explanation).toContain("Para un proveedor de Chile el «$» es el peso chileno (CLP), no USD");

    const blind = withSignals(i, { currencyOnlyDollarSign: false });
    expect(decideWithGuard(blind, ctx).outcome).toBe("PAGAR");
    expect(guardPayment(i, ctx, decide(blind, ctx)).violations).toEqual(["la factura solo escribe «$»: para un proveedor de Chile (CL) el «$» es el peso chileno (CLP), no USD"]);
  });
});

describe("equipo rojo · ronda 2 · documentos que no son un cobro", () => {
  it("R2-08: la factura con el sello «ANULADA» escala por LEC-1 aunque las dos lecturas digan «invoice»", async () => {
    const doc = await attackDoc("R2-08-pdf-factura-anulada.pdf");
    const i = input("R2-08", doc, camilaAnulada);
    expect(i.reading.signals.voidDocumentMarkers).toEqual([{ text: "ANULADA", reason: "Dice que el documento está anulado o cancelado", kind: "void" }]);
    expect(i.reading.signals.currencyOnlyDollarSign).toBe(false);

    const d = decideWithGuard(i, ctx);
    expect(d.outcome).toBe("ESCALAR");
    expect(d.guardOverride).toBe(false);
    expect(notPassing(i)).toEqual(["LEC-1"]);
    const lec1 = d.checks.find((c) => c.code === "LEC-1")!;
    expect(lec1.explanation).toBe("El documento no es un cobro válido: «ANULADA» (Dice que el documento está anulado o cancelado).");
    expect(lec1.params.voidMarkers).toBe(1);
    expect(d.humanAction).toContain("Confirmar con el proveedor si hay una factura vigente que reemplace a esta; esta no se paga.");
  });

  it("R2-08: sin la señal, las mismas lecturas pagaban; si el motor pagara, la guardia no aprueba", async () => {
    const doc = await attackDoc("R2-08-pdf-factura-anulada.pdf");
    const i = input("R2-08", doc, camilaAnulada);
    const blind = withSignals(i, { voidDocumentMarkers: [] });
    expect(decideWithGuard(blind, ctx).outcome).toBe("PAGAR");
    const g = guardPayment(i, ctx, decide(blind, ctx));
    expect(g.approved).toBe(false);
    expect(g.violations).toEqual(["el documento no es un cobro válido («ANULADA»)"]);
  });

  it("R2-11: la proforma escala por LEC-1 aunque las lecturas la tomen por la factura de octubre", async () => {
    const doc = await attackDoc("R2-11-pdf-proforma.pdf");
    const i = input("R2-11", doc, cloudProforma);
    expect(i.reading.signals.voidDocumentMarkers?.map((m) => m.text)).toEqual([
      "PROFORMA INVOICE",
      "PROFORMA #",
      "This proforma is not a tax invoice. The final invoice will be issued on Nov 1, 2026.",
    ]);
    const d = decideWithGuard(i, ctx);
    expect(d.outcome).toBe("ESCALAR");
    expect(notPassing(i)).toEqual(["LEC-1"]);
    expect(d.checks.find((c) => c.code === "LEC-1")!.explanation).toContain("El documento no es un cobro válido: «PROFORMA INVOICE»");
    expect(decideWithGuard(withSignals(i, { voidDocumentMarkers: [] }), ctx).outcome).toBe("PAGAR");
  });
});

describe("equipo rojo · ronda 2 · variantes que el primer cableado dejaba pasar", () => {
  // Hallazgos SEG-1/F1: con una mención del dólar en cualquier otra parte del texto, la señal se apagaba
  // y se pagaban USD 2.800 por ARS 2.800. Ahora solo cuenta lo escrito junto al total (o un campo «Moneda»).
  it.each([
    ["R2-06-nota-cotizacion-dolar.pdf", "Cotización dólar BNA (referencia): $ 1.050,00"],
    ["R2-06-nota-no-dolares.pdf", "Pagos únicamente en pesos; no se aceptan dólares."],
    ["R2-06-nota-equivalente-usd.pdf", "Equivalente aproximado: USD 2,67"],
    ["R2-06-correo-firma-usd.eml", "Cotizamos en USD para clientes del exterior"],
  ])("%s: una mención del dólar fuera del total no apaga la señal; escala por ACU-2", async (file, line) => {
    const doc = await attackDoc(file);
    expect(doc.plainText).toContain(line);
    const i = input(file, doc, pampaUsd);
    expect(i.reading.signals.currencyOnlyDollarSign).toBe(true);
    expect(i.reading.signals.currencyMarker).toBe("$");
    const d = decideWithGuard(i, ctx);
    expect(d.outcome).toBe("ESCALAR");
    expect(d.checks.find((c) => c.code === "ACU-2")!.status).toBe("fail");
    expect(d.checks.find((c) => c.code === "ACU-2")!.explanation).toContain("Para un proveedor de Argentina el «$» es el peso argentino (ARS), no USD");
    // Independencia: si el motor la hubiera pagado, la guardia no aprueba.
    const blind = withSignals(i, { currencyOnlyDollarSign: false });
    expect(guardPayment(i, ctx, decide(blind, ctx)).approved).toBe(false);
  });

  // Hallazgos SEG-2/SEG-3/SEG-4: anulaciones que el detector no veía (frase con número, sello con
  // mayúscula inicial, campo «Estado», sello con «NO PAGAR», sello en la línea del total, sello girado).
  it.each([
    ["R2-08-nota-sin-sello.pdf", "La factura CRD-1088 fue anulada y reemplazada por la CRD-1089. No pagar."],
    ["R2-08-sello-capitalizado.pdf", "Anulada"],
    ["R2-08-sello-no-pagar.pdf", "ANULADA – NO PAGAR"],
    ["R2-08-sello-void.pdf", "VOID – DO NOT PAY"],
    ["R2-08-estado-anulada.pdf", "Anulada"],
    ["R2-08-sello-en-linea-del-total.pdf", "TOTAL A PAGAR COP 12.000.000 ANULADA"],
    ["R2-08-sello-girado-espaciado.pdf", "ANULA DA"],
  ])("%s: escala por LEC-1 aunque las dos lecturas digan «invoice»", async (file, marker) => {
    const doc = await attackDoc(file);
    const i = input(file, doc, camilaAnulada);
    expect(i.reading.signals.voidDocumentMarkers?.map((m) => m.text)).toContain(marker);
    expect(i.reading.signals.voidDocumentMarkers?.every((m) => m.kind === "void")).toBe(true);
    const d = decideWithGuard(i, ctx);
    expect(d.outcome).toBe("ESCALAR");
    expect(notPassing(i)).toContain("LEC-1");
    expect(d.checks.find((c) => c.code === "LEC-1")!.explanation).toContain(`«${marker}»`);
    expect(d.humanAction).toContain("Confirmar con el proveedor si hay una factura vigente que reemplace a esta; esta no se paga.");
    const blind = withSignals(i, { voidDocumentMarkers: [] });
    const g = guardPayment(i, ctx, decide(blind, ctx));
    expect(g.approved).toBe(false);
    expect(g.violations[0]).toMatch(/^el documento no es un cobro válido \(«/);
  });

  it("R2-11: la proforma pide la factura definitiva, no una que la reemplace", async () => {
    const doc = await attackDoc("R2-11-pdf-proforma.pdf");
    const d = decideWithGuard(input("R2-11", doc, cloudProforma), ctx);
    expect(d.humanAction).toContain("Pedir al proveedor la factura definitiva; un borrador o una proforma no se paga.");
    expect(d.humanAction).not.toContain("reemplace a esta");
  });
});

describe("facturas buenas con conversación alrededor siguen pagando (hallazgos AUT-1 a AUT-5)", () => {
  const manifest = manifestJson as unknown as ManifestEntry[];
  async function caseDoc(caseId: string): Promise<{ doc: NormalizedDoc; truth: Extraction }> {
    const entry = manifest.find((e) => e.caseId === caseId)!;
    const bytes = new Uint8Array(readFileSync(path.join(here, "..", "..", "dataset", "generated", entry.file)));
    return { doc: await normalizeFile(bytes, entry.file, entry.mediaType), truth: entry.groundTruth as Extraction };
  }

  it.each([
    "14/10/2026, 10:10 - Lucía Méndez: Dale. Si hay algún ajuste nos mandan nota crédito.",
    "14/10/2026, 10:10 - Lucía Méndez: ¿Esto no es una factura proforma, no?\n14/10/2026, 10:11 - Martín Ferreyra (Pampa Ops): No no, es la Factura E definitiva.",
    "14/10/2026, 10:10 - Martín Ferreyra (Pampa Ops): la 0003-00000870 que te mandé el lunes tenía mal el CBU. Esa factura está anulada, vale esta.",
    "14/10/2026, 10:10 - Lucía Méndez: La nota crédito de septiembre ya la aplicamos, así que esta va completa.",
  ])("B05 (chat de Pampa) con «%s»: PAGAR", async (line) => {
    const entry = manifest.find((e) => e.caseId === "B05")!;
    const original = readFileSync(path.join(here, "..", "..", "dataset", "generated", entry.file), "utf8");
    const doc = await normalizeFile(new TextEncoder().encode(`${original.trimEnd()}\n${line}\n`), entry.file, entry.mediaType);
    const i = input("B05", doc, entry.groundTruth as Extraction);
    expect(i.reading.signals.voidDocumentMarkers).toEqual([]);
    expect(decideWithGuard(i, ctx).outcome).toBe("PAGAR");
  });

  it.each([
    "> Hi Ignacio, could you send us a proforma invoice for October first?",
    "> Hi Ignacio, is there a credit note pending from September?",
    "No credit memo applies to this invoice.",
    "Note: if the engagement is cancelled before delivery, this invoice is void and no payment is due.",
    "Ref.: Factura proforma PF-12 aprobada por Compras",
    "This invoice matches the proforma invoice PF-88 approved by your team on October 5.",
    "Specimen collection fee included in the hours above.",
  ])("H04 (correo de Datos del Sur) con «%s»: sin marcas de no cobrable", async (line) => {
    const { doc, truth } = await caseDoc("H04");
    const plainText = doc.plainText!.replace("Best regards,", `${line}\n\nBest regards,`);
    expect(plainText).toContain(line);
    const i = input("H04", { ...doc, plainText }, truth);
    expect(i.reading.signals.voidDocumentMarkers).toEqual([]);
    // «approved» activa LEC-4 (instrucciones) desde antes de estas reglas; el resto paga.
    if (!/approved/.test(line)) expect(decideWithGuard(i, ctx).outcome).toBe("PAGAR");
  });
});

describe("facturas normales del dataset (con la moneda escrita) siguen pagando", () => {
  const manifest = manifestJson as unknown as ManifestEntry[];
  it.each(["B01", "B02", "B04", "B05", "B15", "B19", "H04", "H11"])("%s: sin marcas de no cobrable ni «$» solo, y PAGAR", async (caseId) => {
    const entry = manifest.find((e) => e.caseId === caseId)!;
    const bytes = new Uint8Array(readFileSync(path.join(here, "..", "..", "dataset", "generated", entry.file)));
    const doc = await normalizeFile(bytes, entry.file, entry.mediaType);
    const i = input(caseId, doc, entry.groundTruth as Extraction);
    expect(i.reading.signals.voidDocumentMarkers).toEqual([]);
    expect(i.reading.signals.currencyOnlyDollarSign).toBe(false);
    expect(decideWithGuard(i, ctx).outcome).toBe("PAGAR");
  });
});
