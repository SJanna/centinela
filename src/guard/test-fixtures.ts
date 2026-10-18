/**
 * Constructores para las pruebas de la guardia. Solo los usan los *.test.ts de esta carpeta.
 * La empresa es una copia congelada de dataset/company.json (para que las pruebas unitarias no
 * cambien si alguien ajusta el dataset); hay una prueba aparte que sí lee el dataset real.
 */
import type {
  CheckCode,
  CheckResult,
  Company,
  Decision,
  DecisionContext,
  EngineInput,
  Extraction,
  HistoryEntry,
  InvoiceData,
  ReaderResult,
  ReadingSignals,
} from "../core/schemas";

export const NOW = "2026-10-20T15:00:00Z";

export const COMPANY: Company = {
  name: "Andes Labs Inc.",
  rules: {
    approvalThresholdUsd: 5000,
    periodLimitUsd: 25000,
    initialFundUsd: 40000,
    amountTolerancePct: 1,
    fxToUsd: { USD: 1, COP: 0.00025, MXN: 0.055, BRL: 0.19, PEN: 0.27, EUR: 1.08, ARS: 0.001, CLP: 0.00105 },
  },
  vendors: [
    {
      id: "v-camila", name: "Camila Restrepo Dev S.A.S.", aliases: ["Camila Restrepo", "CR Dev"], taxId: "901.456.789-1", country: "CO",
      account: { beneficiaryName: "Camila Restrepo Dev S.A.S.", bankName: "Bancolombia", accountNumber: "4512-0098-7731", routingOrSwift: "COLOCOBM" },
      agreements: [{ id: "a-camila-mensual", description: "Desarrollo backend, tarifa fija mensual", kind: "fixed_recurring", currency: "COP", amount: 12000000, rate: null, maxQuantity: null, frequency: "monthly", validFrom: "2026-01-01", validTo: null }],
    },
    {
      id: "v-nopal", name: "Estudio Nopal S. de R.L.", aliases: ["Estudio Nopal"], taxId: "ENO210415AB3", country: "MX",
      account: { beneficiaryName: "Estudio Nopal S. de R.L.", bankName: "BBVA México", accountNumber: "012180001234567891", routingOrSwift: "BCMRMXMM" },
      agreements: [{ id: "a-nopal-diseno", description: "Diseño de producto por hora, máximo 120 h/mes", kind: "hourly", currency: "MXN", amount: null, rate: 900, maxQuantity: 120, frequency: "monthly", validFrom: "2026-03-01", validTo: null }],
    },
    {
      id: "v-testa", name: "Testa Qualidade Ltda", aliases: ["Testa Qualidade"], taxId: "12.345.678/0001-90", country: "BR",
      account: { beneficiaryName: "Testa Qualidade Ltda", bankName: "Itaú Unibanco", accountNumber: "0341-45678-9", routingOrSwift: "ITAUBRSP" },
      agreements: [{ id: "a-testa-qa", description: "QA manual y automatizado, fijo mensual", kind: "fixed_recurring", currency: "BRL", amount: 9500, rate: null, maxQuantity: null, frequency: "monthly", validFrom: "2026-02-01", validTo: null }],
    },
    {
      id: "v-cloudmetrics", name: "CloudMetrics Inc.", aliases: ["CloudMetrics"], taxId: "88-1234567", country: "US",
      account: { beneficiaryName: "CloudMetrics Inc.", bankName: "Silicon Valley Bank", accountNumber: "3300198822", routingOrSwift: "121140399" },
      agreements: [{ id: "a-cloudmetrics-saas", description: "Suscripción SaaS de monitoreo, plan Team", kind: "fixed_recurring", currency: "USD", amount: 1200, rate: null, maxQuantity: null, frequency: "monthly", validFrom: "2026-01-01", validTo: null }],
    },
    {
      id: "v-bufete", name: "Bufete Andino Abogados S.A.S.", aliases: ["Bufete Andino"], taxId: "900.222.333-4", country: "CO",
      account: { beneficiaryName: "Bufete Andino Abogados S.A.S.", bankName: "Banco de Bogotá", accountNumber: "0098-7766-5544", routingOrSwift: "BBOGCOBB" },
      agreements: [{ id: "a-bufete-cotizacion", description: "Cotización única: constitución de subsidiaria en Colombia", kind: "one_off", currency: "USD", amount: 4500, rate: null, maxQuantity: null, frequency: "once", validFrom: "2026-10-01", validTo: "2026-12-31" }],
    },
    {
      id: "v-pampa", name: "Pampa Ops SRL", aliases: ["Pampa Ops"], taxId: "30-71234567-8", country: "AR",
      account: { beneficiaryName: "Pampa Ops SRL", bankName: "Banco Galicia", accountNumber: "0070999030004123456789", routingOrSwift: "GABAARBA" },
      agreements: [{ id: "a-pampa-devops", description: "DevOps gestionado, fijo mensual en dólares", kind: "fixed_recurring", currency: "USD", amount: 2800, rate: null, maxQuantity: null, frequency: "monthly", validFrom: "2026-01-01", validTo: null }],
    },
    {
      id: "v-datossur", name: "Datos del Sur SpA", aliases: ["Datos del Sur"], taxId: "76.543.210-K", country: "CL",
      account: { beneficiaryName: "Datos del Sur SpA", bankName: "Banco de Chile", accountNumber: "00-123-45678-09", routingOrSwift: "BCHICLRM" },
      agreements: [{ id: "a-datossur-analitica", description: "Analítica de datos por hora, máximo 100 h/mes", kind: "hourly", currency: "USD", amount: null, rate: 60, maxQuantity: 100, frequency: "monthly", validFrom: "2026-04-01", validTo: null }],
    },
    {
      id: "v-northwind", name: "Northwind Hosting LLC", aliases: ["Northwind Hosting"], taxId: "47-9988776", country: "US",
      account: { beneficiaryName: "Northwind Hosting LLC", bankName: "JPMorgan Chase", accountNumber: "778899001122", routingOrSwift: "021000021" },
      agreements: [{ id: "a-northwind-infra", description: "Infraestructura dedicada, fijo mensual", kind: "fixed_recurring", currency: "USD", amount: 7200, rate: null, maxQuantity: null, frequency: "monthly", validFrom: "2026-01-01", validTo: null }],
    },
    {
      id: "v-inca", name: "Inca Contenidos S.A.C.", aliases: ["Inca Contenidos"], taxId: "20601234567", country: "PE",
      account: { beneficiaryName: "Inca Contenidos S.A.C.", bankName: "BCP", accountNumber: "191-2345678-0-12", routingOrSwift: "BCPLPEPL" },
      agreements: [{ id: "a-inca-contenidos", description: "Marketing de contenidos, fijo mensual", kind: "fixed_recurring", currency: "PEN", amount: 6000, rate: null, maxQuantity: null, frequency: "monthly", validFrom: "2026-05-01", validTo: null }],
    },
    {
      id: "v-caribe", name: "Soporte Caribe S.A.S.", aliases: ["Soporte Caribe"], taxId: "901.777.888-2", country: "CO",
      account: { beneficiaryName: "Soporte Caribe S.A.S.", bankName: "Davivienda", accountNumber: "0550-4881-2233", routingOrSwift: "CAFECOBB" },
      agreements: [{ id: "a-caribe-soporte", description: "Soporte al cliente por hora, máximo 160 h/mes", kind: "hourly", currency: "COP", amount: null, rate: 80000, maxQuantity: 160, frequency: "monthly", validFrom: "2026-06-01", validTo: null }],
    },
    {
      id: "v-roble", name: "Imprenta Viejo Roble S.A.", aliases: ["Viejo Roble"], taxId: "900.111.000-5", country: "CO",
      account: { beneficiaryName: "Imprenta Viejo Roble S.A.", bankName: "Banco de Occidente", accountNumber: "0231-0099-8811", routingOrSwift: "OCCICOBC" },
      agreements: [{ id: "a-roble-impresion", description: "Material impreso, fijo mensual (contrato terminado)", kind: "fixed_recurring", currency: "USD", amount: 900, rate: null, maxQuantity: null, frequency: "monthly", validFrom: "2026-01-01", validTo: "2026-06-30" }],
    },
  ],
};

