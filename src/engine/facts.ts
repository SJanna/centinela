/**
 * Hechos derivados de la factura y la ficha de la empresa que usan varias comprobaciones:
 * proveedor emparejado, acuerdo vigente, periodo y monto en USD. Todo puro y determinista.
 */
import { monthOf, normalizeName, normalizeTaxId, taxIdsEquivalent, toCents } from "../core/normalize";
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

/**
 * Número de factura comparable: sin tildes, mayúsculas, sin separadores y sin ceros a la izquierda
 * en cada tramo numérico. "FE-0012", "fe 12" y "FE0012" → "FE12"; "fac-001 / a" → "FAC1A".
 * Generosa a propósito: confundir dos números solo frena o escala, nunca hace pagar dos veces.
 * Los tramos se separan por cualquier carácter que no sea letra o dígito ("1-02" → "12"). Las letras
 * y dígitos de ancho completo cuentan como los normales: "FE-１００１" es "FE1001", no "FE".
 */
export function normalizeInvoiceNumber(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const tokens = raw
    .replace(/[\uff01-\uff5e]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((t) => t.length > 0);
  const v = tokens.map((t) => t.replace(/\d+/g, (digits) => String(digits.replace(/^0+/, "") || "0"))).join("");
  return v.length > 0 ? v : null;
}

/** Moneda: código en mayúsculas sin espacios, o null. */
export function normalizeCurrency(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const v = raw.trim().toUpperCase();
  return v.length > 0 ? v : null;
}

function daysIn(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** "YYYY-MM-DD" → la misma fecha si existe en el calendario; null si no ("2026-02-30"). */
function existingDay(y: string, m: string, d: string): string | null {
  const month = Number(m);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > daysIn(Number(y), month)) return null;
  return `${y}-${m}-${d}`;
}

/**
 * Fecha de calendario escrita exactamente como YYYY-MM-DD (se toleran espacios alrededor). Es el
 * formato del contrato para issueDate, validFrom y validTo: con hora, con barras o con un día que
 * no existe → null (y quien la usa no la da por buena).
 */
export function calendarDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  return m ? existingDay(m[1], m[2], m[3]) : null;
}

/**
 * Instante ISO 8601: solo fecha, o fecha y hora (con «T» o espacio, segundos y fracción opcionales)
 * y zona opcional (Z, ±HH, ±HHMM, ±HH:MM). Devuelve el día TAL COMO ESTÁ ESCRITO, sin convertir de
 * zona: "2026-10-31T19:15:00-05:00" → "2026-10-31". Cualquier otra forma, o una hora imposible → null.
 */
export function isoDateOf(raw: unknown): string | null {
  return instantDays(raw)?.written ?? null;
}

/**
 * Día escrito de un instante ISO 8601 (ver isoDateOf) y día en UTC: si el instante trae zona
 * horaria distinta de UTC, puede ser otro ("2026-10-31T22:00:00-05:00" → escrito "2026-10-31",
 * UTC "2026-11-01"). Sin hora o sin zona, los dos son el mismo. null si no es un instante válido.
 */
function instantDays(raw: unknown): { written: string; utc: string } | null {
  if (typeof raw !== "string") return null;
  const m =
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s?(Z|([+-])(\d{2})(?::?(\d{2}))?)?)?$/.exec(
      raw.trim(),
    );
  if (!m) return null;
  const outOfRange = (v: string | undefined, max: number) => v !== undefined && Number(v) > max;
  if (outOfRange(m[4], 23) || outOfRange(m[5], 59) || outOfRange(m[6], 59)) return null;
  if (outOfRange(m[9], 23) || outOfRange(m[10], 59)) return null;
  const written = existingDay(m[1], m[2], m[3]);
  if (written == null) return null;
  if (m[4] === undefined || m[8] === undefined) return { written, utc: written };
  const offsetMinutes = (m[8] === "-" ? -1 : 1) * (Number(m[9]) * 60 + Number(m[10] ?? 0));
  const localMs = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0));
  return { written, utc: new Date(localMs - offsetMinutes * 60_000).toISOString().slice(0, 10) };
}

/**
 * Meses calendario (YYYY-MM) a los que puede pertenecer un instante: el de su día escrito y, si con
 * su zona horaria en UTC cae en otro mes, también ese. null si no es un instante válido.
 */
