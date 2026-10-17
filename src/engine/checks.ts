/**
 * Las 15 comprobaciones del catálogo. Cada evaluador es puro: recibe los hechos derivados,
 * la entrada y el contexto, y devuelve estado, explicación con valores concretos, parámetros
 * usados y (si no pasa) la instrucción para la persona que revise.
 */
import { OUTCOME_LABEL } from "../core/checks";
import { normalizeAccount, toCents, monthOf } from "../core/normalize";
import {
  CRITICAL_FIELDS,
  type CheckCode,
  type CheckResult,
  type DecisionContext,
  type EngineInput,
  type HistoryEntry,
  type ReaderResult,
} from "../core/schemas";
import {
  describeValidity,
  isFiniteNumber,
  isoDateOf,
  normalizeCurrency,
  normalizeFileHash,
  normalizeInvoiceNumber,
  periodOf,
  type Facts,
  type UsdAmount,
} from "./facts";
import {
  fieldLabel,
  formatDate,
  formatNumber,
  formatPct,
  formatPeriod,
  formatUsdCents,
  lastDigits,
  listEs,
  money,
  stripFinalPeriod,
  truncate,
  unique,
} from "./text";

export interface Evaluation {
  status: CheckResult["status"];
  explanation: string;
  params: CheckResult["params"];
  /** Qué debe hacer una persona si la comprobación no pasa (null si pasa). */
  action: string | null;
  /**
   * true si no se pudo evaluar solo porque otra comprobación anterior ya falló o quedó sin
   * datos (sin lectura → LEC-1, sin proveedor → PRV-1, sin acuerdo → ACU-1, otra moneda → ACU-2).
   * El resumen y la acción humana se centran en la causa, no en sus consecuencias.
   */
  derived: boolean;
}

export type Evaluator = (facts: Facts, input: EngineInput, ctx: DecisionContext) => Evaluation;

const pass = (explanation: string, params: CheckResult["params"] = {}): Evaluation => ({
  status: "pass",
  explanation,
  params,
  action: null,
  derived: false,
});
const fail = (explanation: string, action: string, params: CheckResult["params"] = {}): Evaluation => ({
  status: "fail",
  explanation,
  params,
  action,
  derived: false,
});
const notEvaluable = (explanation: string, action: string, params: CheckResult["params"] = {}): Evaluation => ({
  status: "not_evaluable",
  explanation,
  params,
  action,
  derived: false,
});
/** Sin evaluar por culpa de otra comprobación que ya no pasó (ver Evaluation.derived). */
const derived = (explanation: string, params: CheckResult["params"] = {}): Evaluation => ({
  status: "not_evaluable",
  explanation,
  params,
  action: null,
  derived: true,
});

const NO_DATA = "No se pudo leer la factura, así que no hay datos para esta comprobación.";
const ACTION_NO_DATA = "Abrir el documento original: no se pudo leer. Si no es legible, pedir al proveedor una copia clara.";
const NO_VENDOR = "Sin un proveedor registrado identificado no hay con qué comparar.";
const ACTION_NO_VENDOR = "Verificar al proveedor y, si corresponde, registrarlo con su acuerdo antes de pagar.";
const NO_AGREEMENT = "Sin un acuerdo vigente identificado no hay con qué comparar.";

function shortDate(iso: string): string {
  return formatDate(iso.slice(0, 10));
}

function isBlank(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === "string") return v.trim().length === 0;
  if (typeof v === "number") return !Number.isFinite(v);
  return false;
}

function describeReaderFailure(primary: ReaderResult): string {
  if (primary.ok) return "la lectura no produjo datos utilizables";
  switch (primary.error) {
    case "refusal":
      return "el lector se negó a procesar el documento";
    case "api_error":
      return "falló la conexión con el lector";
    case "parse_error":
      return "la respuesta del lector no tenía el formato esperado";
    case "unavailable":
      return "el lector no estaba disponible";
  }
}

/** "COP 12.000.000,00 ≈ USD 3.000,00" o "USD 1.200,00". */
function amountLabel(usd: Extract<UsdAmount, { ok: true }>): string {
  const usdText = formatUsdCents(usd.amountUsdCents);
  return usd.currency === "USD" ? usdText : `${money(usd.total, usd.currency)} ≈ ${usdText}`;
}

