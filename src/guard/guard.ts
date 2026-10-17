/**
 * Guardia de pagos: segunda implementación, independiente del motor, de las reglas duras.
 *
 * Revisa cada decisión PAGAR antes de registrarla. Solo aprueba si TODO se cumple; ante cualquier
 * duda (dato raro, historial incompleto, error inesperado) no aprueba. No importa nada de
 * `src/engine`, ni `src/core/normalize`, ni `src/core/checks`: solo tipos de `src/core/schemas`.
 * Función pura: no lee el reloj, no hace E/S y no modifica sus argumentos.
 */
import type {
  Agreement,
  CheckCode,
  Company,
  Decision,
  DecisionContext,
  EngineInput,
  Extraction,
  GuardResult,
  HistoryEntry,
  InvoiceData,
  ReadingAssessment,
  Vendor,
} from "../core/schemas";
import {
  convertCents,
  formatCents,
  formatQuantity,
  guardAccount,
  guardBankCodeConflict,
  guardBankNameConflict,
  guardCents,
  guardCurrency,
  guardDate,
  guardHash,
  guardInstantDays,
  guardInvoiceKey,
  guardNameKey,
  guardPeriod,
  guardStoredCents,
  guardTaxId,
  dayAfter,
  monthOfDay,
  roundHalfAwayFromZero,
  sameTaxId,
  withinTolerance,
  type TaxId,
} from "./normalize";

// ───────────────────────── Textos ─────────────────────────

/** Nombres en español de los campos que pueden aparecer en las señales de lectura. */
const FIELD_LABEL: Record<string, string> = {
  vendorName: "proveedor",
  vendorTaxId: "id tributario",
  invoiceNumber: "número de factura",
  issueDate: "fecha de emisión",
  dueDate: "fecha de vencimiento",
  servicePeriod: "periodo",
  periodo: "periodo",
  currency: "moneda",
  subtotal: "subtotal",
  tax: "impuestos",
  total: "total",
  accountNumber: "cuenta destino",
  segunda_lectura_no_disponible: "segunda lectura no disponible",
};

function label(field: string): string {
  return FIELD_LABEL[field] ?? field;
}

function labelList(fields: Iterable<string>): string {
  return Array.from(new Set(Array.from(fields, label))).join(", ");
}

/**
 * Un valor que viene de la factura (texto arbitrario de quien la envía), listo para una violación:
 * espacios compactados y recortado a `max` caracteres. Las violaciones se muestran en la pantalla.
 */
