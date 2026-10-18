/**
 * Oráculo del dataset: una versión mínima e independiente de las 15 comprobaciones, aplicada a
 * la lectura perfecta (groundTruth) de cada caso, escenario por escenario. Solo sirve para
 * validar que las specs producen la decisión y los códigos que fijan las etiquetas de
 * casos.csv. NO es el motor (src/engine) ni lo reemplaza.
 *
 * Supuestos (los mismos de docs/ARCHITECTURE.md):
 * - LEC-2 no se evalúa (requiere dos lectores): se da por bueno.
 * - Proveedor: por nombre o alias normalizado, o por identificación tributaria.
 * - DUP-1 mira cualquier decisión anterior; DUP-2 y DUP-3, solo pagos.
 * - Periodo del acuerdo = servicePeriod o mes de emisión; acuerdos "once" se pagan una sola vez.
 * - ACU-1 también falla si la factura dice a quién va dirigida y no es la compradora (company.buyer y
 *   company.name: otro nombre normalizado u otro id tributario), o si el mes facturado queda fuera de
 *   la vigencia del acuerdo.
 * - LEC-1 también falla si el documento no es una factura ni una cuenta de cobro (recibo, nota crédito,
 *   proforma, anulada, borrador) o si el archivo muestra a una persona algo que la lectura no ve
 *   (`humanOnly`: la versión HTML de un correo, una foto demasiado borrosa).
 * - ACU-2 también falla si el total solo se escribe con «$» y en el país del proveedor «$» es otra
 *   moneda (Argentina: pesos).
 */
import type { CaseRow } from "../../src/core/ports";
import type { CheckCode, Company, Extraction, Outcome, Rules, Vendor } from "../../src/core/schemas";
import { CHECK_BY_CODE } from "../../src/core/checks";
import { normalizeAccount, normalizeName, normalizeTaxId, splitLegalForm, toCents } from "../../src/core/normalize";
import type { Scenario } from "./cases";
import { isCopySpec, isDocumentSpec, isPhotoOfSpec, type CaseSpec } from "./spec";

export interface OracleInput {
  caseId: string;
  sha256: string;
  groundTruth: Extraction;
  /** Lo que el archivo le muestra a una persona y la lectura no (ver `humanOnlyIssues`). */
  humanOnly?: string[];
}

/**
 * Lo que una persona ve en el archivo y la lectura «perfecta» no trae, según la receta (spec): un correo
 * con versión HTML (las specs solo la llevan cuando dice otra cosa que el texto) o una foto con un
 * desenfoque que la deja ilegible (sigma 2,5 o más). Cada uno hace fallar LEC-1.
 */
export function humanOnlyIssues(spec: CaseSpec, byId: Map<string, CaseSpec>): string[] {
  const out: string[] = [];
  const photo = isPhotoOfSpec(spec) ? spec.photo : isDocumentSpec(spec) ? spec.photo : null;
  if (photo && photo.blur >= 2.5) out.push("foto demasiado borrosa");
  const doc = isCopySpec(spec) ? byId.get(spec.copyOf) : spec;
  if (doc && isDocumentSpec(doc) && doc.emailMeta?.html) out.push("versión HTML del correo distinta del texto");
  return out;
}

const PAYABLE = new Set(["invoice", "cuenta_de_cobro"]);
/** Lo que significa un «$» solo según el país del proveedor (los demás países: dólar). */
const BARE_DOLLAR: Record<string, string> = { CO: "COP", MX: "MXN", CL: "CLP", AR: "ARS", UY: "UYU" };

