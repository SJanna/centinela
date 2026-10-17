/**
 * Hechos derivados de la factura y la ficha de la empresa que usan varias comprobaciones:
 * proveedor emparejado, acuerdo vigente, periodo y monto en USD. Todo puro y determinista.
 */
import { monthOf, normalizeName, normalizeTaxId, toCents } from "../core/normalize";
import type {
  Agreement,
  DecisionContext,
  EngineInput,
  HistoryEntry,
  InvoiceData,
  Rules,
  Vendor,
} from "../core/schemas";
import { formatDate, listEs, truncate } from "./text";

// ───────────────────────── Normalizaciones locales ─────────────────────────

/** Número de factura: sin tildes, alfanumérico, mayúsculas. "fac-001 / a" → "FAC001A". */
export function normalizeInvoiceNumber(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const v = raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return v.length > 0 ? v : null;
}

/** Moneda: código en mayúsculas sin espacios, o null. */
export function normalizeCurrency(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const v = raw.trim().toUpperCase();
  return v.length > 0 ? v : null;
}

/** "2026-10-05" o "2026-10-05T…" → "2026-10-05"; cualquier otra cosa → null. */
export function isoDateOf(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw.trim());
  if (!m) return null;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** "2026-10" o "2026-10-05" → "2026-10"; cualquier otra cosa → null. */
export function periodOf(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const m = /^(\d{4})-(\d{2})(?:$|-)/.exec(raw.trim());
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return `${m[1]}-${m[2]}`;
}

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Huella sha256 para comparar: sin espacios alrededor y en minúsculas (hex). Se aplica a la
 * entrada Y al historial; normalizar solo un lado deja pasar el mismo archivo dos veces.
 */
export function normalizeFileHash(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const v = raw.trim().toLowerCase();
  return v.length > 0 ? v : null;
}

// ───────────────────────── Proveedor ─────────────────────────

export type VendorMatchBasis =
  /** Coincide la identificación tributaria (ambas presentes). */
  | "tax_id"
  /** Coincide el nombre o un alias (alguna de las dos identificaciones falta). */
  | "name"
  /** Ningún proveedor coincide. */
  | "none"
  /** Coinciden dos o más proveedores: no se puede saber cuál es. */
  | "ambiguous"
  /** El nombre coincide pero la identificación tributaria es distinta a la registrada. */
  | "tax_id_conflict"
  /** La factura no trae nombre ni identificación tributaria. */
  | "no_identity";

export interface VendorMatch {
  vendor: Vendor | null;
  basis: VendorMatchBasis;
  /** Frase en español que explica el resultado (se muestra en PRV-1). */
  reason: string;
}

/**
 * Empareja la factura con la ficha de proveedores.
 * Coincide si las identificaciones tributarias normalizadas son iguales (ambas presentes),
 * o si el nombre normalizado es igual al nombre o a un alias. Si ambas identificaciones
 * existen y difieren, NO coincide aunque el nombre sí. Dos o más coincidencias → ambiguo.
 */