function usdNotEvaluable(usd: Extract<UsdAmount, { ok: false }>): Evaluation {
  switch (usd.reason) {
    case "no_data":
      return derived(NO_DATA, { reason: usd.reason });
    case "no_total":
      return notEvaluable(
        "La factura no trae un total válido; no se puede calcular el monto en USD.",
        "Completar el total de la factura para calcular el monto en USD.",
        { reason: usd.reason, currency: usd.currency },
      );
    case "no_currency":
      return notEvaluable(
        "La factura no indica la moneda; no se puede convertir el monto a USD.",
        "Completar la moneda de la factura para calcular el monto en USD.",
        { reason: usd.reason },
      );
    case "no_rate":
      return notEvaluable(
        `No hay tasa de cambio registrada para ${usd.currency}; no se puede convertir el monto a USD.`,
        `Convertir el monto a USD a mano: no hay tasa de cambio registrada para ${usd.currency}.`,
        { reason: usd.reason, currency: usd.currency },
      );
  }
}

/**
 * Suma en centavos de amountUsd; `missing` cuenta entradas sin monto válido. Un monto negativo
 * no es válido: un pago nunca devuelve fondo ni libera límite.
 */
function sumUsdCents(entries: readonly HistoryEntry[]): { cents: number; missing: number } {
  let cents = 0;
  let missing = 0;
  for (const e of entries) {
    if (isFiniteNumber(e.amountUsd) && e.amountUsd >= 0) cents += toCents(e.amountUsd);
    else missing += 1;
  }
  return { cents, missing };
}

type NumericRule = "approvalThresholdUsd" | "periodLimitUsd" | "initialFundUsd" | "amountTolerancePct";

const RULE_LABELS: Record<NumericRule, string> = {
  approvalThresholdUsd: "umbral de aprobación",
  periodLimitUsd: "límite mensual",
  initialFundUsd: "fondo inicial",
  amountTolerancePct: "tolerancia del monto",
};

/**
 * Valor de una regla numérica, o una evaluación sin datos si no es un número finito. Un NaN o un
 * undefined (p. ej. al mezclar reglas) haría que «monto > umbral» diera false y se pagara sin límite.
 */
function ruleValue(ctx: DecisionContext, rule: NumericRule): { ok: true; value: number } | { ok: false; result: Evaluation } {
  const value: unknown = ctx.company.rules[rule];
  if (isFiniteNumber(value)) return { ok: true, value };
  const label = RULE_LABELS[rule];
  return {
    ok: false,
    result: notEvaluable(
      `La regla «${label}» no tiene un valor numérico válido en la configuración de la empresa; no se puede evaluar esta comprobación.`,
      `Revisar la configuración de reglas de la empresa: «${label}» no tiene un valor válido.`,
      { rule, ruleValue: String(value) },
    ),
  };
}

// ───────────────────────── Lectura ─────────────────────────

const lec1: Evaluator = (f, input) => {
  const s = input.reading.signals;
  if (f.data == null) {
    const primary = input.reading.primary;
    return fail(
      `No se pudo leer la factura: ${describeReaderFailure(primary)}.`,
      ACTION_NO_DATA,
      { dataAvailable: false, readerError: primary.ok ? null : primary.error },
    );
  }
  const data = f.data;
  const nullCritical = CRITICAL_FIELDS.filter((k) => isBlank(data[k]));
  const missing = unique([...s.missingCriticalFields, ...nullCritical].map(fieldLabel));
  const illegible = unique(s.illegibleCriticalFields.map(fieldLabel));
  const notFound = unique(s.evidenceNotFound.map(fieldLabel));

  if (missing.length === 0 && illegible.length === 0 && notFound.length === 0) {
    return pass(
      `Están completos y legibles los datos críticos: ${listEs(CRITICAL_FIELDS.map(fieldLabel))}.`,
      { dataAvailable: true, missing: null, illegible: null, evidenceNotFound: null },
    );
  }
  const parts: string[] = [];
  if (missing.length > 0) parts.push(`Faltan datos críticos: ${listEs(missing)}`);
  if (illegible.length > 0) parts.push(`No se leen con claridad: ${listEs(illegible)}`);
  if (notFound.length > 0) {
    parts.push(
      notFound.length === 1
        ? `Dato no respaldado por el texto del documento: ${notFound[0]}`
        : `Datos no respaldados por el texto del documento: ${listEs(notFound)}`,
    );
  }
  const all = unique([...missing, ...illegible, ...notFound]);
  return fail(
    `${parts.join(". ")}.`,
    `Revisar el documento original y completar o corregir a mano: ${listEs(all)}.`,
    {
      dataAvailable: true,
      missing: missing.join(", ") || null,
      illegible: illegible.join(", ") || null,
      evidenceNotFound: notFound.join(", ") || null,
    },
  );
};

const NO_SECOND_READING = "segunda_lectura_no_disponible";