export function instantMonths(raw: unknown): string[] | null {
  const days = instantDays(raw);
  if (days == null) return null;
  return Array.from(new Set([monthOf(days.written), monthOf(days.utc)]));
}

/** Periodo "YYYY-MM" (mes 01–12), o el mes de una fecha de calendario válida. Otra forma → null. */
export function periodOf(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) return v;
  const day = calendarDate(v);
  return day == null ? null : monthOf(day);
}

/** null, undefined o texto en blanco: el dato no vino. Cualquier otro valor vino (y se valida). */
export function isAbsent(raw: unknown): boolean {
  return raw == null || (typeof raw === "string" && raw.trim().length === 0);
}

/**
 * Centavos enteros a partir de un monto en centavos con decimales (p. ej. tras aplicar una tasa):
 * primero se limpia el ruido de coma flotante (300000.49999999994 es 300000.5) y luego se redondea
 * la mitad hacia arriba (lejos de cero). Sin la limpieza, MXN 1.001 × 0,055 daría USD 55,05 en vez
 * de USD 55,06.
 */
export function roundCents(rawCents: number): number {
  const clean = Number(rawCents.toPrecision(15));
  const r = Math.round(Math.abs(clean));
  return clean < 0 && r !== 0 ? -r : r;
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
 * Coincide si las identificaciones tributarias son equivalentes (`taxIdsEquivalent`: iguales tras
 * normalizar, o iguales sin el dígito de verificación cuando solo una lo trae), con ambas presentes;
 * o, si alguna falta, si el nombre normalizado es igual al nombre o a un alias. Si ambas
 * identificaciones existen y no son equivalentes, NO coincide aunque el nombre sí. Dos o más
 * coincidencias → ambiguo.
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
      if (taxIdsEquivalent(data.vendorTaxId, vendor.taxId)) matches.push({ vendor, by: "tax_id" });
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

/**
 * Fecha con la que se mide la vigencia del acuerdo: la de emisión de la factura; si la factura NO
 * la trae, el día de ctx.now tal como está escrito. Una fecha de emisión presente pero inválida no
 * se reemplaza (sería pagar con una fecha que la factura no dice).
 */
export type ReferenceDate =
  | { ok: true; date: string; source: "issue_date" | "now" }
  | { ok: false; reason: "invalid_issue_date" | "no_date" };

export function referenceDateOf(data: InvoiceData, now: string | null | undefined): ReferenceDate {
  if (!isAbsent(data.issueDate)) {
    const issue = calendarDate(data.issueDate);
    return issue != null ? { ok: true, date: issue, source: "issue_date" } : { ok: false, reason: "invalid_issue_date" };
  }
  const today = isoDateOf(now);
  return today != null ? { ok: true, date: today, source: "now" } : { ok: false, reason: "no_date" };
}

/** Mes facturado: servicePeriod; si la factura no lo trae, el mes de la fecha de referencia. */
export type BilledPeriod =
  | { ok: true; period: string; source: "service_period" | "reference_date" }
  | { ok: false; reason: "invalid_service_period" | "no_date" };

export function billedPeriodOf(data: InvoiceData, referenceDate: string | null): BilledPeriod {
  if (!isAbsent(data.servicePeriod)) {
    const period = periodOf(data.servicePeriod);
    return period != null ? { ok: true, period, source: "service_period" } : { ok: false, reason: "invalid_service_period" };
  }
  const day = calendarDate(referenceDate);
  return day != null ? { ok: true, period: monthOf(day), source: "reference_date" } : { ok: false, reason: "no_date" };
}

export type AgreementSelectionStatus =
  /** Hay acuerdo vigente para la fecha de referencia y cubre el periodo facturado. */
  | "selected"
  /** La factura no trae fecha de emisión y la fecha actual tampoco es válida. */
  | "no_date"
  /** La factura trae una fecha de emisión que no es una fecha YYYY-MM-DD válida. */
  | "invalid_date"
  /** El proveedor no tiene acuerdos registrados. */
  | "no_agreements"
  /** Ningún acuerdo está vigente para la fecha de referencia. */
  | "none_valid"
  /** La factura trae un periodo facturado que no es YYYY-MM válido. */
  | "invalid_period"
  /** Hay acuerdo vigente en la fecha de referencia, pero el periodo facturado queda fuera de su vigencia. */
  | "period_outside";

export interface AgreementSelection {
  status: AgreementSelectionStatus;
  agreement: Agreement | null;
  /** Fecha usada para la vigencia (emisión o, si no hay, el día de `now`), o null. */
  referenceDate: string | null;
  /** De dónde salió referenceDate. */
  referenceSource: "issue_date" | "now" | null;
  /** Mes facturado (YYYY-MM) contra el que se revisa la vigencia, o null si no se pudo saber. */
  billedPeriod: string | null;
  /**
   * Si no hay vigente: el acuerdo más cercano a la fecha (el último vencido o el próximo a empezar).
   * Si el periodo queda fuera ("period_outside"): el acuerdo vigente en la fecha que no lo cubre.
   */
  closest: Agreement | null;
  /**
   * Todos los acuerdos vigentes en la fecha que cubren el periodo (incluido el elegido). Si hay más
   * de uno, la factura podría imputarse a otro: DUP-3 revisa que tampoco esté ya pagado.
   */
  candidates: Agreement[];
}

/** Inicio de vigencia (YYYY-MM-DD) o null si la ficha trae una fecha que no es YYYY-MM-DD válida. */
function startOf(agreement: Agreement): string | null {
  return calendarDate(agreement.validFrom);
}

/** Fin de vigencia, null si la ficha trae una fecha que no es YYYY-MM-DD válida, o "open" si no vence. */
function endOf(agreement: Agreement): string | null | "open" {
  return agreement.validTo == null ? "open" : calendarDate(agreement.validTo);
}

/**
 * Vigente si validFrom ≤ fecha ≤ validTo (validTo null = sin fin). Las fechas deben ser YYYY-MM-DD
 * válidas (el formato del contrato): comparar textos tal cual daría «2026-10-05» ≤ «2026-6-30». Una
 * fecha ilegible (o con hora) en la ficha o en la factura nunca hace vigente un acuerdo.
 */
export function isAgreementValidOn(agreement: Agreement, date: string): boolean {
  const day = calendarDate(date);
  const from = startOf(agreement);
  const to = endOf(agreement);
  if (day == null || from == null || to == null) return false;
  return from <= day && (to === "open" || day <= to);
}

/** Último día del mes "YYYY-MM" (el periodo ya validado). */
function lastDayOf(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return `${period}-${String(daysIn(y, m)).padStart(2, "0")}`;
}

/**
 * ¿El mes facturado se cruza con la vigencia del acuerdo? Basta con que algún día del mes esté
 * dentro: el mes no puede terminar antes de que empiece el acuerdo ni empezar después de que termine.
 */
export function agreementCoversPeriod(agreement: Agreement, period: string): boolean {
  const from = startOf(agreement);
  const to = endOf(agreement);
  if (periodOf(period) !== period || from == null || to == null) return false;
  const firstDay = `${period}-01`;
  const endsBeforeStart = lastDayOf(period) < from;
  const startsAfterEnd = to !== "open" && firstDay > to;
  return !endsBeforeStart && !startsAfterEnd;
}

/** Entre varios acuerdos, el de la moneda de la factura; si ninguno la tiene, el primero de la ficha. */
function preferCurrency(agreements: readonly Agreement[], currency: string | null): Agreement {
  return agreements.find((a) => normalizeCurrency(a.currency) === currency) ?? agreements[0];
}

/**
 * Elige el acuerdo vigente para la factura. Fecha de referencia: la de emisión o, si la factura no
 * la trae, el día de `now`. El acuerdo debe estar vigente esa fecha Y su vigencia debe cubrir el
 * mes facturado (servicePeriod, o el mes de la fecha de referencia). Con varios candidatos, prefiere
 * el de la moneda de la factura; si sigue el empate, el primero de la ficha.
 */
export function selectAgreement(vendor: Vendor, data: InvoiceData, now?: string | null): AgreementSelection {
  const base = { agreement: null, referenceDate: null, referenceSource: null, billedPeriod: null, closest: null, candidates: [] };
  if (vendor.agreements.length === 0) return { ...base, status: "no_agreements" };
  const ref = referenceDateOf(data, now);
  if (!ref.ok) return { ...base, status: ref.reason === "invalid_issue_date" ? "invalid_date" : "no_date" };
  const referenceDate = ref.date;
  const dated = { ...base, referenceDate, referenceSource: ref.source };

  const valid = vendor.agreements.filter((a) => isAgreementValidOn(a, referenceDate));
  if (valid.length === 0) {
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
    return { ...dated, status: "none_valid", closest: ended ?? upcoming };
  }

  const billed = billedPeriodOf(data, referenceDate);
  if (!billed.ok) return { ...dated, status: "invalid_period" };
  const currency = normalizeCurrency(data.currency);
  const covering = valid.filter((a) => agreementCoversPeriod(a, billed.period));
  if (covering.length === 0) {
    return { ...dated, status: "period_outside", billedPeriod: billed.period, closest: preferCurrency(valid, currency) };
  }
  return {
    ...dated,
    status: "selected",
    agreement: preferCurrency(covering, currency),
    billedPeriod: billed.period,
    candidates: covering,
  };
}

/** Texto de vigencia: "desde el 1 de enero de 2026, sin fecha de fin" o "del … al …". */
export function describeValidity(agreement: Agreement): string {
  if (agreement.validTo == null) return `desde el ${formatDate(agreement.validFrom)}, sin fecha de fin`;
  return `del ${formatDate(agreement.validFrom)} al ${formatDate(agreement.validTo)}`;
}

/**
 * Periodo al que se imputa el pago: mensual → servicePeriod (YYYY-MM) o, si la factura no lo trae,
 * el mes de la fecha de referencia (emisión, o el día de `now` si no hay emisión); pago único → null.
 * null también si el periodo que viene en la factura no es válido o si no hay fecha de referencia.
 */
export function agreementPeriodOf(agreement: Agreement, data: InvoiceData, now?: string | null): string | null {
  if (agreement.frequency === "once") return null;
  const ref = referenceDateOf(data, now);
  const billed = billedPeriodOf(data, ref.ok ? ref.date : null);
  return billed.ok ? billed.period : null;
}

// ───────────────────────── Monto en USD ─────────────────────────

export type UsdAmount =
  | { ok: true; currency: string; total: number; fxRate: number; amountUsdCents: number }
  | {
      ok: false;
      /** not_positive: el total no es positivo o, convertido a USD, da menos de un centavo. */
      reason: "no_data" | "no_total" | "no_currency" | "no_rate" | "not_positive";
      currency: string | null;
    };

/**
 * total × rules.fxToUsd[moneda], en centavos de USD (mitades hacia arriba). Un pago siempre es de
 * al menos un centavo de USD: si no, se registraría un pago que no cuenta para el límite ni el fondo.
 */
export function computeUsdAmount(data: InvoiceData | null, rules: Rules): UsdAmount {
  if (data == null) return { ok: false, reason: "no_data", currency: null };
  const currency = normalizeCurrency(data.currency);
  if (!isFiniteNumber(data.total)) return { ok: false, reason: "no_total", currency };
  if (currency == null) return { ok: false, reason: "no_currency", currency };
  const fx = Object.prototype.hasOwnProperty.call(rules.fxToUsd, currency) ? rules.fxToUsd[currency] : undefined;
  if (!isFiniteNumber(fx) || fx <= 0) return { ok: false, reason: "no_rate", currency };
  // Se convierten los centavos de la factura (no el total con decimales) y se limpia el ruido de
  // coma flotante antes de redondear: así el mismo total da siempre los mismos centavos de USD.
  const amountUsdCents = roundCents(toCents(data.total) * fx);
  if (amountUsdCents <= 0) return { ok: false, reason: "not_positive", currency };
  return { ok: true, currency, total: data.total, fxRate: fx, amountUsdCents };
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
  /**
   * Entradas del historial cuyo resultado no es PAGAR, FRENAR ni ESCALAR: podrían ser pagos, así que
   * duplicados, límite del mes y fondo no se dan por buenos mientras existan.
   */
  unknownOutcome: HistoryEntry[];
}

const KNOWN_OUTCOMES: readonly unknown[] = ["PAGAR", "FRENAR", "ESCALAR"];

export function buildFacts(input: EngineInput, ctx: DecisionContext): Facts {
  const data = input.reading.data;
  const match = data != null ? matchVendor(data, ctx.company.vendors) : null;
  const vendor = match?.vendor ?? null;
  const selection = data != null && vendor != null ? selectAgreement(vendor, data, ctx.now) : null;
  const agreement = selection?.agreement ?? null;
  const period = agreement != null && agreement.frequency !== "once" ? (selection?.billedPeriod ?? null) : null;
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
    unknownOutcome: ctx.history.filter((h) => !KNOWN_OUTCOMES.includes(h.outcome)),
  };
}