function shown(raw: unknown, max = 60): string {
  const text = String(raw).replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, max).trimEnd()}…`;
}

export const GUARD_MESSAGES = {
  notAPayment: "la decisión no es un pago",
  internalError: "la guardia no pudo revisar el pago (error interno)",
  incomplete: "la guardia no pudo verificar todas las reglas",
} as const;

// ───────────────────────── Tipos internos ─────────────────────────

const CRITICAL = ["vendorName", "invoiceNumber", "currency", "total", "accountNumber"] as const;
type Critical = (typeof CRITICAL)[number];

/** Factura ya validada y normalizada por la guardia. */
interface GuardInvoice {
  data: InvoiceData;
  vendorNameKey: string;
  taxId: TaxId | null;
  invoiceKey: string;
  currency: string;
  totalCents: number;
  account: string;
  /** Fecha con la que se mide la vigencia del acuerdo (emisión, o el día de `now` si no hay). */
  referenceDay: string | null;
  /** Periodo al que se imputa un acuerdo mensual (periodo de servicio, mes de emisión o mes de `now`). */
  period: string | null;
}

interface RulesCents {
  thresholdCents: number;
  periodLimitCents: number;
  initialFundCents: number;
  tolerancePct: number;
  fxToUsd: Record<string, number>;
}

/** Acumula violaciones sin repetir frases. */
class Violations {
  private readonly list: string[] = [];
  add(message: string): void {
    if (!this.list.includes(message)) this.list.push(message);
  }
  get size(): number {
    return this.list.length;
  }
  toArray(): string[] {
    return [...this.list];
  }
}

// ───────────────────────── API pública ─────────────────────────

/**
 * Revisa una decisión del motor. `approved` es true solo si la decisión es PAGAR y se cumplen
 * todas las reglas duras recalculadas aquí; si no, `violations` trae una frase por regla violada.
 */
export function guardPayment(input: EngineInput, ctx: DecisionContext, decision: Decision): GuardResult {
  try {
    if (decision?.outcome !== "PAGAR") return { approved: false, violations: [GUARD_MESSAGES.notAPayment] };
    const violations = evaluate(input, ctx, decision);
    return violations.length === 0 ? { approved: true, violations: [] } : { approved: false, violations };
  } catch {
    return { approved: false, violations: [GUARD_MESSAGES.internalError] };
  }
}

// ───────────────────────── Evaluación ─────────────────────────

function evaluate(input: EngineInput, ctx: DecisionContext, decision: Decision): string[] {
  const v = new Violations();
  /** true si alguna regla no se pudo evaluar por falta de datos (siempre debería haber ya una violación). */
  let skipped = false;

  checkDecisionChecks(decision, v);

  if (decision.invoiceId !== input.invoiceId) {
    v.add(`la decisión es de otra factura (${String(decision.invoiceId)}, se esperaba ${String(input.invoiceId)})`);
  }

  // Día de `now` tal como está escrito (vigencia y periodo si la factura no trae fecha) y, si trae
  // zona horaria y en UTC cae en otro día, también ese (para el límite del mes).
  const nowDays = guardInstantDays(ctx.now);
  const today = nowDays?.[0] ?? null;
  if (today === null) v.add(`la fecha actual del contexto no es válida (${String(ctx.now)})`);

  const rules = readRules(ctx.company, v);

  // G2 · lectura sólida
  const invoice = checkReading(input.reading, nowDays, v);

  // G3 · proveedor
  const vendor = invoice ? checkVendor(invoice, ctx.company.vendors, decision, v) : null;

  // G4 · cuenta destino
  if (invoice && vendor) checkAccount(invoice, vendor, input.reading, v);
  else skipped = true;

  // G5 · acuerdo vigente, moneda y monto
  const fitting = invoice && vendor && rules ? checkAgreement(invoice, vendor, rules, decision, v) : null;
  if (fitting === null) skipped = true;

  // G6 · umbral de aprobación (y monto en USD recalculado)
  let usdCents: number | null = null;
  if (invoice && rules) {
    usdCents = computeUsdCents(invoice, rules, v);
    if (usdCents !== null && usdCents > rules.thresholdCents) {
      v.add(
        `el monto (${formatCents(usdCents, "USD")}) supera el umbral de aprobación (${formatCents(rules.thresholdCents, "USD")})`,
      );
    }
  }
  if (usdCents === null) skipped = true;

  // G7 · límite del mes y G8 · fondo
  const paid = summarizePaid(ctx.history, nowDays, v);
  if (usdCents !== null && rules && paid !== null) {
    if (paid.monthCents !== null) {
      const monthTotal = paid.monthCents + usdCents;
      if (monthTotal > rules.periodLimitCents) {
        v.add(
          `con este pago el mes sumaría ${formatCents(monthTotal, "USD")}, por encima del límite mensual (${formatCents(rules.periodLimitCents, "USD")})`,
        );
      }
    } else skipped = true;
    const available = rules.initialFundCents - paid.allCents;
    if (available < usdCents) {
      v.add(
        `el fondo disponible (${formatCents(available, "USD")}) no alcanza para este pago (${formatCents(usdCents, "USD")})`,
      );
    }
  } else skipped = true;

  // G9 · duplicados
  checkDuplicates(input, ctx.history, invoice, vendor, fitting, v);

  // G10 · el monto en USD de la decisión coincide con el recalculado
  const decisionCents = guardCents(decision.amountUsd);
  if (decisionCents === null) {
    v.add("la decisión no trae un monto en USD válido");
  } else if (usdCents !== null && decisionCents !== usdCents) {
    v.add(
      `el monto en USD de la decisión (${formatCents(decisionCents, "USD")}) no coincide con el recalculado (${formatCents(usdCents, "USD")})`,
    );
  }

  if (skipped && v.size === 0) v.add(GUARD_MESSAGES.incomplete);
  return v.toArray();
}

// ───────────────────────── G1 · La decisión es un pago con todo en verde ─────────────────────────

/** Las 15 comprobaciones. Un Record obliga a TypeScript a exigir todos los códigos de CheckCode. */
const ALL_CHECK_CODES: Record<CheckCode, true> = {
  "LEC-1": true, "LEC-2": true, "LEC-3": true, "LEC-4": true,
  "DUP-1": true, "DUP-2": true, "DUP-3": true,
  "PRV-1": true, "PRV-2": true,
  "ACU-1": true, "ACU-2": true, "ACU-3": true,
  "LIM-1": true, "LIM-2": true, "FON-1": true,
};

/** Un PAGAR solo es coherente si trae las 15 comprobaciones y todas en «pass» (invariante 2). */
function checkDecisionChecks(decision: Decision, v: Violations): void {
  const checks = Array.isArray(decision.checks) ? decision.checks : [];
  const passed = new Set(checks.filter((c) => c?.status === "pass").map((c) => c.code));
  const notPassed = checks.filter((c) => c?.status !== "pass").map((c) => String(c?.code));
  const absent = (Object.keys(ALL_CHECK_CODES) as CheckCode[]).filter(
    (code) => !passed.has(code) && !notPassed.includes(code),
  );
  if (notPassed.length > 0) v.add(`la decisión de pagar trae comprobaciones sin aprobar: ${Array.from(new Set(notPassed)).join(", ")}`);
  if (absent.length > 0) v.add(`a la decisión de pagar le faltan comprobaciones: ${absent.join(", ")}`);
}

// ───────────────────────── Reglas de la empresa ─────────────────────────

function readRules(company: Company, v: Violations): RulesCents | null {
  const r = company?.rules;
  const thresholdCents = guardCents(r?.approvalThresholdUsd);
  const periodLimitCents = guardCents(r?.periodLimitUsd);
  const initialFundCents = guardCents(r?.initialFundUsd);
  const tolerancePct = r?.amountTolerancePct;
  const bad: string[] = [];
  if (thresholdCents === null || thresholdCents < 0) bad.push("umbral de aprobación");
  if (periodLimitCents === null || periodLimitCents < 0) bad.push("límite mensual");
  if (initialFundCents === null || initialFundCents < 0) bad.push("fondo inicial");
  // Más de 100 % deja de ser «lo pactado»: un acuerdo de 1.000 aceptaría cualquier factura de 0 a más de 2.000.
  if (typeof tolerancePct !== "number" || !Number.isFinite(tolerancePct) || tolerancePct < 0 || tolerancePct > 100) {
    bad.push("tolerancia");
  }
  if (r?.fxToUsd === null || typeof r?.fxToUsd !== "object") bad.push("tasas de cambio");
  if (bad.length > 0 || thresholdCents === null || periodLimitCents === null || initialFundCents === null) {
    v.add(`las reglas de la empresa no son válidas (${bad.join(", ")})`);
    return null;
  }
  return { thresholdCents, periodLimitCents, initialFundCents, tolerancePct: tolerancePct as number, fxToUsd: r.fxToUsd };
}

// ───────────────────────── G2 · Lectura ─────────────────────────

function nonEmpty(s: string | null | undefined): s is string {
  return typeof s === "string" && s.trim().length > 0;
}

/**
 * Un dato opcional cuenta como ausente solo si es null o texto en blanco. Un valor de otro tipo
 * (p. ej. un número donde se espera texto) NO es ausente: se valida y, al no tener la forma
 * esperada, produce una violación en vez de reemplazarse por un valor por defecto.
 */
function isAbsent(x: unknown): boolean {
  return x == null || (typeof x === "string" && x.trim().length === 0);
}

function asArray<T>(x: readonly T[] | null | undefined): readonly T[] | null {
  return Array.isArray(x) ? x : null;
}

/** Valor normalizado de un campo crítico, para comparar lecturas entre sí. */
function criticalKey(field: Critical, value: string | number | null): string | null {
  switch (field) {
    case "vendorName":
      return guardNameKey(typeof value === "string" ? value : null);
    case "invoiceNumber":
      return guardInvoiceKey(typeof value === "string" ? value : null);
    case "currency":
      return guardCurrency(typeof value === "string" ? value : null);
    case "total": {
      const c = guardCents(typeof value === "number" ? value : null);
      return c === null ? null : String(c);
    }
    case "accountNumber":
      return guardAccount(typeof value === "string" ? value : null);
  }
}

function extractionValue(e: Extraction, field: Critical): { value: string | number | null; legible: boolean } {
  const f = field === "accountNumber" ? e.payment?.accountNumber : e[field];
  return { value: (f?.value ?? null) as string | number | null, legible: f?.legible === true };
}

function dataValue(d: InvoiceData, field: Critical): string | number | null {
  return d[field] ?? null;
}

function checkReading(reading: ReadingAssessment, nowDays: string[] | null, v: Violations): GuardInvoice | null {
  const today = nowDays?.[0] ?? null;
  const data = reading?.data ?? null;
  const signals = reading?.signals;

  // Lectores
  const primary = reading?.primary?.ok === true ? reading.primary.extraction : null;
  const secondary = reading?.secondary?.ok === true ? reading.secondary.extraction : null;
  if (primary === null) v.add("la lectura principal falló");
  if (reading?.secondary == null) v.add("no hay segunda lectura de la factura");
  else if (secondary === null) v.add("la segunda lectura falló");
  if (data === null) v.add("no hay datos leídos de la factura");

  // Señales de la verificación (deben venir completas y vacías)
  const missing = new Set<string>();
  const illegible = new Set<string>();
  const disagree = new Set<string>();
  const dataMismatch = new Set<string>();
  let instructions = 0;

  if (signals == null) {
    v.add("faltan las señales de verificación de la lectura");
  } else {
    const missingSig = asArray(signals.missingCriticalFields);
    const illegibleSig = asArray(signals.illegibleCriticalFields);
    const disagreeSig = asArray(signals.readersDisagreeOn);
    const arithmetic = asArray(signals.arithmeticIssues);
    const suspicious = asArray(signals.suspiciousInstructions);
    const evidence = asArray(signals.evidenceNotFound);
    if (!missingSig || !illegibleSig || !disagreeSig || !arithmetic || !suspicious || !evidence) {
      v.add("las señales de verificación de la lectura están incompletas");
    }
    missingSig?.forEach((f) => missing.add(String(f)));
    illegibleSig?.forEach((f) => illegible.add(String(f)));
    disagreeSig?.forEach((f) => disagree.add(String(f)));
    instructions += suspicious?.length ?? 0;
    if (arithmetic && arithmetic.length > 0) {
      v.add(`las cuentas de la factura no cuadran (${arithmetic.length} ${arithmetic.length === 1 ? "problema" : "problemas"})`);
    }
    if (evidence && evidence.length > 0) {
      v.add(`hay citas de la lectura que no aparecen en el documento: ${labelList(evidence.map(String))}`);
    }
  }

  // Comprobaciones propias sobre las lecturas (no dependen de las señales)
  for (const e of [primary, secondary]) {
    if (e === null) continue;
    for (const field of CRITICAL) if (!extractionValue(e, field).legible) illegible.add(field);
    instructions += Array.isArray(e.embeddedInstructions) ? e.embeddedInstructions.length : 1;
  }
  if (primary !== null && secondary !== null) {
    for (const field of CRITICAL) {
      if (criticalKey(field, extractionValue(primary, field).value) !== criticalKey(field, extractionValue(secondary, field).value)) {
        disagree.add(field);
      }
    }
  }
  if (primary !== null && data !== null) {
    for (const field of CRITICAL) {
      if (criticalKey(field, extractionValue(primary, field).value) !== criticalKey(field, dataValue(data, field))) {
        dataMismatch.add(field);
      }
    }
  }

  // Campos críticos presentes y con forma válida
  let currency: string | null = null;
  let totalCents: number | null = null;
  let account: string | null = null;
  let vendorNameKey: string | null = null;
  let invoiceKey: string | null = null;
  if (data !== null) {
    if (!nonEmpty(data.vendorName)) missing.add("vendorName");
    else vendorNameKey = guardNameKey(data.vendorName);
    if (nonEmpty(data.vendorName) && vendorNameKey === null) v.add("el nombre del proveedor no es válido");

    if (!nonEmpty(data.invoiceNumber)) missing.add("invoiceNumber");
    else invoiceKey = guardInvoiceKey(data.invoiceNumber);
    if (nonEmpty(data.invoiceNumber) && invoiceKey === null) v.add("el número de factura no es válido");

    if (!nonEmpty(data.currency)) missing.add("currency");
    else {
      currency = guardCurrency(data.currency);
      if (currency === null) v.add(`la moneda «${shown(data.currency, 20)}» no es un código válido`);
    }

    if (typeof data.total !== "number" || !Number.isFinite(data.total)) missing.add("total");
    else {
      totalCents = guardCents(data.total);
      if (totalCents === null || totalCents <= 0) {
        v.add("el total no es un monto positivo");
        totalCents = null;
      }
    }

    if (!nonEmpty(data.accountNumber)) missing.add("accountNumber");
    else {
      account = guardAccount(data.accountNumber);
      if (account === null) v.add("la cuenta destino no tiene un formato válido");
    }
  }

  // Solo se pagan facturas y cuentas de cobro: un recibo es de algo ya pagado y cualquier otro
  // documento (o un tipo desconocido) no es un cobro. Cuenta lo que diga CUALQUIERA de las lecturas.
  const documentTypes: unknown[] = [];
  if (data !== null) documentTypes.push(data.documentType);
  for (const e of [primary, secondary]) if (e !== null) documentTypes.push(e.documentType);
  if (documentTypes.includes("receipt")) v.add("el documento es un recibo de algo ya pagado, no un cobro");
  else if (documentTypes.some((t) => t !== "invoice" && t !== "cuenta_de_cobro")) {
    v.add("el documento no parece una factura ni una cuenta de cobro");
  }

  if (missing.size > 0) v.add(`faltan datos críticos: ${labelList(missing)}`);
  if (illegible.size > 0) v.add(`hay datos críticos ilegibles: ${labelList(illegible)}`);
  if (disagree.size > 0) v.add(`las dos lecturas no coinciden en: ${labelList(disagree)}`);
  if (dataMismatch.size > 0) v.add(`los datos de la factura no coinciden con la lectura principal en: ${labelList(dataMismatch)}`);
  if (instructions > 0) v.add("el documento trae instrucciones sospechosas dirigidas a quien paga");

  if (data === null || currency === null || totalCents === null || account === null || vendorNameKey === null || invoiceKey === null) {
    return null;
  }

  // Fechas (decisión del equipo, igual que el motor): la de emisión define la vigencia; si la factura
  // no la trae, se usa el día de `now` tal como está escrito. Una fecha de emisión presente pero
  // inválida es una violación (no se reemplaza). El periodo pagado es el de servicio o, si no hay,
  // el mes de esa fecha de referencia.
  let issueDay: string | null = null;
  if (!isAbsent(data.issueDate)) {
    issueDay = guardDate(data.issueDate);
    if (issueDay === null) v.add(`la fecha de emisión no es válida (${shown(data.issueDate, 40)})`);
  }
  let servicePeriod: string | null = null;
  if (!isAbsent(data.servicePeriod)) {
    servicePeriod = guardPeriod(data.servicePeriod);
    if (servicePeriod === null) v.add(`el periodo de servicio no es válido (${shown(data.servicePeriod, 40)})`);
  }
  const referenceDay = issueDay ?? today;
  const period = servicePeriod ?? (referenceDay ? monthOfDay(referenceDay) : null);

  // Nada del futuro: ni una emisión posterior a hoy ni un mes que todavía no empieza (se pagaría un
  // servicio no prestado). Hoy = el día más tardío de `now` (escrito o UTC) más uno, por zona horaria.
  const latest = nowDays && nowDays.length > 0 ? dayAfter(nowDays.reduce((a, b) => (a > b ? a : b))) : null;
  if (latest !== null) {
    if (issueDay !== null && issueDay > latest) v.add(`la fecha de emisión (${issueDay}) es posterior a hoy`);
    if (period !== null && period > monthOfDay(latest)) v.add(`el periodo cobrado (${period}) todavía no empieza`);
  }

  return {
    data,
    vendorNameKey,
    taxId: isAbsent(data.vendorTaxId) ? null : guardTaxId(data.vendorTaxId),
    invoiceKey,
    currency,
    totalCents,
    account,
    referenceDay,
    period,
  };
}

// ───────────────────────── G3 · Proveedor ─────────────────────────

function vendorMatches(invoice: GuardInvoice, vendor: Vendor): boolean {
  const vendorTax = nonEmpty(vendor.taxId) ? guardTaxId(vendor.taxId) : null;
  // Si ambos tienen id tributario manda el id: si difieren, no es este proveedor.
  if (invoice.taxId !== null && vendorTax !== null) return sameTaxId(invoice.taxId, vendorTax);
  const names = [vendor.name, ...(Array.isArray(vendor.aliases) ? vendor.aliases : [])];
  return names.some((n) => guardNameKey(n) === invoice.vendorNameKey);
}

function checkVendor(invoice: GuardInvoice, vendors: readonly Vendor[], decision: Decision, v: Violations): Vendor | null {
  if (!isAbsent(invoice.data.vendorTaxId) && invoice.taxId === null) {
    v.add(`el id tributario de la factura no es válido (${shown(invoice.data.vendorTaxId, 40)})`);
  }
  const matches = vendors.filter((vendor) => vendorMatches(invoice, vendor));
  if (matches.length === 0) {
    v.add(`ningún proveedor registrado corresponde a «${shown(invoice.data.vendorName, 80)}»`);
    return null;
  }
  if (matches.length > 1) {
    v.add(`la factura corresponde a más de un proveedor registrado (${matches.map((m) => m.id).join(", ")})`);
    return null;
  }
  const vendor = matches[0];
  if (decision.vendorId !== vendor.id) {
    v.add(`la decisión indica el proveedor ${String(decision.vendorId)}, pero la factura es de ${vendor.id}`);
  }
  return vendor;
}

// ───────────────────────── G4 · Cuenta destino ─────────────────────────

function checkAccount(invoice: GuardInvoice, vendor: Vendor, reading: ReadingAssessment, v: Violations): void {
  const registered = guardAccount(vendor.account?.accountNumber);
  if (registered === null) {
    v.add(`la cuenta registrada de ${vendor.id} no tiene un formato válido`);
  } else if (registered !== invoice.account) {
    // Solo los últimos 4 caracteres: el texto de la violación se muestra en la pantalla.
    v.add(`la cuenta destino (terminada en ${invoice.account.slice(-4)}) no es la registrada del proveedor (terminada en ${registered.slice(-4)})`);
  }
  // El mismo número en otro banco es otra cuenta: banco y código SWIFT/de ruteo de los datos y de
  // las dos lecturas, contra los registrados.
  const stated: { bank: unknown; code: unknown }[] = [{ bank: invoice.data.bankName, code: invoice.data.routingOrSwift }];
  for (const r of [reading?.primary, reading?.secondary]) {
    if (r?.ok === true) stated.push({ bank: r.extraction.payment?.bankName?.value, code: r.extraction.payment?.routingOrSwift?.value });
  }
  const otherBank = stated.find(
    (x) => guardBankNameConflict(x.bank, vendor.account?.bankName) || guardBankCodeConflict(x.code, vendor.account?.routingOrSwift),
  );
  if (otherBank) {
    const what = [otherBank.bank, otherBank.code].filter((x) => typeof x === "string" && x.trim() !== "").map((x) => shown(x, 40));
    v.add(`la factura ubica la cuenta en otro banco (${what.join(", ")}), no en el registrado del proveedor`);
  }
}

// ───────────────────────── G5 · Acuerdo ─────────────────────────

function isActive(a: Agreement, day: string): boolean {
  const from = guardDate(a.validFrom);
  if (from === null || from > day) return false;
  if (a.validTo === null) return true;
  const to = guardDate(a.validTo);
  return to !== null && day <= to;
}

/** ¿El mes facturado (YYYY-MM) cae, al menos en parte, dentro de la vigencia del acuerdo? */
function coversPeriod(a: Agreement, period: string): boolean {
  const from = guardDate(a.validFrom);
  if (from === null || monthOfDay(from) > period) return false;
  if (a.validTo === null) return true;
  const to = guardDate(a.validTo);
  return to !== null && period <= monthOfDay(to);
}

/** Problemas de monto de una factura contra un acuerdo (vacío si cuadra). */
function amountProblems(a: Agreement, invoice: GuardInvoice, tolerancePct: number): string[] {
  const cur = invoice.currency;
  if (a.kind === "fixed_recurring" || a.kind === "one_off") {
    const agreed = guardCents(a.amount);
    if (agreed === null || agreed <= 0) return [`el acuerdo ${a.id} no tiene un monto pactado válido`];
    if (!withinTolerance(invoice.totalCents, agreed, tolerancePct)) {
      return [
        `el total ${formatCents(invoice.totalCents, cur)} no cuadra con lo pactado (${formatCents(agreed, cur)} ± ${formatQuantity(tolerancePct)} %)`,
      ];
    }
    return [];
  }
  if (a.kind === "hourly") {
    const rate = guardCents(a.rate);
    if (rate === null || rate <= 0) return [`el acuerdo ${a.id} no tiene una tarifa válida`];
    const lines = Array.isArray(invoice.data.lineItems) ? invoice.data.lineItems : [];
    if (lines.length === 0) return ["la factura por horas no detalla cantidad ni tarifa"];

    const problems: string[] = [];
    let quantity = 0;
    let linesOk = true;
    for (const line of lines) {
      const q = line.quantity;
      const unit = guardCents(line.unitPrice);
      if (typeof q !== "number" || !Number.isFinite(q) || q <= 0 || unit === null) {
        problems.push("hay líneas sin cantidad o sin tarifa");
        linesOk = false;
        continue;
      }
      quantity += q;
      if (unit !== rate) {
        problems.push(`la tarifa cobrada (${formatCents(unit, cur)}) no es la pactada (${formatCents(rate, cur)})`);
      }
      const lineCents = guardCents(line.amount);
      if (lineCents === null || Math.abs(lineCents - roundHalfAwayFromZero(q * unit)) > 1) {
        problems.push("una línea no cuadra: cantidad × tarifa no da su importe");
      }
    }
    if (!linesOk) return Array.from(new Set(problems));

    quantity = Number(quantity.toPrecision(12));
    // Sin máximo no se puede comprobar «cantidad ≤ máximo»: ante la duda, no se aprueba.
    if (a.maxQuantity == null) {
      problems.push(`el acuerdo ${a.id} no define un máximo de cantidad`);
    } else if (typeof a.maxQuantity !== "number" || !Number.isFinite(a.maxQuantity) || a.maxQuantity < 0) {
      problems.push(`el acuerdo ${a.id} tiene un máximo de cantidad no válido`);
    } else if (quantity > a.maxQuantity) {
      problems.push(`la cantidad (${formatQuantity(quantity)}) supera el máximo pactado (${formatQuantity(a.maxQuantity)})`);
    }
    const expected = roundHalfAwayFromZero(quantity * rate);
    if (!withinTolerance(invoice.totalCents, expected, tolerancePct)) {
      problems.push(
        `el total ${formatCents(invoice.totalCents, cur)} no cuadra con cantidad × tarifa (${formatQuantity(quantity)} × ${formatCents(rate, cur)} = ${formatCents(expected, cur)})`,
      );
    }
    return Array.from(new Set(problems));
  }
  return [`el acuerdo ${String((a as Agreement).id)} tiene un tipo desconocido`];
}

/**
 * Devuelve los acuerdos con los que la factura cuadra (vacío si ninguno), o null si no se pudo
 * evaluar por falta de fecha de referencia.
 */
function checkAgreement(
  invoice: GuardInvoice,
  vendor: Vendor,
  rules: RulesCents,
  decision: Decision,
  v: Violations,
): Agreement[] | null {
  if (invoice.referenceDay === null || invoice.period === null) return null;
  const agreements = Array.isArray(vendor.agreements) ? vendor.agreements : [];
  const active = agreements.filter((a) => isActive(a, invoice.referenceDay as string));
  if (active.length === 0) {
    v.add(`no hay acuerdo vigente con ${vendor.id} el ${invoice.referenceDay}`);
    return [];
  }
  // Vigente al emitir no basta: el periodo que se cobra también debe estar cubierto por el acuerdo
  // (si no, se pagaría un servicio de antes de empezar o de después de terminar el contrato).
  const covering = active.filter((a) => coversPeriod(a, invoice.period as string));
  if (covering.length === 0) {
    const validity = active.map((a) => `${a.id}: ${a.validFrom} a ${a.validTo ?? "sin vencimiento"}`).join("; ");
    v.add(`el periodo ${invoice.period} está fuera de la vigencia del acuerdo (${validity})`);
    return [];
  }
  const sameCurrency = covering.filter((a) => guardCurrency(a.currency) === invoice.currency);
  if (sameCurrency.length === 0) {
    const pacted = Array.from(new Set(covering.map((a) => String(a.currency)))).join(", ");
    v.add(`la factura viene en ${invoice.currency} y lo pactado es en ${pacted}`);
    return [];
  }
  const evaluated = sameCurrency.map((a) => ({ a, problems: amountProblems(a, invoice, rules.tolerancePct) }));
  const fitting = evaluated.filter((e) => e.problems.length === 0).map((e) => e.a);
  if (fitting.length === 0) {
    const prefix = evaluated.length > 1;
    for (const e of evaluated) for (const p of e.problems) v.add(prefix ? `acuerdo ${e.a.id}: ${p}` : p);
    return [];
  }

  // La decisión debe registrar el acuerdo y el periodo correctos: de eso dependen los duplicados futuros.
  const chosen = fitting.find((a) => a.id === decision.agreementId);
  if (!chosen) {
    v.add(
      decision.agreementId == null
        ? "la decisión no indica el acuerdo"
        : `la decisión indica el acuerdo ${decision.agreementId}, pero la factura cuadra con ${fitting.map((a) => a.id).join(", ")}`,
    );
  } else if (chosen.frequency === "monthly") {
    const decided = guardPeriod(decision.agreementPeriod);
    if (decided !== invoice.period) {
      v.add(
        decision.agreementPeriod == null
          ? "la decisión no indica el periodo del acuerdo"
          : `la decisión imputa el periodo ${decision.agreementPeriod}, pero la factura es del ${invoice.period}`,
      );
    }
  }
  // Para los duplicados cuentan también los acuerdos que ya no (o todavía no) están vigentes en la
  // fecha de emisión pero cubren el mes cobrado y con los que la factura cuadra: un acuerdo renovado
  // a mitad de mes no paga otra vez el mes que ya se pagó con el anterior.
  const period = invoice.period;
  const alsoFitting = agreements.filter(
    (a) =>
      !fitting.includes(a) &&
      coversPeriod(a, period) &&
      guardCurrency(a.currency) === invoice.currency &&
      amountProblems(a, invoice, rules.tolerancePct).length === 0,
  );
  return [...fitting, ...alsoFitting];
}

// ───────────────────────── G6 · Monto en USD ─────────────────────────

function computeUsdCents(invoice: GuardInvoice, rules: RulesCents, v: Violations): number | null {
  const fx = Object.prototype.hasOwnProperty.call(rules.fxToUsd, invoice.currency)
    ? rules.fxToUsd[invoice.currency]
    : undefined;
  if (typeof fx !== "number" || !Number.isFinite(fx) || fx <= 0) {
    v.add(`la moneda ${invoice.currency} no tiene tasa de cambio registrada`);
    return null;
  }
  const usd = convertCents(invoice.totalCents, fx);
  if (usd === null || usd <= 0) {
    v.add("no se pudo calcular el monto en USD");
    return null;
  }
  return usd;
}

// ───────────────────────── G7 / G8 · Lo pagado ─────────────────────────

interface Paid {
  /** Todo lo pagado (PAGAR) desde el inicio. */
  allCents: number;
  /** Lo pagado en el mes de `now` (el mayor si `now` puede leerse en dos meses); null si no se pudo calcular. */
  monthCents: number | null;
}

const OUTCOMES: readonly unknown[] = ["PAGAR", "FRENAR", "ESCALAR"];

/** Una entrada del historial con forma de objeto (el resto de campos se valida donde se usa). */
function isEntry(h: unknown): h is HistoryEntry {
  return h !== null && typeof h === "object";
}

/**
 * Suma lo pagado. Una entrada que no se entiende (no es un objeto o su resultado no es PAGAR,
 * FRENAR ni ESCALAR) podría ser un pago: no se salta, se bloquea. Un pago cuenta para el mes de
 * `now` si cae en él según el día escrito o según UTC, en cualquiera de las lecturas de `now`.
 */
function summarizePaid(history: readonly HistoryEntry[], nowDays: string[] | null, v: Violations): Paid | null {
  if (!Array.isArray(history)) {
    v.add("el historial de decisiones no es válido");
    return null;
  }
  const months = nowDays ? Array.from(new Set(nowDays.map(monthOfDay))) : [];
  const perMonth = new Map<string, number>(months.map((m) => [m, 0]));
  let allCents = 0;
  let ok = true;
  let monthOk = months.length > 0;
  for (const h of history as readonly unknown[]) {
    if (!isEntry(h)) {
      v.add("el historial tiene una entrada que no es válida");
      ok = false;
      continue;
    }
    if (!OUTCOMES.includes(h.outcome)) {
      v.add("el historial tiene una decisión con un resultado desconocido");
      ok = false;
      continue;
    }
    if (h.outcome !== "PAGAR") continue;
    const cents = guardStoredCents(h.amountUsd);
    if (cents === null || cents < 0) {
      v.add("el historial tiene un pago sin monto válido: no se puede calcular lo pagado");
      ok = false;
      continue;
    }
    allCents += cents;
    const days = guardInstantDays(h.decidedAt);
    if (days === null) {
      v.add("el historial tiene un pago sin fecha válida: no se puede calcular lo pagado en el mes");
      monthOk = false;
      continue;
    }
    const entryMonths = days.map(monthOfDay);
    for (const m of months) if (entryMonths.includes(m)) perMonth.set(m, (perMonth.get(m) ?? 0) + cents);
  }
  if (!ok) return null;
  return { allCents, monthCents: monthOk ? Math.max(...perMonth.values()) : null };
}

// ───────────────────────── G9 · Duplicados ─────────────────────────

function checkDuplicates(
  input: EngineInput,
  history: readonly HistoryEntry[],
  invoice: GuardInvoice | null,
  vendor: Vendor | null,
  fitting: Agreement[] | null,
  v: Violations,
): void {
  if (!Array.isArray(history)) return; // ya reportado
  const entries = (history as readonly unknown[]).filter(isEntry); // las demás ya se reportaron
  const hash = guardHash(input.fileHash);
  if (hash === null) v.add("la factura no tiene huella de archivo");

  const sameFile = hash === null ? undefined : entries.find((h) => guardHash(h.fileHash) === hash);
  if (sameFile) v.add(`este mismo archivo ya se procesó antes (factura ${sameFile.invoiceId})`);
  if (entries.some((h) => guardHash(h.fileHash) === null)) {
    v.add("el historial tiene una decisión sin huella de archivo: no se puede descartar que sea este mismo archivo");
  }

  if (!invoice || !vendor) return;
  const paid = entries.filter((h) => h.outcome === "PAGAR");
  // Un pago sin proveedor o sin acuerdo podría ser de este proveedor o de este acuerdo.
  if (paid.some((h) => !nonEmpty(h.vendorId))) {
    v.add("el historial tiene un pago sin proveedor: no se puede descartar una factura repetida");
  }
  if (paid.some((h) => !nonEmpty(h.agreementId))) {
    v.add("el historial tiene un pago sin acuerdo: no se puede descartar un periodo ya pagado");
  }
  const paidSameVendor = paid.filter((h) => h.vendorId === vendor.id);
  for (const h of paidSameVendor) {
    if (h.invoiceNumber == null || guardInvoiceKey(h.invoiceNumber) === null) {
      v.add("el historial tiene un pago de este proveedor sin número de factura");
    } else if (guardInvoiceKey(h.invoiceNumber) === invoice.invoiceKey) {
      v.add(`ya se pagó una factura de este proveedor con el número ${shown(invoice.data.invoiceNumber, 40)}`);
    }
  }

  if (!fitting || fitting.length === 0) return;
  for (const a of fitting) {
    const paidSameAgreement = paid.filter((h) => h.agreementId === a.id);
    if (paidSameAgreement.length === 0) continue;
    if (a.frequency === "once") {
      v.add(`el acuerdo único ${a.id} ya se pagó`);
      continue;
    }
    for (const h of paidSameAgreement) {
      const p = guardPeriod(h.agreementPeriod);
      if (p === null) v.add(`el historial tiene un pago del acuerdo ${a.id} sin periodo válido`);
      else if (p === invoice.period) v.add(`el periodo ${p} del acuerdo ${a.id} ya se pagó`);
    }
  }
}