const lec2: Evaluator = (f, input) => {
  const d = input.reading.signals.readersDisagreeOn;
  const secondary = input.reading.secondary;
  // La señal la produce otro módulo: si dice «coinciden» pero no hubo segunda lectura, no se cree.
  const noSecond = d.includes(NO_SECOND_READING) || (f.data != null && (secondary == null || !secondary.ok));
  if (d.length > 0 || noSecond) {
    const fields = unique(d.filter((x) => x !== NO_SECOND_READING).map(fieldLabel));
    const parts: string[] = [];
    if (fields.length > 0) parts.push(`Las dos lecturas no coinciden en: ${listEs(fields)}`);
    if (noSecond) parts.push("No hubo una segunda lectura para confirmar los datos críticos");
    const action =
      fields.length > 0
        ? `Comparar con el documento original ${listEs(fields)} y confirmar el valor correcto.`
        : "Revisar a mano los datos críticos: no hubo una segunda lectura que los confirmara.";
    return fail(`${parts.join(". ")}.`, action, {
      disagreeOn: fields.join(", ") || null,
      secondReadingAvailable: !noSecond,
    });
  }
  if (f.data == null) {
    return derived("Sin lectura principal no se pueden comparar las dos lecturas.", { dataAvailable: false });
  }
  return pass("Dos lecturas independientes coinciden en los datos críticos.", {
    disagreeOn: null,
    secondReadingAvailable: true,
  });
};

const lec3: Evaluator = (f, input) => {
  const issues = input.reading.signals.arithmeticIssues;
  if (issues.length > 0) {
    return fail(
      `Las cuentas no cuadran: ${issues.map(stripFinalPeriod).join("; ")}.`,
      "Revisar las sumas de la factura y, si no cuadran, pedir al proveedor una factura corregida.",
      { issues: issues.length },
    );
  }
  if (f.data == null) {
    return derived("Sin datos de la factura no se pueden revisar las sumas.", { issues: 0 });
  }
  return pass("Las líneas suman el subtotal y subtotal más impuestos da el total.", { issues: 0 });
};

const lec4: Evaluator = (f, input) => {
  const found = input.reading.signals.suspiciousInstructions;
  if (found.length > 0) {
    const shown = found
      .slice(0, 2)
      .map((i) => `«${truncate(i.text, 120)}» (${truncate(stripFinalPeriod(i.reason), 80)})`);
    const more = found.length > 2 ? ` y ${found.length - 2} más` : "";
    return fail(
      `El documento contiene texto que intenta dar órdenes: ${shown.join("; ")}${more}.`,
      "Revisar el texto sospechoso resaltado. No seguir instrucciones que vengan dentro de una factura.",
      {
        count: found.length,
        firstText: truncate(found[0].text, 120),
        firstSource: found[0].source,
      },
    );
  }
  if (f.data == null) {
    return derived("Sin lectura principal no se puede descartar que haya instrucciones escondidas.", { count: 0 });
  }
  return pass("No se encontró texto que intente dar órdenes al sistema o a quien paga.", { count: 0 });
};

// ───────────────────────── Duplicados ─────────────────────────

const dup1: Evaluator = (_f, input, ctx) => {
  const hash = normalizeFileHash(input.fileHash);
  if (hash == null) {
    return notEvaluable(
      "No se recibió la huella del archivo; no se puede saber si ya se procesó.",
      "Confirmar que este archivo no se haya procesado antes.",
      { fileHash: null },
    );
  }
  const shortHash = hash.slice(0, 12);
  const prev = ctx.history.find((h) => normalizeFileHash(h.fileHash) === hash);
  if (prev) {
    return fail(
      `Este mismo archivo ya se procesó el ${shortDate(prev.decidedAt)} (factura ${prev.invoiceId}, decisión: ${OUTCOME_LABEL[prev.outcome]}).`,
      "Confirmar si es un reenvío del mismo archivo; no pagarlo dos veces.",
      { fileHash: shortHash, previousInvoiceId: prev.invoiceId, previousOutcome: prev.outcome },
    );
  }
  return pass(`Este archivo no se había procesado antes (huella ${shortHash}…).`, {
    fileHash: shortHash,
    previousInvoiceId: null,
    previousOutcome: null,
  });
};