export const ALL_CODES: CheckCode[] = [
  "LEC-1", "LEC-2", "LEC-3", "LEC-4", "DUP-1", "DUP-2", "DUP-3", "PRV-1", "PRV-2",
  "ACU-1", "ACU-2", "ACU-3", "LIM-1", "LIM-2", "FON-1",
];

/** Lo que dice la factura (valores "en bruto", como los leería un modelo). */
export interface InvoiceSpec {
  documentType?: Extraction["documentType"];
  vendorName: string | null;
  vendorTaxId: string | null;
  invoiceNumber: string | null;
  issueDate: string | null;
  dueDate?: string | null;
  servicePeriod: string | null;
  currency: string | null;
  subtotal?: number | null;
  tax?: number | null;
  total: number | null;
  lineItems: Extraction["lineItems"];
  beneficiaryName?: string | null;
  bankName?: string | null;
  accountNumber: string | null;
  routingOrSwift?: string | null;
}

function fieldOf<T>(value: T | null, legible = true) {
  return { value, evidence: value === null ? null : String(value), legible };
}

export function makeExtraction(spec: InvoiceSpec): Extraction {
  return {
    documentType: spec.documentType ?? "invoice",
    vendorName: fieldOf(spec.vendorName),
    vendorTaxId: fieldOf(spec.vendorTaxId),
    invoiceNumber: fieldOf(spec.invoiceNumber),
    issueDate: fieldOf(spec.issueDate),
    dueDate: fieldOf(spec.dueDate ?? null),
    servicePeriod: fieldOf(spec.servicePeriod),
    currency: fieldOf(spec.currency),
    subtotal: fieldOf(spec.subtotal ?? spec.total),
    tax: fieldOf(spec.tax ?? 0),
    total: fieldOf(spec.total),
    lineItems: spec.lineItems,
    payment: {
      beneficiaryName: fieldOf(spec.beneficiaryName ?? spec.vendorName),
      bankName: fieldOf(spec.bankName ?? null),
      accountNumber: fieldOf(spec.accountNumber),
      routingOrSwift: fieldOf(spec.routingOrSwift ?? null),
    },
    embeddedInstructions: [],
    readerNotes: "",
  };
}