export function matchVendor(data: InvoiceData, vendors: readonly Vendor[]): VendorMatch {
  const invoiceTax = normalizeTaxId(data.vendorTaxId);
  const invoiceName = normalizeName(data.vendorName);
  // Lo que viene de la factura se recorta: puede ser texto arbitrario puesto por quien la envía.
  const shownName = truncate(data.vendorName?.trim() || data.vendorTaxId?.trim() || "", 80);
  const shownInvoiceName = truncate(data.vendorName?.trim() ?? "", 80);
  const shownInvoiceTax = truncate(data.vendorTaxId?.trim() ?? "", 40);

  if (invoiceTax == null && invoiceName == null) {
    return {
      vendor: null,
      basis: "no_identity",
      reason: "La factura no trae el nombre ni la identificación tributaria de quien cobra.",
    };
  }

  const matches: { vendor: Vendor; by: "tax_id" | "name" }[] = [];
  const conflicts: Vendor[] = [];
  for (const vendor of vendors) {
    const vendorTax = normalizeTaxId(vendor.taxId);
    const nameHit =
      invoiceName != null && [vendor.name, ...vendor.aliases].some((n) => normalizeName(n) === invoiceName);
    if (invoiceTax != null && vendorTax != null) {
      if (invoiceTax === vendorTax) matches.push({ vendor, by: "tax_id" });
      else if (nameHit) conflicts.push(vendor);
    } else if (nameHit) {
      matches.push({ vendor, by: "name" });
    }
  }

  if (matches.length === 1) {
    const { vendor, by } = matches[0];
    const how =
      by === "tax_id"
        ? `coincide la identificación tributaria ${shownInvoiceTax}`
        : `coincide el nombre «${shownInvoiceName}»`;
    return { vendor, basis: by, reason: `${vendor.name} está en la ficha de proveedores (${how}).` };
  }
  if (matches.length > 1) {
    return {
      vendor: null,
      basis: "ambiguous",
      reason: `«${shownName}» coincide con más de un proveedor registrado (${listEs(
        matches.map((m) => m.vendor.name),
      )}); no se puede saber a cuál pagar.`,
    };
  }
  if (conflicts.length > 0) {
    const v = conflicts[0];
    return {
      vendor: null,
      basis: "tax_id_conflict",
      reason: `El nombre «${shownInvoiceName}» coincide con ${v.name}, pero la identificación tributaria de la factura (${shownInvoiceTax}) no es la registrada (${v.taxId}).`,
    };
  }
  return {
    vendor: null,
    basis: "none",
    reason: `«${shownName}» no está en la ficha de proveedores de la empresa.`,
  };
}

// ───────────────────────── Acuerdo ─────────────────────────

export type AgreementSelectionStatus =
  /** Hay acuerdo vigente para la fecha de referencia. */
  | "selected"
  /** La factura no trae fecha de emisión válida. */
  | "no_date"
  /** El proveedor no tiene acuerdos registrados. */
  | "no_agreements"
  /** Ningún acuerdo está vigente para la fecha de referencia. */
  | "none_valid";

export interface AgreementSelection {
  status: AgreementSelectionStatus;
  agreement: Agreement | null;
  /** Fecha usada para la vigencia (data.issueDate normalizada), o null. */
  referenceDate: string | null;
  /** Si no hay vigente: el acuerdo más cercano a la fecha (el último vencido o el próximo a empezar). */
  closest: Agreement | null;
}

/** Inicio de vigencia normalizado (YYYY-MM-DD) o null si la ficha trae una fecha ilegible. */
function startOf(agreement: Agreement): string | null {
  return isoDateOf(agreement.validFrom);
}

/** Fin de vigencia normalizado, null si la ficha trae una fecha ilegible, o "open" si no vence. */
function endOf(agreement: Agreement): string | null | "open" {
  return agreement.validTo == null ? "open" : isoDateOf(agreement.validTo);
}

/**
 * Vigente si validFrom ≤ fecha ≤ validTo (validTo null = sin fin). Las fechas se normalizan antes
 * de comparar: comparar textos tal cual daría «2026-10-05» ≤ «2026-6-30». Una fecha ilegible en la
 * ficha o en la factura nunca hace vigente un acuerdo.
 */
export function isAgreementValidOn(agreement: Agreement, date: string): boolean {
  const day = isoDateOf(date);
  const from = startOf(agreement);
  const to = endOf(agreement);
  if (day == null || from == null || to == null) return false;
  return from <= day && (to === "open" || day <= to);
}

/**
 * Elige el acuerdo vigente para la fecha de emisión de la factura.
 * Vigente si validFrom ≤ fecha ≤ validTo (validTo null = sin fin). Con varios vigentes,
 * prefiere el de la moneda de la factura; si sigue el empate, el primero de la ficha.
 */