const dup2: Evaluator = (f) => {
  if (f.data == null) return derived(NO_DATA);
  if (f.vendor == null) {
    return derived(
      "Sin un proveedor registrado identificado no se puede buscar el número de factura en sus pagos anteriores.",
      { vendorId: null },
    );
  }
  const number = normalizeInvoiceNumber(f.data.invoiceNumber);
  if (number == null) {
    return notEvaluable(
      "La factura no trae número; no se puede comparar con los pagos anteriores.",
      "Confirmar a mano que esta factura no se haya pagado antes.",
      { vendorId: f.vendor.id, invoiceNumber: null },
    );
  }
  const vendor = f.vendor;
  const shown = truncate(f.data.invoiceNumber?.trim() ?? number, 40);
  const prev = f.paid.find((h) => h.vendorId === vendor.id && normalizeInvoiceNumber(h.invoiceNumber) === number);
  if (prev) {
    return fail(
      `Ya se pagó una factura de ${vendor.name} con el número ${shown} (factura ${prev.invoiceId}, ${shortDate(prev.decidedAt)}).`,
      "Confirmar con el proveedor si es una factura repetida; no pagarla dos veces.",
      { vendorId: vendor.id, invoiceNumber: number, previousInvoiceId: prev.invoiceId },
    );
  }
  return pass(`No hay otra factura pagada de ${vendor.name} con el número ${shown}.`, {
    vendorId: vendor.id,
    invoiceNumber: number,
    previousInvoiceId: null,
  });
};

const dup3: Evaluator = (f) => {
  if (f.data == null) return derived(NO_DATA);
  if (f.vendor == null) {
    return derived("Sin un proveedor registrado identificado no hay acuerdo ni periodo que revisar.", {
      agreementId: null,
    });
  }
  const agreement = f.agreement;
  if (agreement == null) {
    return derived("Sin un acuerdo vigente identificado no se puede saber qué periodo se está cobrando.", {
      agreementId: null,
    });
  }
  if (agreement.frequency === "once") {
    const prev = f.paid.find((h) => h.agreementId === agreement.id);
    if (prev) {
      return fail(
        `El acuerdo de pago único «${agreement.description}» ya se pagó (factura ${prev.invoiceId}, ${shortDate(prev.decidedAt)}).`,
        "Confirmar con el proveedor: este acuerdo era de un solo pago y ya se pagó.",
        { agreementId: agreement.id, frequency: "once", period: null, previousInvoiceId: prev.invoiceId },
      );
    }
    return pass(`El acuerdo de pago único «${agreement.description}» no se ha pagado todavía.`, {
      agreementId: agreement.id,
      frequency: "once",
      period: null,
      previousInvoiceId: null,
    });
  }
  const period = f.period;
  if (period == null) {
    return notEvaluable(
      "No se pudo determinar el periodo facturado: la factura no trae periodo ni fecha de emisión.",
      "Confirmar qué mes se está cobrando y que no se haya pagado ya.",
      { agreementId: agreement.id, frequency: "monthly", period: null },
    );
  }
  const prev = f.paid.find((h) => h.agreementId === agreement.id && periodOf(h.agreementPeriod) === period);
  if (prev) {
    return fail(
      `El periodo ${formatPeriod(period)} del acuerdo «${agreement.description}» ya se pagó (factura ${prev.invoiceId}).`,
      "Confirmar con el proveedor: ese mes ya se pagó.",
      { agreementId: agreement.id, frequency: "monthly", period, previousInvoiceId: prev.invoiceId },
    );
  }
  return pass(`El periodo ${formatPeriod(period)} del acuerdo «${agreement.description}» no se ha pagado.`, {
    agreementId: agreement.id,
    frequency: "monthly",
    period,
    previousInvoiceId: null,
  });
};

// ───────────────────────── Proveedor ─────────────────────────

const prv1: Evaluator = (f) => {
  if (f.data == null || f.match == null) {
    return derived("Sin datos de la factura no se puede identificar al proveedor.", { basis: null });
  }
  const m = f.match;
  const params = { basis: m.basis, vendorId: m.vendor?.id ?? null, invoiceVendorName: f.data.vendorName };
  switch (m.basis) {
    case "tax_id":
    case "name":
      return pass(m.reason, params);
    case "no_identity":
      return notEvaluable(
        m.reason,
        "Identificar en el documento original quién cobra y confirmar que esté registrado.",
        params,
      );
    case "ambiguous":
      return fail(m.reason, "Elegir a mano a qué proveedor registrado corresponde la factura.", params);
    case "tax_id_conflict":
      return fail(
        m.reason,
        "Verificar la identificación tributaria con el proveedor por un canal conocido; no coincide con la registrada.",
        params,
      );
    case "none":
      return fail(m.reason, ACTION_NO_VENDOR, params);
  }
};