/** Lo que haría la verificación: datos de la lectura principal con la cuenta normalizada. */
export function dataFromExtraction(e: Extraction): InvoiceData {
  const account = e.payment.accountNumber.value;
  return {
    documentType: e.documentType,
    vendorName: e.vendorName.value,
    vendorTaxId: e.vendorTaxId.value,
    invoiceNumber: e.invoiceNumber.value,
    issueDate: e.issueDate.value,
    dueDate: e.dueDate.value,
    servicePeriod: e.servicePeriod.value,
    currency: e.currency.value,
    subtotal: e.subtotal.value,
    tax: e.tax.value,
    total: e.total.value,
    lineItems: e.lineItems,
    beneficiaryName: e.payment.beneficiaryName.value,
    bankName: e.payment.bankName.value,
    accountNumber: account === null ? null : account.toUpperCase().replace(/[^A-Z0-9]/g, ""),
    routingOrSwift: e.payment.routingOrSwift.value,
  };
}

export function emptySignals(): ReadingSignals {
  return {
    missingCriticalFields: [],
    illegibleCriticalFields: [],
    readersDisagreeOn: [],
    arithmeticIssues: [],
    suspiciousInstructions: [],
    evidenceNotFound: [],
    paidDocumentMarkers: [],
    ingestWarnings: [],
    voidDocumentMarkers: [],
    currencyOnlyDollarSign: false,
  };
}

export function okReader(readerId: string, extraction: Extraction): ReaderResult {
  return { ok: true, readerId, model: `modelo-${readerId}`, promptVersion: "p1", extraction };
}

export interface InputOptions {
  invoiceId?: string;
  fileHash?: string;
  signals?: Partial<ReadingSignals>;
}

export function makeInput(spec: InvoiceSpec, opts: InputOptions = {}): EngineInput {
  const primary = makeExtraction(spec);
  const secondary = makeExtraction(spec);
  return {
    invoiceId: opts.invoiceId ?? "inv-1",
    fileHash: opts.fileHash ?? "hash-inv-1",
    reading: {
      primary: okReader("principal", primary),
      secondary: okReader("secundario", secondary),
      data: dataFromExtraction(primary),
      signals: { ...emptySignals(), ...opts.signals },
    },
  };
}

export function passChecks(): CheckResult[] {
  return ALL_CODES.map((code) => ({ code, status: "pass", outcomeIfFail: "ESCALAR", explanation: "ok", params: {} }));
}