export function selectAgreement(vendor: Vendor, data: InvoiceData): AgreementSelection {
  const referenceDate = isoDateOf(data.issueDate);
  if (vendor.agreements.length === 0) {
    return { status: "no_agreements", agreement: null, referenceDate, closest: null };
  }
  if (referenceDate == null) {
    return { status: "no_date", agreement: null, referenceDate: null, closest: null };
  }
  const valid = vendor.agreements.filter((a) => isAgreementValidOn(a, referenceDate));
  if (valid.length > 0) {
    const currency = normalizeCurrency(data.currency);
    const sameCurrency = valid.find((a) => normalizeCurrency(a.currency) === currency);
    return { status: "selected", agreement: sameCurrency ?? valid[0], referenceDate, closest: null };
  }
  const endedOn = (a: Agreement): string | null => {
    const to = endOf(a);
    return to != null && to !== "open" && to < referenceDate ? to : null;
  };
  const startsOn = (a: Agreement): string | null => {
    const from = startOf(a);
    return from != null && from > referenceDate ? from : null;
  };
  const ended = vendor.agreements
    .filter((a) => endedOn(a) != null)
    .reduce<Agreement | null>((best, a) => (best == null || (endedOn(a) ?? "") > (endedOn(best) ?? "") ? a : best), null);
  const upcoming = vendor.agreements
    .filter((a) => startsOn(a) != null)
    .reduce<Agreement | null>((best, a) => (best == null || (startsOn(a) ?? "") < (startsOn(best) ?? "") ? a : best), null);
  return { status: "none_valid", agreement: null, referenceDate, closest: ended ?? upcoming };
}

/** Texto de vigencia: "desde el 1 de enero de 2026, sin fecha de fin" o "del … al …". */
export function describeValidity(agreement: Agreement): string {
  if (agreement.validTo == null) return `desde el ${formatDate(agreement.validFrom)}, sin fecha de fin`;
  return `del ${formatDate(agreement.validFrom)} al ${formatDate(agreement.validTo)}`;
}

/**
 * Periodo al que se imputa el pago: mensual → servicePeriod (YYYY-MM) o el mes de emisión;
 * pago único → null.
 */
export function agreementPeriodOf(agreement: Agreement, data: InvoiceData): string | null {
  if (agreement.frequency === "once") return null;
  const fromService = periodOf(data.servicePeriod);
  if (fromService != null) return fromService;
  const issue = isoDateOf(data.issueDate);
  return issue != null ? monthOf(issue) : null;
}

// ───────────────────────── Monto en USD ─────────────────────────

export type UsdAmount =
  | { ok: true; currency: string; total: number; fxRate: number; amountUsdCents: number }
  | { ok: false; reason: "no_data" | "no_total" | "no_currency" | "no_rate"; currency: string | null };

/** total × rules.fxToUsd[moneda], en centavos de USD. */
export function computeUsdAmount(data: InvoiceData | null, rules: Rules): UsdAmount {
  if (data == null) return { ok: false, reason: "no_data", currency: null };
  const currency = normalizeCurrency(data.currency);
  if (!isFiniteNumber(data.total)) return { ok: false, reason: "no_total", currency };
  if (currency == null) return { ok: false, reason: "no_currency", currency };
  const fx = Object.prototype.hasOwnProperty.call(rules.fxToUsd, currency) ? rules.fxToUsd[currency] : undefined;
  if (!isFiniteNumber(fx) || fx <= 0) return { ok: false, reason: "no_rate", currency };
  return { ok: true, currency, total: data.total, fxRate: fx, amountUsdCents: toCents(data.total * fx) };
}

// ───────────────────────── Hechos completos ─────────────────────────

export interface Facts {
  data: InvoiceData | null;
  match: VendorMatch | null;
  vendor: Vendor | null;
  selection: AgreementSelection | null;
  agreement: Agreement | null;
  /** YYYY-MM del acuerdo mensual, o null (pago único o sin dato). */
  period: string | null;
  /** Moneda de la factura normalizada. */
  currency: string | null;
  usd: UsdAmount;
  /** Entradas del historial con resultado PAGAR. */
  paid: HistoryEntry[];
}

export function buildFacts(input: EngineInput, ctx: DecisionContext): Facts {
  const data = input.reading.data;
  const match = data != null ? matchVendor(data, ctx.company.vendors) : null;
  const vendor = match?.vendor ?? null;
  const selection = data != null && vendor != null ? selectAgreement(vendor, data) : null;
  const agreement = selection?.agreement ?? null;
  const period = data != null && agreement != null ? agreementPeriodOf(agreement, data) : null;
  return {
    data,
    match,
    vendor,
    selection,
    agreement,
    period,
    currency: normalizeCurrency(data?.currency),
    usd: computeUsdAmount(data, ctx.company.rules),
    paid: ctx.history.filter((h) => h.outcome === "PAGAR"),
  };
}