const prv2: Evaluator = (f) => {
  if (f.data == null) return derived(NO_DATA);
  const vendor = f.vendor;
  if (vendor == null) {
    return derived("Sin un proveedor registrado identificado no hay cuenta registrada con qué comparar.", {
      vendorId: null,
    });
  }
  const invoiceAccount = normalizeAccount(f.data.accountNumber);
  if (invoiceAccount == null) {
    return notEvaluable(
      "La factura no trae cuenta destino; no se puede comparar con la registrada.",
      "Confirmar la cuenta destino con el proveedor por un canal conocido, no por el que llegó la factura.",
      { vendorId: vendor.id, invoiceAccountLast4: null },
    );
  }
  const registered = normalizeAccount(vendor.account.accountNumber);
  if (registered == null) {
    return notEvaluable(
      `${vendor.name} no tiene cuenta registrada en la ficha.`,
      "Registrar la cuenta del proveedor en la ficha, confirmada por un canal conocido.",
      { vendorId: vendor.id, registeredAccountLast4: null },
    );
  }
  const a = lastDigits(invoiceAccount);
  const b = lastDigits(registered);
  const params = { vendorId: vendor.id, invoiceAccountLast4: a, registeredAccountLast4: b };
  if (invoiceAccount === registered) {
    return pass(`La cuenta destino (terminada en ${a}) es la registrada para ${vendor.name}.`, {
      ...params,
      match: true,
    });
  }
  const sameEnding = a === b ? "; terminan igual pero son cuentas distintas" : "";
  return fail(
    `La cuenta a la que se pide pagar (terminada en ${a}) no es la registrada para ${vendor.name} (terminada en ${b})${sameEnding}.`,
    "Confirmar el cambio de cuenta con el proveedor por un canal conocido, no por el que llegó la factura.",
    { ...params, match: false },
  );
};

// ───────────────────────── Acuerdo ─────────────────────────

const acu1: Evaluator = (f) => {
  if (f.data == null) return derived(NO_DATA);
  const vendor = f.vendor;
  const sel = f.selection;
  if (vendor == null || sel == null) {
    return derived("Sin un proveedor registrado identificado no hay acuerdo que revisar.", { agreementId: null });
  }
  switch (sel.status) {
    case "no_agreements":
      return fail(
        `${vendor.name} no tiene acuerdos registrados.`,
        "Confirmar el acuerdo con el proveedor y registrarlo en la ficha antes de pagar.",
        { vendorId: vendor.id, agreementId: null, referenceDate: sel.referenceDate },
      );
    case "no_date":
      return notEvaluable(
        "La factura no trae una fecha de emisión válida; no se puede saber qué acuerdo estaba vigente.",
        "Confirmar la fecha de emisión de la factura para revisar la vigencia del acuerdo.",
        { vendorId: vendor.id, agreementId: null, referenceDate: null },
      );
    case "none_valid": {
      const ref = sel.referenceDate ?? "";
      const c = sel.closest;
      let detail = "";
      if (c != null) {
        const closestEnd = isoDateOf(c.validTo);
        detail =
          closestEnd != null && closestEnd < ref
            ? `: «${c.description}» estuvo vigente ${describeValidity(c)}`
            : `: «${c.description}» empieza el ${formatDate(c.validFrom)}`;
      }
      return fail(
        `${vendor.name} no tiene un acuerdo vigente el ${formatDate(ref)}${detail}.`,
        "Confirmar si hay un acuerdo vigente con el proveedor; si se renovó, actualizar la ficha antes de pagar.",
        {
          vendorId: vendor.id,
          agreementId: null,
          referenceDate: ref,
          closestAgreementId: c?.id ?? null,
          closestValidFrom: c?.validFrom ?? null,
          closestValidTo: c?.validTo ?? null,
        },
      );
    }
    case "selected": {
      const a = sel.agreement;
      if (a == null) return derived(NO_AGREEMENT);
      return pass(
        `Acuerdo vigente el ${formatDate(sel.referenceDate ?? "")}: «${a.description}» (${describeValidity(a)}).`,
        {
          vendorId: vendor.id,
          agreementId: a.id,
          referenceDate: sel.referenceDate,
          validFrom: a.validFrom,
          validTo: a.validTo,
        },
      );
    }
  }
};

const acu2: Evaluator = (f) => {
  if (f.data == null) return derived(NO_DATA);
  if (f.vendor == null) return derived(NO_VENDOR, { agreementId: null });
  const a = f.agreement;
  if (a == null) {
    return derived("Sin un acuerdo vigente identificado no hay moneda pactada con qué comparar.", { agreementId: null });
  }
  const cur = f.currency;
  const agreed = normalizeCurrency(a.currency) ?? a.currency;
  if (cur == null) {
    return notEvaluable(
      "La factura no indica la moneda; no se puede comparar con la pactada.",
      "Completar la moneda de la factura.",
      { agreementId: a.id, invoiceCurrency: null, agreementCurrency: agreed },
    );
  }
  const params = { agreementId: a.id, invoiceCurrency: cur, agreementCurrency: agreed };
  if (cur === agreed) return pass(`La factura está en ${cur}, la moneda pactada.`, params);
  return fail(
    `La factura está en ${cur} pero el acuerdo «${a.description}» es en ${agreed}.`,
    `Aclarar con el proveedor la moneda: el acuerdo es en ${agreed} y la factura en ${cur}.`,
    params,
  );
};

