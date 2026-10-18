/**
 * Datos de prueba del motor (solo los usan los *.test.ts de esta carpeta).
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
  ReadingAssessment,
  ReadingSignals,
  Rules,
  Vendor,
} from "../core/schemas";

export const NOW = "2026-10-20T15:00:00Z";

export const RULES: Rules = {
  approvalThresholdUsd: 5000,
  periodLimitUsd: 25000,
  initialFundUsd: 40000,
  amountTolerancePct: 1,
  fxToUsd: { USD: 1, COP: 0.00025, MXN: 0.055, BRL: 0.19 },
};

/** Acuerdo fijo mensual en COP (≈ USD 3.000). */
export const ACME: Vendor = {
  id: "v-acme",
  name: "Acme Dev S.A.S.",
  aliases: ["Acme", "AD Software"],
  taxId: "900.123.456-7",
  country: "CO",
  account: {
    beneficiaryName: "Acme Dev S.A.S.",
    bankName: "Bancolombia",
    accountNumber: "4512-0098-7731",
    routingOrSwift: "COLOCOBM",
  },
  agreements: [
    {
      id: "a-acme-mensual",
      description: "Desarrollo backend, fijo mensual",
      kind: "fixed_recurring",
      currency: "COP",
      amount: 12_000_000,
      rate: null,
      maxQuantity: null,
      frequency: "monthly",
      validFrom: "2026-01-01",
      validTo: null,
    },
  ],
};

/** Acuerdo por hora en MXN: 900/h, máximo 120 h al mes. */
export const NOPAL: Vendor = {
  id: "v-nopal",
  name: "Estudio Nopal S. de R.L.",
  aliases: ["Estudio Nopal"],
  taxId: "ENO210415AB3",
  country: "MX",
  account: {
    beneficiaryName: "Estudio Nopal S. de R.L.",
    bankName: "BBVA México",
    accountNumber: "012180001234567891",
    routingOrSwift: "BCMRMXMM",
  },
  agreements: [
    {
      id: "a-nopal-diseno",
      description: "Diseño por hora, máximo 120 h/mes",
      kind: "hourly",
      currency: "MXN",
      amount: null,
      rate: 900,
      maxQuantity: 120,
      frequency: "monthly",
      validFrom: "2026-03-01",
      validTo: null,
    },
  ],
};

/** Cotización única en USD 4.500 con vigencia acotada. */
export const BUFETE: Vendor = {
  id: "v-bufete",
  name: "Bufete Andino Abogados S.A.S.",
  aliases: ["Bufete Andino"],
  taxId: "900.222.333-4",
  country: "CO",
  account: {
    beneficiaryName: "Bufete Andino Abogados S.A.S.",
    bankName: "Banco de Bogotá",
    accountNumber: "0098-7766-5544",
    routingOrSwift: "BBOGCOBB",
  },
  agreements: [
    {
      id: "a-bufete-cotizacion",
      description: "Cotización única: constitución de subsidiaria",
      kind: "one_off",
      currency: "USD",
      amount: 4500,
      rate: null,
      maxQuantity: null,
      frequency: "once",
      validFrom: "2026-10-01",
      validTo: "2026-12-31",
    },
  ],
};

/** Contrato terminado en junio. */
export const ROBLE: Vendor = {
  id: "v-roble",
  name: "Imprenta Viejo Roble S.A.",
  aliases: ["Viejo Roble"],
  taxId: "900.111.000-5",
  country: "CO",
  account: {
    beneficiaryName: "Imprenta Viejo Roble S.A.",
    bankName: "Banco de Occidente",
    accountNumber: "0231-0099-8811",
    routingOrSwift: "OCCICOBC",
  },
  agreements: [
    {
      id: "a-roble-impresion",
      description: "Material impreso, fijo mensual",
      kind: "fixed_recurring",
      currency: "USD",
      amount: 900,
      rate: null,
      maxQuantity: null,
      frequency: "monthly",
      validFrom: "2026-01-01",
      validTo: "2026-06-30",
    },
  ],
};

export function company(overrides: { rules?: Partial<Rules>; vendors?: Vendor[] } = {}): Company {
  return {
    name: "Andes Labs Inc.",
    rules: { ...RULES, ...overrides.rules },
    vendors: overrides.vendors ?? [ACME, NOPAL, BUFETE, ROBLE],
  };
}

/** Factura válida de Acme por el mes de octubre. */
export function acmeInvoice(overrides: Partial<InvoiceData> = {}): InvoiceData {
  return {
    documentType: "invoice",
    vendorName: "Acme Dev S.A.S.",
    vendorTaxId: "900.123.456-7",
    invoiceNumber: "FE-1001",
    issueDate: "2026-10-05",
    dueDate: "2026-10-20",
    servicePeriod: "2026-10",
    currency: "COP",
    subtotal: 12_000_000,
    tax: 0,
    total: 12_000_000,
    lineItems: [{ description: "Desarrollo backend octubre", quantity: 1, unitPrice: null, amount: 12_000_000 }],
    beneficiaryName: "Acme Dev S.A.S.",
    bankName: "Bancolombia",
    accountNumber: "451200987731",
    routingOrSwift: "COLOCOBM",
    ...overrides,
  };
}