export function makeDecision(input: EngineInput, d: Partial<Decision> & Pick<Decision, "vendorId" | "agreementId" | "agreementPeriod" | "amountUsd">): Decision {
  return {
    invoiceId: input.invoiceId,
    outcome: "PAGAR",
    checks: passChecks(),
    summary: "Se paga.",
    humanAction: null,
    guard: null,
    guardOverride: false,
    ...d,
  };
}

export function makeCtx(opts: { rules?: Partial<Company["rules"]>; history?: HistoryEntry[]; now?: string; company?: Company } = {}): DecisionContext {
  const base = opts.company ?? COMPANY;
  return {
    company: { ...base, rules: { ...base.rules, ...opts.rules } },
    history: opts.history ?? [],
    now: opts.now ?? NOW,
  };
}

let entrySeq = 0;
/**
 * Una decisión anterior. Por defecto es un PAGAR completo de un proveedor y un acuerdo ajenos a las
 * facturas de las pruebas (como los que escribe el pipeline: un PAGAR siempre trae proveedor,
 * número, acuerdo y periodo); cada prueba sobrescribe lo que le importa.
 */
export function entry(e: Partial<HistoryEntry>): HistoryEntry {
  entrySeq += 1;
  return {
    invoiceId: `prev-${entrySeq}`,
    fileHash: `hash-prev-${entrySeq}`,
    outcome: "PAGAR",
    vendorId: "v-otro",
    invoiceNumber: `OTRO-${entrySeq}`,
    agreementId: "a-otro",
    agreementPeriod: "2026-01",
    amountUsd: 0,
    decidedAt: "2026-10-10T12:00:00Z",
    ...e,
  };
}

// ───────────────────────── Facturas del dataset (descritas en casos.csv) ─────────────────────────

/** B01: octubre COP 12.000.000 de Camila (≈ USD 3.000). */
export function camilaOctober(over: Partial<InvoiceSpec> = {}): InvoiceSpec {
  return {
    vendorName: "Camila Restrepo Dev S.A.S.",
    vendorTaxId: "901.456.789-1",
    invoiceNumber: "CR-2026-010",
    issueDate: "2026-10-05",
    servicePeriod: "2026-10",
    currency: "COP",
    total: 12000000,
    lineItems: [{ description: "Desarrollo backend octubre", quantity: 1, unitPrice: 12000000, amount: 12000000 }],
    accountNumber: "4512-0098-7731",
    ...over,
  };
}
export const camilaDecision = { vendorId: "v-camila", agreementId: "a-camila-mensual", agreementPeriod: "2026-10", amountUsd: 3000 };

/** B02: suscripción de octubre USD 1.200 de CloudMetrics. */
export function cloudOctober(over: Partial<InvoiceSpec> = {}): InvoiceSpec {
  return {
    vendorName: "CloudMetrics Inc.",
    vendorTaxId: "88-1234567",
    invoiceNumber: "CM-10021",
    issueDate: "2026-10-01",
    servicePeriod: "2026-10",
    currency: "USD",
    total: 1200,
    lineItems: [{ description: "Plan Team octubre", quantity: 1, unitPrice: 1200, amount: 1200 }],
    accountNumber: "3300198822",
    ...over,
  };
}
export const cloudDecision = { vendorId: "v-cloudmetrics", agreementId: "a-cloudmetrics-saas", agreementPeriod: "2026-10", amountUsd: 1200 };

/** B03: octubre BRL 9.500 de Testa (≈ USD 1.805). */
export function testaOctober(over: Partial<InvoiceSpec> = {}): InvoiceSpec {
  return {
    vendorName: "Testa Qualidade Ltda",
    vendorTaxId: "12.345.678/0001-90",
    invoiceNumber: "NF-000123",
    issueDate: "2026-10-03",
    servicePeriod: "2026-10",
    currency: "BRL",
    total: 9500,
    lineItems: [{ description: "QA outubro", quantity: 1, unitPrice: 9500, amount: 9500 }],
    accountNumber: "0341-45678-9",
    ...over,
  };
}
export const testaDecision = { vendorId: "v-testa", agreementId: "a-testa-qa", agreementPeriod: "2026-10", amountUsd: 1805 };