/** Tolerancia en centavos: floor(pactado × pct / 100), con margen para errores de coma flotante. */
function toleranceCents(expectedCents: number, pct: number): number {
  return Math.max(0, Math.floor((expectedCents * pct) / 100 + 1e-6));
}

const ACTION_AMOUNT =
  "Comparar el monto con lo pactado y pedir al proveedor una factura corregida o aprobar la diferencia.";

const acu3: Evaluator = (f, _input, ctx) => {
  if (f.data == null) return derived(NO_DATA);
  if (f.vendor == null) return derived(NO_VENDOR, { agreementId: null });
  const a = f.agreement;
  if (a == null) return derived(NO_AGREEMENT, { agreementId: null });
  const data = f.data;
  const cur = f.currency;
  const total = data.total;
  if (cur == null || !isFiniteNumber(total)) {
    return notEvaluable(
      "Sin moneda o sin total no se puede comparar con lo pactado.",
      "Completar el total y la moneda de la factura.",
      { agreementId: a.id, kind: a.kind },
    );
  }
  const agreedCurrency = normalizeCurrency(a.currency) ?? a.currency;
  if (cur !== agreedCurrency) {
    return derived(`La factura está en ${cur} y el acuerdo en ${agreedCurrency}; no se puede comparar el monto.`, {
      agreementId: a.id,
      kind: a.kind,
      invoiceCurrency: cur,
      agreementCurrency: agreedCurrency,
    });
  }
  const totalCents = toCents(total);
  if (totalCents <= 0) {
    return fail(
      `El total facturado (${money(total, cur)}) no es un monto a pagar.`,
      ACTION_AMOUNT,
      { agreementId: a.id, kind: a.kind, total },
    );
  }
  // Una tolerancia infinita aceptaría cualquier monto; NaN no compara con nada.
  const tolerance = ruleValue(ctx, "amountTolerancePct");
  if (!tolerance.ok) return tolerance.result;
  const pct = tolerance.value;

  if (a.kind === "fixed_recurring" || a.kind === "one_off") {
    if (!isFiniteNumber(a.amount)) {
      return notEvaluable(
        `El acuerdo «${a.description}» no tiene monto pactado registrado.`,
        "Completar el monto pactado en la ficha del proveedor.",
        { agreementId: a.id, kind: a.kind, agreedAmount: null },
      );
    }
    const expectedCents = toCents(a.amount);
    const diffCents = Math.abs(totalCents - expectedCents);
    const tolCents = toleranceCents(expectedCents, pct);
    const params = {
      agreementId: a.id,
      kind: a.kind,
      currency: cur,
      invoiced: total,
      agreed: a.amount,
      difference: diffCents / 100,
      tolerancePct: pct,
      tolerance: tolCents / 100,
    };
    if (diffCents <= tolCents) {
      const detail =
        diffCents === 0
          ? `Facturado ${money(total, cur)}, igual a lo pactado.`
          : `Facturado ${money(total, cur)} y lo pactado es ${money(a.amount, cur)}: la diferencia (${money(diffCents / 100, cur)}) está dentro de la tolerancia de ±${formatPct(pct)}.`;
      return pass(detail, params);
    }
    const diffPct = expectedCents > 0 ? Math.round((diffCents / expectedCents) * 10000) / 100 : null;
    const pctText = diffPct != null ? `, ${formatPct(diffPct)}` : "";
    return fail(
      `Facturado ${money(total, cur)} y lo pactado es ${money(a.amount, cur)}: la diferencia (${money(diffCents / 100, cur)}${pctText}) supera la tolerancia de ±${formatPct(pct)}.`,
      ACTION_AMOUNT,
      params,
    );
  }

  // hourly
  if (!isFiniteNumber(a.rate)) {
    return notEvaluable(
      `El acuerdo por hora «${a.description}» no tiene tarifa registrada.`,
      "Completar la tarifa pactada en la ficha del proveedor.",
      { agreementId: a.id, kind: a.kind, rate: null },
    );
  }
  const rate = a.rate;
  // null = sin máximo; cualquier otro valor no numérico es un dato corrupto, no «sin máximo».
  if (a.maxQuantity != null && !isFiniteNumber(a.maxQuantity)) {
    return notEvaluable(
      `El acuerdo por hora «${a.description}» tiene un máximo de horas no válido en la ficha.`,
      "Corregir el máximo de horas pactado en la ficha del proveedor.",
      { agreementId: a.id, kind: a.kind, rate, maxQuantity: String(a.maxQuantity) },
    );
  }
  const withQty = data.lineItems.filter((l) => isFiniteNumber(l.quantity));
  if (withQty.length === 0) {
    return notEvaluable(
      "La factura no indica cantidad de horas; no se puede comparar con la tarifa pactada.",
      "Confirmar con el proveedor cuántas horas factura.",
      { agreementId: a.id, kind: a.kind, rate, quantity: null },
    );
  }
  const quantity = withQty.reduce((sum, l) => sum + (l.quantity ?? 0), 0);
  const expected = quantity * rate;
  const expectedCents = toCents(expected);
  const diffCents = Math.abs(totalCents - expectedCents);
  const tolCents = toleranceCents(expectedCents, pct);
  const problems: string[] = [];

  if (withQty.some((l) => (l.quantity ?? 0) < 0)) problems.push("Hay líneas con cantidad negativa");

  const rateCents = toCents(rate);
  const wrongRates = unique(
    data.lineItems
      .filter((l) => isFiniteNumber(l.unitPrice) && toCents(l.unitPrice) !== rateCents)
      .map((l) => money(l.unitPrice ?? 0, cur)),
  );
  if (wrongRates.length > 0) {
    problems.push(`La tarifa facturada (${listEs(wrongRates)} por hora) no es la pactada (${money(rate, cur)} por hora)`);
  }

  const max = a.maxQuantity;
  const overMax = isFiniteNumber(max) && Math.round(quantity * 100) > Math.round(max * 100);
  const perWhat = a.frequency === "monthly" ? "por mes" : "en total";
  if (overMax) {
    problems.push(`Se facturan ${formatNumber(quantity)} h y el máximo pactado es ${formatNumber(max)} h ${perWhat}`);
  }

  if (diffCents > tolCents) {
    problems.push(
      `${formatNumber(quantity)} h × ${money(rate, cur)} = ${money(expected, cur)}, pero se facturan ${money(total, cur)} (diferencia de ${money(diffCents / 100, cur)}, fuera de la tolerancia de ±${formatPct(pct)})`,
    );
  }

  const params = {
    agreementId: a.id,
    kind: a.kind,
    currency: cur,
    quantity,
    rate,
    maxQuantity: isFiniteNumber(max) ? max : null,
    expected,
    invoiced: total,
    difference: diffCents / 100,
    tolerancePct: pct,
    wrongRate: wrongRates.length > 0,
    overMax,
  };
  if (problems.length > 0) return fail(`${problems.join(". ")}.`, ACTION_AMOUNT, params);

  const maxText = isFiniteNumber(max) ? `; máximo pactado ${formatNumber(max)} h ${perWhat}` : "";
  const match =
    diffCents === 0
      ? "igual a lo facturado"
      : `y se facturan ${money(total, cur)}, dentro de la tolerancia de ±${formatPct(pct)}`;
  return pass(`${formatNumber(quantity)} h × ${money(rate, cur)} = ${money(expected, cur)}, ${match}${maxText}.`, params);
};