/** true si la cita de la moneda solo trae «$» (sin el código ni «US$», «R$», «S/»). */
function onlyDollarSign(evidence: string | null, currency: string): boolean {
  if (evidence == null) return false;
  if (new RegExp(`\\b${currency}\\b`).test(evidence) || /U\$S|US\$|R\$|S\//.test(evidence)) return false;
  return /(^|[^A-Za-z])\$/.test(evidence);
}

/** ¿El mes YYYY-MM se cruza con la vigencia del acuerdo? */
function periodInAgreement(period: string, a: { validFrom: string; validTo: string | null }): boolean {
  const [y, m] = period.split("-").map(Number);
  const last = `${period}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
  return last >= a.validFrom && (a.validTo == null || `${period}-01` <= a.validTo);
}

export interface OracleResult {
  caseId: string;
  scenarioId: string;
  outcome: Outcome;
  failing: CheckCode[];
  notEvaluable: CheckCode[];
  amountUsd: number | null;
}

interface Paid {
  caseId: string;
  sha256: string;
  outcome: Outcome;
  vendorId: string | null;
  invoiceNumber: string | null;
  agreementId: string | null;
  period: string | null;
  amountUsd: number | null;
}

const normInvoice = (s: string | null) => (s == null ? null : s.toUpperCase().replace(/[^A-Z0-9]/g, ""));

export function matchVendor(company: Company, gt: Extraction): Vendor | null {
  const name = normalizeName(gt.vendorName.value);
  const tax = normalizeTaxId(gt.vendorTaxId.value);
  for (const v of company.vendors) {
    const names = [v.name, ...v.aliases].map((n) => normalizeName(n));
    if (name && names.includes(name)) return v;
    if (tax && v.taxId && normalizeTaxId(v.taxId) === tax) return v;
  }
  return null;
}

/**
 * ¿La factura va dirigida a la compradora (o no dice a quién)? El nombre, sin forma societaria o con
 * una registrada para ese nombre («Andes Labs S.A.S.» es otra razón social que «Andes Labs Inc.»).
 */
export function billToIsBuyer(company: Company, gt: Extraction): boolean {
  const names = [company.name, ...(company.buyer?.legalNames ?? []), ...(company.buyer?.aliases ?? [])].map((n) => splitLegalForm(n));
  const taxIds = (company.buyer?.taxIds ?? []).map((t) => normalizeTaxId(t));
  const rawName = gt.billToName?.value ?? null;
  const name = splitLegalForm(rawName);
  const tax = normalizeTaxId(gt.billToTaxId?.value ?? null);
  if (rawName != null && rawName.trim() !== "") {
    if (name == null || !names.some((n) => n != null && n.base === name.base && (name.form === "" || n.form === name.form))) return false;
  }
  if (tax != null && taxIds.length > 0 && !taxIds.includes(tax)) return false;
  return true;
}

/** Evalúa los casos de un escenario en orden (historial vacío al inicio). */
export function evaluateScenario(company: Company, scenario: Scenario, cases: OracleInput[]): OracleResult[] {
  const rules: Rules = { ...company.rules, ...scenario.rulesOverride };
  const history: Paid[] = [];
  const results: OracleResult[] = [];

  for (const c of cases) {
    const gt = c.groundTruth;
    const status = new Map<CheckCode, "pass" | "fail" | "not_evaluable">();
    const set = (code: CheckCode, s: "pass" | "fail" | "not_evaluable") => status.set(code, s);

    // Lectura
    const critical = [gt.vendorName, gt.invoiceNumber, gt.currency, gt.total, gt.payment.accountNumber];
    const readable = critical.every((f) => f.value != null && f.legible);
    set("LEC-1", readable && PAYABLE.has(gt.documentType) && (c.humanOnly ?? []).length === 0 ? "pass" : "fail");
    set("LEC-2", "pass");
    const linesCents = gt.lineItems.reduce((s, l) => s + toCents(l.amount), 0);
    const taxCents = gt.tax.value == null ? 0 : toCents(gt.tax.value);
    let arithmeticOk = true;
    if (gt.subtotal.value != null) {
      if (gt.lineItems.length > 0 && linesCents !== toCents(gt.subtotal.value)) arithmeticOk = false;
      if (gt.total.value != null && toCents(gt.subtotal.value) + taxCents !== toCents(gt.total.value)) arithmeticOk = false;
    } else if (gt.total.value != null && gt.lineItems.length > 0 && linesCents + taxCents !== toCents(gt.total.value)) {
      arithmeticOk = false;
    }
    for (const l of gt.lineItems) {
      if (l.quantity != null && l.unitPrice != null && toCents(l.quantity * l.unitPrice) !== toCents(l.amount)) arithmeticOk = false;
    }
    set("LEC-3", arithmeticOk ? "pass" : "fail");
    set("LEC-4", gt.embeddedInstructions.length === 0 ? "pass" : "fail");

    // Proveedor y acuerdo
    const vendor = matchVendor(company, gt);
    set("PRV-1", vendor ? "pass" : "fail");
    const account = normalizeAccount(gt.payment.accountNumber.value);
    if (!vendor || !account) set("PRV-2", "not_evaluable");
    else set("PRV-2", account === normalizeAccount(vendor.account.accountNumber) ? "pass" : "fail");

    const agreement = vendor?.agreements[0] ?? null;
    const date = gt.issueDate.value ?? scenario.now.slice(0, 10);
    if (!billToIsBuyer(company, gt)) set("ACU-1", "fail");
    else if (!agreement) set("ACU-1", "not_evaluable");
    else {
      const inForce = date >= agreement.validFrom && (agreement.validTo == null || date <= agreement.validTo);
      const billed = gt.servicePeriod.value;
      const covered = agreement.frequency === "once" || billed == null || periodInAgreement(billed, agreement);
      set("ACU-1", inForce && covered ? "pass" : "fail");
    }
    const currency = gt.currency.value;
    if (!agreement || !currency) set("ACU-2", "not_evaluable");
    else {
      const bare = onlyDollarSign(gt.currency.evidence, currency);
      const meaning = bare && vendor ? (BARE_DOLLAR[vendor.country] ?? "USD") : currency;
      set("ACU-2", currency === agreement.currency && meaning === currency ? "pass" : "fail");
    }
    const total = gt.total.value;
    if (!agreement || total == null) set("ACU-3", "not_evaluable");
    else if (agreement.kind === "hourly") {
      const qty = gt.lineItems.reduce((s, l) => s + (l.quantity ?? 0), 0);
      const rateOk = gt.lineItems.every((l) => l.unitPrice == null || toCents(l.unitPrice) === toCents(agreement.rate ?? 0));
      const qtyOk = agreement.maxQuantity == null || qty <= agreement.maxQuantity;
      const totalOk = toCents(total) === toCents(qty * (agreement.rate ?? 0));
      set("ACU-3", currency === agreement.currency && rateOk && qtyOk && totalOk ? "pass" : "fail");
    } else {
      const amount = agreement.amount ?? 0;
      const tol = Math.round(toCents(amount) * (rules.amountTolerancePct / 100));
      set("ACU-3", currency === agreement.currency && Math.abs(toCents(total) - toCents(amount)) <= tol ? "pass" : "fail");
    }

    // Duplicados
    const number = normInvoice(gt.invoiceNumber.value);
    const period = agreement?.frequency === "once" ? "once" : (gt.servicePeriod.value ?? gt.issueDate.value?.slice(0, 7) ?? null);
    const paid = history.filter((h) => h.outcome === "PAGAR");
    set("DUP-1", history.some((h) => h.sha256 === c.sha256) ? "fail" : "pass");
    if (!vendor || !number) set("DUP-2", "not_evaluable");
    else set("DUP-2", paid.some((h) => h.vendorId === vendor.id && h.invoiceNumber === number) ? "fail" : "pass");
    if (!agreement || !period) set("DUP-3", "not_evaluable");
    else set("DUP-3", paid.some((h) => h.agreementId === agreement.id && h.period === period) ? "fail" : "pass");

    // Límites y fondo
    const fx = currency ? rules.fxToUsd[currency] : undefined;
    const amountUsd = total != null && fx != null ? total * fx : null;
    if (amountUsd == null) {
      set("LIM-1", "not_evaluable");
      set("LIM-2", "not_evaluable");
      set("FON-1", "not_evaluable");
    } else {
      set("LIM-1", amountUsd > rules.approvalThresholdUsd ? "fail" : "pass");
      // Todos los pagos del escenario ocurren en el mismo mes (el de `now`).
      const totalPaid = paid.reduce((s, h) => s + (h.amountUsd ?? 0), 0);
      set("LIM-2", totalPaid + amountUsd > rules.periodLimitUsd ? "fail" : "pass");
      set("FON-1", rules.initialFundUsd - totalPaid < amountUsd ? "fail" : "pass");
    }

    const failing = [...status].filter(([, s]) => s === "fail").map(([code]) => code);
    const notEvaluable = [...status].filter(([, s]) => s === "not_evaluable").map(([code]) => code);
    let outcome: Outcome = "PAGAR";
    if (failing.some((code) => CHECK_BY_CODE[code].outcomeIfFail === "FRENAR")) outcome = "FRENAR";
    else if (failing.length > 0 || notEvaluable.length > 0) outcome = "ESCALAR";

    results.push({ caseId: c.caseId, scenarioId: scenario.id, outcome, failing, notEvaluable, amountUsd });
    history.push({
      caseId: c.caseId,
      sha256: c.sha256,
      outcome,
      vendorId: vendor?.id ?? null,
      invoiceNumber: number,
      agreementId: agreement?.id ?? null,
      period,
      amountUsd,
    });
  }
  return results;
}

/** Evalúa todos los escenarios de casos.csv. */
export function evaluateDataset(company: Company, scenarios: Scenario[], rows: CaseRow[], byCase: Map<string, OracleInput>): OracleResult[] {
  const out: OracleResult[] = [];
  for (const scenario of scenarios) {
    const cases = rows
      .filter((r) => r.escenario === scenario.id)
      .map((r) => {
        const input = byCase.get(r.id);
        if (!input) throw new Error(`Falta el caso generado ${r.id}`);
        return input;
      });
    out.push(...evaluateScenario(company, scenario, cases));
  }
  return out;
}