/** Por horas: `hours` × tarifa para Nopal (MXN 900), Datos del Sur (USD 60) o Caribe (COP 80.000). */
export function hourly(
  vendor: "nopal" | "datossur" | "caribe",
  hours: number,
  over: Partial<InvoiceSpec> = {},
  unitPrice?: number,
): InvoiceSpec {
  const base = {
    nopal: { vendorName: "Estudio Nopal S. de R.L.", vendorTaxId: "ENO210415AB3", currency: "MXN", rate: 900, accountNumber: "012180001234567891" },
    datossur: { vendorName: "Datos del Sur SpA", vendorTaxId: "76.543.210-K", currency: "USD", rate: 60, accountNumber: "00-123-45678-09" },
    caribe: { vendorName: "Soporte Caribe S.A.S.", vendorTaxId: "901.777.888-2", currency: "COP", rate: 80000, accountNumber: "0550-4881-2233" },
  }[vendor];
  const price = unitPrice ?? base.rate;
  const total = hours * price;
  return {
    vendorName: base.vendorName,
    vendorTaxId: base.vendorTaxId,
    invoiceNumber: `${vendor.toUpperCase()}-77`,
    issueDate: "2026-10-06",
    servicePeriod: "2026-10",
    currency: base.currency,
    total,
    lineItems: [{ description: "Horas de servicio", quantity: hours, unitPrice: price, amount: total }],
    accountNumber: base.accountNumber,
    ...over,
  };
}
export const hourlyIds = {
  nopal: { vendorId: "v-nopal", agreementId: "a-nopal-diseno" },
  datossur: { vendorId: "v-datossur", agreementId: "a-datossur-analitica" },
  caribe: { vendorId: "v-caribe", agreementId: "a-caribe-soporte" },
} as const;

/** B15 / H12: cotización única de Bufete Andino, USD 4.500. */
export function bufeteQuote(over: Partial<InvoiceSpec> = {}): InvoiceSpec {
  return {
    vendorName: "Bufete Andino Abogados S.A.S.",
    vendorTaxId: "900.222.333-4",
    invoiceNumber: "BA-0451",
    issueDate: "2026-10-08",
    servicePeriod: null,
    currency: "USD",
    total: 4500,
    lineItems: [{ description: "Constitución de subsidiaria", quantity: 1, unitPrice: 4500, amount: 4500 }],
    accountNumber: "0098-7766-5544",
    ...over,
  };
}
export const bufeteDecision = { vendorId: "v-bufete", agreementId: "a-bufete-cotizacion", agreementPeriod: "2026-10", amountUsd: 4500 };

/** Inca Contenidos, PEN `total` (B20 = 6.000, H08 = 6.040). */
export function incaOctober(total: number, over: Partial<InvoiceSpec> = {}): InvoiceSpec {
  return {
    vendorName: "Inca Contenidos S.A.C.",
    vendorTaxId: "20601234567",
    invoiceNumber: "F001-000245",
    issueDate: "2026-10-02",
    servicePeriod: "2026-10",
    currency: "PEN",
    total,
    lineItems: [{ description: "Contenidos octubre", quantity: 1, unitPrice: total, amount: total }],
    accountNumber: "191-2345678-0-12",
    ...over,
  };
}

/** B05: cobro por chat de Pampa Ops, USD 2.800, sin fecha ni periodo escritos (un cobro: tipo "invoice"). */
export function pampaChat(over: Partial<InvoiceSpec> = {}): InvoiceSpec {
  return {
    documentType: "invoice",
    vendorName: "Pampa Ops",
    vendorTaxId: null,
    invoiceNumber: "PO-1010",
    issueDate: null,
    servicePeriod: null,
    currency: "USD",
    total: 2800,
    lineItems: [],
    accountNumber: "0070999030004123456789",
    ...over,
  };
}
export const pampaDecision = { vendorId: "v-pampa", agreementId: "a-pampa-devops", agreementPeriod: "2026-10", amountUsd: 2800 };

/** B11: Northwind USD 7.200 (supera el umbral). */
export function northwindOctober(over: Partial<InvoiceSpec> = {}): InvoiceSpec {
  return {
    vendorName: "Northwind Hosting LLC",
    vendorTaxId: "47-9988776",
    invoiceNumber: "NW-2026-10",
    issueDate: "2026-10-01",
    servicePeriod: "2026-10",
    currency: "USD",
    total: 7200,
    lineItems: [{ description: "Infraestructura octubre", quantity: 1, unitPrice: 7200, amount: 7200 }],
    accountNumber: "778899001122",
    ...over,
  };
}

/** Congela en profundidad (para comprobar que la guardia no modifica sus argumentos). */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as object)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}