/** Factura por horas de Nopal: 40 h × MXN 900. */
export function nopalInvoice(overrides: Partial<InvoiceData> = {}): InvoiceData {
  return {
    documentType: "invoice",
    vendorName: "Estudio Nopal",
    vendorTaxId: "ENO210415AB3",
    invoiceNumber: "N-77",
    issueDate: "2026-10-03",
    dueDate: null,
    servicePeriod: "2026-09",
    currency: "MXN",
    subtotal: 36_000,
    tax: 0,
    total: 36_000,
    lineItems: [{ description: "Diseño de producto", quantity: 40, unitPrice: 900, amount: 36_000 }],
    beneficiaryName: "Estudio Nopal S. de R.L.",
    bankName: "BBVA México",
    accountNumber: "012180001234567891",
    routingOrSwift: "BCMRMXMM",
    ...overrides,
  };
}

/** Cotización única de Bufete: USD 4.500. */
export function bufeteInvoice(overrides: Partial<InvoiceData> = {}): InvoiceData {
  return {
    documentType: "invoice",
    vendorName: "Bufete Andino Abogados S.A.S.",
    vendorTaxId: "900.222.333-4",
    invoiceNumber: "BA-2026-15",
    issueDate: "2026-10-10",
    dueDate: null,
    servicePeriod: null,
    currency: "USD",
    subtotal: 4500,
    tax: 0,
    total: 4500,
    lineItems: [{ description: "Constitución de subsidiaria", quantity: null, unitPrice: null, amount: 4500 }],
    beneficiaryName: "Bufete Andino Abogados S.A.S.",
    bankName: "Banco de Bogotá",
    accountNumber: "009877665544",
    routingOrSwift: "BBOGCOBB",
    ...overrides,
  };
}

export function noSignals(overrides: Partial<ReadingSignals> = {}): ReadingSignals {
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
    currencyMarker: "",
    ...overrides,
  };
}

const f = <T>(value: T | null) => ({ value, evidence: value == null ? null : String(value), legible: true });

/** Extracción mínima coherente con los datos (el motor no la usa; está para completar el tipo). */
export function extractionFrom(data: InvoiceData): Extraction {
  return {
    documentType: data.documentType,
    vendorName: f(data.vendorName),
    vendorTaxId: f(data.vendorTaxId),
    invoiceNumber: f(data.invoiceNumber),
    issueDate: f(data.issueDate),
    dueDate: f(data.dueDate),
    servicePeriod: f(data.servicePeriod),
    currency: f(data.currency),
    subtotal: f(data.subtotal),
    tax: f(data.tax),
    total: f(data.total),
    lineItems: data.lineItems,
    payment: {
      beneficiaryName: f(data.beneficiaryName),
      bankName: f(data.bankName),
      accountNumber: f(data.accountNumber),
      routingOrSwift: f(data.routingOrSwift),
    },
    embeddedInstructions: [],
    readerNotes: "",
  };
}

export function reading(data: InvoiceData | null, signals: ReadingSignals = noSignals()): ReadingAssessment {
  if (data == null) {
    return {
      primary: { ok: false, readerId: "primary", model: "test", promptVersion: "t1", error: "parse_error", message: "x" },
      secondary: null,
      data: null,
      signals,
    };
  }
  const extraction = extractionFrom(data);
  return {
    primary: { ok: true, readerId: "primary", model: "test", promptVersion: "t1", extraction },
    secondary: { ok: true, readerId: "secondary", model: "test-2", promptVersion: "t1", extraction },
    data,
    signals,
  };
}

export function engineInput(
  data: InvoiceData | null,
  opts: { signals?: Partial<ReadingSignals>; fileHash?: string; invoiceId?: string } = {},
): EngineInput {
  return {
    invoiceId: opts.invoiceId ?? "INV-TEST",
    fileHash: opts.fileHash ?? "a".repeat(64),
    reading: reading(data, noSignals(opts.signals)),
  };
}

export function context(
  opts: { history?: HistoryEntry[]; rules?: Partial<Rules>; vendors?: Vendor[]; now?: string } = {},
): DecisionContext {
  return {
    company: company({ rules: opts.rules, vendors: opts.vendors }),
    history: opts.history ?? [],
    now: opts.now ?? NOW,
  };
}

export function paid(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    invoiceId: "PREV-1",
    fileHash: "b".repeat(64),
    outcome: "PAGAR",
    vendorId: "v-other",
    invoiceNumber: "X-1",
    agreementId: "a-other",
    agreementPeriod: "2026-10",
    amountUsd: 100,
    decidedAt: "2026-10-10T12:00:00Z",
    ...overrides,
  };
}

export function check(decision: Decision, code: CheckCode): CheckResult {
  const c = decision.checks.find((x) => x.code === code);
  if (!c) throw new Error(`Falta la comprobación ${code}`);
  return c;
}