// ───────────────────────── Límites y fondo ─────────────────────────

const lim1: Evaluator = (f, _input, ctx) => {
  const usd = f.usd;
  if (!usd.ok) return usdNotEvaluable(usd);
  const rule = ruleValue(ctx, "approvalThresholdUsd");
  if (!rule.ok) return rule.result;
  const threshold = rule.value;
  const thresholdCents = toCents(threshold);
  const params = { amountUsd: usd.amountUsdCents / 100, thresholdUsd: threshold, fxRate: usd.fxRate };
  if (usd.amountUsdCents > thresholdCents) {
    return fail(
      `${amountLabel(usd)} supera el umbral de aprobación de ${formatUsdCents(thresholdCents)}; decide una persona.`,
      "Aprobar o rechazar: el monto supera el umbral de aprobación.",
      params,
    );
  }
  return pass(`${amountLabel(usd)} no supera el umbral de aprobación de ${formatUsdCents(thresholdCents)}.`, params);
};

const lim2: Evaluator = (f, _input, ctx) => {
  const usd = f.usd;
  if (!usd.ok) return usdNotEvaluable(usd);
  const rule = ruleValue(ctx, "periodLimitUsd");
  if (!rule.ok) return rule.result;
  // Con una fecha actual ilegible, monthOf daría un «mes» que no coincide con ningún pago y lo
  // pagado en el mes saldría en cero.
  const today = isoDateOf(ctx.now);
  if (today == null) {
    return notEvaluable(
      "No se recibió una fecha actual válida; no se puede saber en qué mes se imputa el pago ni cuánto se pagó en ese mes.",
      "Revisar la fecha del sistema: no se pudo determinar el mes en curso para el límite mensual.",
      { now: truncate(String(ctx.now), 40) || null },
    );
  }
  const month = monthOf(today);
  // Un pago sin fecha válida podría ser de este mes: no se descarta en silencio.
  const undated = f.paid.filter((h) => isoDateOf(h.decidedAt) == null).length;
  if (undated > 0) {
    return notEvaluable(
      `Hay ${undated} pago(s) en el historial sin fecha válida; no se puede calcular lo pagado en ${formatPeriod(month)}.`,
      "Revisar el historial de pagos: hay pagos sin fecha válida.",
      { month, paymentsWithoutDate: undated },
    );
  }
  const inMonth = f.paid.filter((h) => monthOf(isoDateOf(h.decidedAt) ?? "") === month);
  const spent = sumUsdCents(inMonth);
  if (spent.missing > 0) {
    return notEvaluable(
      `Hay ${spent.missing} pago(s) de ${formatPeriod(month)} sin un monto en USD válido en el historial; no se puede calcular lo pagado en el mes.`,
      "Revisar el historial de pagos del mes: hay pagos sin un monto en USD válido.",
      { month, paymentsWithoutAmount: spent.missing },
    );
  }
  const limit = rule.value;
  const limitCents = toCents(limit);
  const after = spent.cents + usd.amountUsdCents;
  const params = {
    month,
    spentUsd: spent.cents / 100,
    amountUsd: usd.amountUsdCents / 100,
    afterUsd: after / 100,
    limitUsd: limit,
  };
  if (after > limitCents) {
    return fail(
      `Pagado en ${formatPeriod(month)}: ${formatUsdCents(spent.cents)}. Con este pago (${amountLabel(usd)}) quedaría en ${formatUsdCents(after)}, por encima del límite mensual de ${formatUsdCents(limitCents)}.`,
      "Decidir si se paga este mes o se pospone: superaría el límite mensual.",
      params,
    );
  }
  return pass(
    `Pagado en ${formatPeriod(month)}: ${formatUsdCents(spent.cents)}. Con este pago quedaría en ${formatUsdCents(after)}, dentro del límite mensual de ${formatUsdCents(limitCents)}.`,
    params,
  );
};

const fon1: Evaluator = (f, _input, ctx) => {
  const usd = f.usd;
  if (!usd.ok) return usdNotEvaluable(usd);
  const rule = ruleValue(ctx, "initialFundUsd");
  if (!rule.ok) return rule.result;
  const spent = sumUsdCents(f.paid);
  if (spent.missing > 0) {
    return notEvaluable(
      `Hay ${spent.missing} pago(s) sin un monto en USD válido en el historial; no se puede calcular el fondo disponible.`,
      "Revisar el historial de pagos: hay pagos sin un monto en USD válido.",
      { paymentsWithoutAmount: spent.missing },
    );
  }
  const fund = rule.value;
  const fundCents = toCents(fund);
  const available = fundCents - spent.cents;
  const params = {
    initialFundUsd: fund,
    paidUsd: spent.cents / 100,
    availableUsd: available / 100,
    amountUsd: usd.amountUsdCents / 100,
  };
  if (usd.amountUsdCents > available) {
    return fail(
      `Quedan ${formatUsdCents(available)} de un fondo de ${formatUsdCents(fundCents)} y este pago es de ${amountLabel(usd)}: no alcanza.`,
      "Recargar el fondo o posponer el pago: el fondo disponible no alcanza.",
      params,
    );
  }
  return pass(
    `Quedan ${formatUsdCents(available)} de un fondo de ${formatUsdCents(fundCents)}; este pago (${amountLabel(usd)}) alcanza.`,
    params,
  );
};

/** Un evaluador por código. El tipo obliga a que estén los 15. */
export const EVALUATORS: Record<CheckCode, Evaluator> = {
  "LEC-1": lec1,
  "LEC-2": lec2,
  "LEC-3": lec3,
  "LEC-4": lec4,
  "DUP-1": dup1,
  "DUP-2": dup2,
  "DUP-3": dup3,
  "PRV-1": prv1,
  "PRV-2": prv2,
  "ACU-1": acu1,
  "ACU-2": acu2,
  "ACU-3": acu3,
  "LIM-1": lim1,
  "LIM-2": lim2,
  "FON-1": fon1,
};
