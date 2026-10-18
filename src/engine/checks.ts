/**
 * Las 15 comprobaciones del catálogo. Cada evaluador es puro: recibe los hechos derivados,
 * la entrada y el contexto, y devuelve estado, explicación con valores concretos, parámetros
 * usados y (si no pasa) la instrucción para la persona que revise.
 */
import { OUTCOME_LABEL } from "../core/checks";
import { bareDollarMeaning, localDollarSignCurrency } from "../core/currency";
import { normalizeAccount, toCents, monthOf } from "../core/normalize";
import {
  CRITICAL_FIELDS,
  type Agreement,
  type CheckCode,
  type CheckResult,
  type CriticalField,
  type DecisionContext,
  type EngineInput,
  type Extraction,
  type HistoryEntry,
  type InvoiceData,
  type ReaderResult,
  type ReadingSignals,
  type Vendor,
  type VoidDocumentKind,
} from "../core/schemas";
import {
  agreementCoversPeriod,
  bankNamesMayMatch,
  calendarDate,
  compareRoutingCodes,
  describeValidity,
  isFiniteNumber,
  instantMonths,
  isAbsent,
  isoDateOf,
  normalizeCurrency,
  normalizeFileHash,
  normalizeInvoiceNumber,
  periodOf,
  roundCents,
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

function usdNotEvaluable(usd: Extract<UsdAmount, { ok: false }>, total: number | null | undefined): Evaluation {
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
    case "not_positive":
      // Un total cero o negativo ya lo explica «Monto pactado»; aquí solo se marca sin evaluar.
      if (!isFiniteNumber(total) || total <= 0) {
        return derived("El total de la factura no es un monto a pagar; no hay monto en USD que comparar.", {
          reason: usd.reason,
          currency: usd.currency,
        });
      }
      return notEvaluable(
        `El total convertido a USD da menos de un centavo (${usd.currency ?? "moneda desconocida"} ${formatNumber(total)}); no se puede registrar como pago.`,
        "Revisar el total y la moneda de la factura: convertido a USD no da un monto a pagar.",
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

/** "1 decisión" / "3 decisiones": cuántas entradas del historial no se pueden descartar. */
function countText(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/** Frase para las decisiones del historial con un resultado desconocido (podrían ser pagos), o null. */
function unknownOutcomeText(f: Facts): string | null {
  const n = f.unknownOutcome.length;
  return n === 0 ? null : `${countText(n, "decisión", "decisiones")} con un resultado desconocido (podría ser un pago)`;
}

const ACTION_HISTORY = "Revisar el historial de decisiones: hay registros incompletos que podrían ser pagos de esta misma factura.";
const ACTION_UNKNOWN_OUTCOME = "Revisar el historial de decisiones: hay registros con un resultado desconocido que podrían ser pagos.";

type NumericRule = "approvalThresholdUsd" | "periodLimitUsd" | "initialFundUsd" | "amountTolerancePct";

const RULE_LABELS: Record<NumericRule, string> = {
  approvalThresholdUsd: "umbral de aprobación",
  periodLimitUsd: "límite mensual",
  initialFundUsd: "fondo inicial",
  amountTolerancePct: "tolerancia del monto",
};

/**
 * Máximo de la tolerancia del monto (en %). Con más de 100 % un acuerdo de USD 1.000 aceptaría
 * cualquier factura de 0 a más del doble: deja de ser «lo pactado». La pantalla y la API usan el mismo tope.
 */
export const MAX_AMOUNT_TOLERANCE_PCT = 100;

const RULE_RANGE_TEXT: Record<NumericRule, string> = {
  approvalThresholdUsd: "cero o más",
  periodLimitUsd: "cero o más",
  initialFundUsd: "cero o más",
  amountTolerancePct: `entre 0 y ${MAX_AMOUNT_TOLERANCE_PCT}`,
};

/**
 * Valor de una regla numérica, o una evaluación sin datos si no es un número finito y no negativo
 * (la tolerancia, además, no puede pasar de MAX_AMOUNT_TOLERANCE_PCT). Un NaN o un undefined (p. ej.
 * al mezclar reglas) haría que «monto > umbral» diera false y se pagara sin límite; una tolerancia
 * de 1000 % haría «pactado» cualquier monto.
 */
function ruleValue(ctx: DecisionContext, rule: NumericRule): { ok: true; value: number } | { ok: false; result: Evaluation } {
  const value: unknown = ctx.company.rules[rule];
  // Un valor negativo tampoco es válido: una tolerancia negativa, por ejemplo, no tiene sentido.
  const inRange = isFiniteNumber(value) && value >= 0 && (rule !== "amountTolerancePct" || value <= MAX_AMOUNT_TOLERANCE_PCT);
  if (inRange) return { ok: true, value };
  const label = RULE_LABELS[rule];
  return {
    ok: false,
    result: notEvaluable(
      `La regla «${label}» no tiene un valor numérico válido (${RULE_RANGE_TEXT[rule]}) en la configuración de la empresa; no se puede evaluar esta comprobación.`,
      `Revisar la configuración de reglas de la empresa: «${label}» no tiene un valor válido.`,
      { rule, ruleValue: String(value) },
    ),
  };
}

// ───────────────────────── Lectura ─────────────────────────

/** Tipos de documento que se pagan: una factura o una cuenta de cobro. */
const PAYABLE_DOCUMENT_TYPES: ReadonlySet<string> = new Set(["invoice", "cuenta_de_cobro"]);
const RECEIPT_PROBLEM = "El documento parece un recibo de algo ya pagado, no una factura ni una cuenta de cobro";
const OTHER_DOCUMENT_PROBLEM = "El documento no parece una factura ni una cuenta de cobro";
const PAID_PROBLEM = "El documento indica que ya fue pagado";
/** Cuántas marcas de «ya pagado» se citan en la explicación (el resto se cuenta). */
const PAID_QUOTES_SHOWN = 2;
const TOTAL_QUOTE_PROBLEM =
  "La cita del total no muestra la etiqueta del total, es la misma del subtotal o una lectura anota que el total está borroso o que lo dedujo, y el documento no tiene texto para comprobarlo";
const VOID_PROBLEM = "El documento no es un cobro válido";
/** Cuántas marcas de documento no cobrable se citan en la explicación (el resto se cuenta). */
const VOID_QUOTES_SHOWN = 2;
const ACTION_VOID = "Confirmar con el proveedor si hay una factura vigente que reemplace a esta; esta no se paga.";
const ACTION_CREDIT_NOTE =
  "Registrar la nota crédito como saldo a favor de la empresa y descontarla del próximo cobro del proveedor; una nota crédito no se paga.";
const ACTION_DRAFT = "Pedir al proveedor la factura definitiva; un borrador o una proforma no se paga.";
const ACTION_NOT_INVOICE = "Pedir al proveedor la factura o la cuenta de cobro: este documento dice que no es una factura y no se paga.";
const ACTION_NOT_PAYABLE = "Revisar el documento con el proveedor: no es un cobro válido y no se paga.";
const ACTION_RECEIPT = "Confirmar con el proveedor si hay un cobro pendiente: un recibo es de algo ya pagado y no se paga otra vez.";
const ACTION_OTHER_DOCUMENT =
  "Revisar el documento original: solo se pagan facturas y cuentas de cobro. Si es un cobro, pedir al proveedor la factura o la cuenta de cobro.";

/** Extracciones de las lecturas que sí funcionaron (principal y segunda). */
function okExtractions(input: EngineInput): Extraction[] {
  const r = input.reading;
  return [r.primary, r.secondary].flatMap((x) => (x != null && x.ok ? [x.extraction] : []));
}

function extractionField(e: Extraction, field: CriticalField): { legible?: unknown } | undefined {
  return field === "accountNumber" ? e.payment?.accountNumber : e[field];
}

/**
 * Marcas de documento ya pagado de la señal (lecturas que dicen «receipt» y detector por patrones).
 * La señal la produce otro módulo y es opcional en registros viejos: si no es una lista, no hay marcas
 * (el tipo de documento de las lecturas se revisa aparte).
 */
function paidMarkersOf(input: EngineInput): NonNullable<ReadingSignals["paidDocumentMarkers"]> {
  const markers: unknown = input.reading.signals.paidDocumentMarkers;
  return Array.isArray(markers) ? (markers as NonNullable<ReadingSignals["paidDocumentMarkers"]>) : [];
}

/** «El documento indica que ya fue pagado: «Payment receipt», «Payment received on 2026-08-10» y 1 más». */
function paidProblem(quotes: readonly string[], readersSayReceipt: boolean): string {
  const shown = quotes.slice(0, PAID_QUOTES_SHOWN).map((q) => `«${truncate(q, 100)}»`);
  const rest = quotes.length - shown.length;
  const more = rest > 0 ? ` y ${rest} más` : "";
  const alsoReaders = readersSayReceipt ? " (una de las lecturas también lo clasifica como recibo)" : "";
  return `${PAID_PROBLEM}: ${shown.join(", ")}${more}${alsoReaders}`;
}

/** Marca de documento no cobrable ya limpia: texto, motivo y clase (null si el registro no la trae). */
interface VoidMarkerView {
  text: string;
  reason: string;
  kind: VoidDocumentKind | null;
}

const VOID_KINDS: readonly VoidDocumentKind[] = ["void", "credit_note", "draft", "not_invoice"];

/**
 * Marcas de documento que no es un cobro válido (anulado, borrador, proforma, nota crédito, «no es una
 * factura»). La señal la produce otro módulo y es opcional en registros viejos: si no es una lista, no
 * hay marcas. Una marca sin texto se conserva con su motivo (descartarla dejaría pasar el pago).
 */
function voidMarkersOf(input: EngineInput): VoidMarkerView[] {
  const raw: unknown = input.reading.signals.voidDocumentMarkers;
  if (!Array.isArray(raw)) return [];
  const out: VoidMarkerView[] = [];
  for (const m of raw as unknown[]) {
    const text = typeof (m as { text?: unknown })?.text === "string" ? (m as { text: string }).text.replace(/\s+/g, " ").trim() : "";
    const reason = typeof (m as { reason?: unknown })?.reason === "string" ? (m as { reason: string }).reason.replace(/\s+/g, " ").trim() : "";
    const rawKind: unknown = (m as { kind?: unknown })?.kind;
    const kind = VOID_KINDS.find((k) => k === rawKind) ?? null;
    if (out.some((o) => o.text === text && o.reason === reason && o.kind === kind)) continue;
    out.push({ text, reason, kind });
  }
  return out;
}

/**
 * Qué se le pide a la persona según la clase de documento no cobrable: una anulada se reemplaza, un
 * borrador o una proforma espera la factura definitiva, una nota crédito es un saldo a favor. Sin clase
 * (registros viejos), la acción general.
 */
function voidActions(markers: readonly VoidMarkerView[]): string[] {
  const kinds = new Set(markers.map((m) => m.kind));
  const out: string[] = [];
  if (kinds.has("void")) out.push(ACTION_VOID);
  if (kinds.has("credit_note")) out.push(ACTION_CREDIT_NOTE);
  if (kinds.has("draft")) out.push(ACTION_DRAFT);
  if (kinds.has("not_invoice")) out.push(ACTION_NOT_INVOICE);
  if (kinds.has(null)) out.push(ACTION_NOT_PAYABLE);
  return out;
}

/** «El documento no es un cobro válido: «ANULADA» (Dice que el documento está anulado o cancelado) y 1 más». */
function voidProblem(markers: readonly VoidMarkerView[]): string {
  const shown = markers.slice(0, VOID_QUOTES_SHOWN).map((m) => {
    const quote = m.text !== "" ? `«${truncate(m.text, 100)}»` : "una marca sin texto";
    const why = m.reason !== "" ? ` (${stripFinalPeriod(truncate(m.reason, 120))})` : "";
    return `${quote}${why}`;
  });
  const rest = markers.length - shown.length;
  const more = rest > 0 ? ` y ${rest} más` : "";
  return `${VOID_PROBLEM}: ${shown.join(", ")}${more}`;
}

/** Un aviso de la entrada que no es texto: se conserva (descartarlo dejaría pasar el pago). */
const INGEST_WARNING_GENERIC = "La entrada dejó un aviso sin detalle sobre el archivo";
/** Largo máximo de cada aviso de la entrada dentro de la explicación. */
const INGEST_WARNING_MAX = 320;
const ACTION_INGEST =
  "Abrir el correo original como lo ve una persona en su cliente de correo y revisar lo que la lectura no vio o vio distinto (la versión HTML del cuerpo, los adjuntos que no se pudieron leer, el texto que se ve distinto de como se lee). Si muestra que la factura ya está pagada o cambia los datos del cobro, no pagar; si no, pedir al proveedor la factura en PDF.";

/**
 * Avisos de la entrada (versión HTML distinta del texto plano, adjunto que no se pudo leer). La señal
 * la produce otro módulo y es opcional en registros viejos: si no es una lista, no hay avisos.
 */
function ingestWarningsOf(input: EngineInput): string[] {
  const raw: unknown = input.reading.signals.ingestWarnings;
  if (!Array.isArray(raw)) return [];
  return unique(
    (raw as unknown[]).map((w) => {
      const text = typeof w === "string" ? stripFinalPeriod(w.replace(/\s+/g, " ").trim()) : "";
      return text === "" ? INGEST_WARNING_GENERIC : truncate(text, INGEST_WARNING_MAX);
    }),
  );
}

/**
 * Campos críticos que alguna de las dos lecturas marcó como ilegibles. La señal la produce otro
 * módulo y puede venir solo de la lectura principal: si la segunda dudó, tampoco se paga.
 */
function illegibleInReadings(input: EngineInput): CriticalField[] {
  const out = new Set<CriticalField>();
  for (const e of okExtractions(input)) {
    for (const field of CRITICAL_FIELDS) if (extractionField(e, field)?.legible !== true) out.add(field);
  }
  return [...out];
}

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
  const documentType = String(data.documentType);
  // El tipo de documento de las DOS lecturas: si la segunda dice que es un recibo (algo ya pagado)
  // u otro documento, la coincidencia en los demás datos no basta para pagarlo.
  const readTypes = unique([documentType, ...okExtractions(input).map((e) => String(e.documentType))]);
  const notPayable = readTypes.filter((t) => !PAYABLE_DOCUMENT_TYPES.has(t));
  // Documento ya pagado según la verificación: lecturas que dicen «receipt» o marcas en el texto
  // («Payment received on…», «Recibo de pago», un sello «PAGADO»). No depende de que el modelo acierte.
  const paidMarkers = paidMarkersOf(input);
  const paidQuotes = unique(
    paidMarkers.filter((m) => m?.source === "heuristic").map((m) => String(m?.text ?? "").replace(/\s+/g, " ").trim()).filter(Boolean),
  );
  const readersSayReceipt = notPayable.includes("receipt") || paidMarkers.some((m) => m?.source !== "heuristic");
  // Documento que no es un cobro según el texto: anulado, borrador, proforma, nota crédito.
  const voidMarkers = voidMarkersOf(input);
  const documentKind = paidMarkers.length > 0 || notPayable.includes("receipt") ? "receipt" : notPayable.length > 0 ? "other" : null;
  const documentProblem =
    documentKind == null
      ? null
      : paidQuotes.length > 0
        ? paidProblem(paidQuotes, readersSayReceipt)
        : `${documentKind === "receipt" ? RECEIPT_PROBLEM : OTHER_DOCUMENT_PROBLEM}${
            PAYABLE_DOCUMENT_TYPES.has(documentType) ? " (así lo clasifica una de las dos lecturas)" : ""
          }`;
  const nullCritical = CRITICAL_FIELDS.filter((k) => isBlank(data[k]));
  const missing = unique([...s.missingCriticalFields, ...nullCritical].map(fieldLabel));
  const illegible = unique([...s.illegibleCriticalFields, ...illegibleInReadings(input)].map(fieldLabel));
  const notFound = unique(s.evidenceNotFound.map(fieldLabel));
  // Total ilegible solo por la verificación (las lecturas lo dieron por legible): sin texto con qué
  // comprobarlo, la cita del total no trae su etiqueta, es la del subtotal o la nota de una lectura dice
  // que está borroso o que lo dedujo.
  const totalQuoteProblem =
    s.illegibleCriticalFields.includes("total") && okExtractions(input).every((e) => e.total?.legible === true);

  // Lo que una persona ve en el correo y la lectura no (versión HTML distinta, adjunto sin leer).
  const ingestWarnings = ingestWarningsOf(input);

  if (
    documentProblem == null &&
    voidMarkers.length === 0 &&
    missing.length === 0 &&
    illegible.length === 0 &&
    notFound.length === 0 &&
    ingestWarnings.length === 0
  ) {
    return pass(
      `Están completos y legibles los datos críticos: ${listEs(CRITICAL_FIELDS.map(fieldLabel))}.`,
      { dataAvailable: true, documentType, missing: null, illegible: null, evidenceNotFound: null, paidMarkers: 0, voidMarkers: 0, ingestWarnings: 0 },
    );
  }
  const parts: string[] = [];
  if (voidMarkers.length > 0) parts.push(voidProblem(voidMarkers));
  if (documentProblem != null) parts.push(documentProblem);
  parts.push(...ingestWarnings);
  if (missing.length > 0) parts.push(`Faltan datos críticos: ${listEs(missing)}`);
  if (illegible.length > 0) parts.push(`No se leen con claridad: ${listEs(illegible)}`);
  if (totalQuoteProblem) parts.push(TOTAL_QUOTE_PROBLEM);
  if (notFound.length > 0) {
    parts.push(
      notFound.length === 1
        ? `Dato no respaldado por el texto del documento: ${notFound[0]}`
        : `Datos no respaldados por el texto del documento: ${listEs(notFound)}`,
    );
  }
  const all = unique([...missing, ...illegible, ...notFound]);
  const actions: string[] = [];
  if (ingestWarnings.length > 0) actions.push(ACTION_INGEST);
  actions.push(...voidActions(voidMarkers));
  if (documentKind != null) actions.push(documentKind === "receipt" ? ACTION_RECEIPT : ACTION_OTHER_DOCUMENT);
  if (all.length > 0) actions.push(`Revisar el documento original y completar o corregir a mano: ${listEs(all)}.`);
  return fail(`${parts.join(". ")}.`, actions.join(" "), {
    dataAvailable: true,
    documentType,
    documentTypesRead: readTypes.join(", "),
    missing: missing.join(", ") || null,
    illegible: illegible.join(", ") || null,
    evidenceNotFound: notFound.join(", ") || null,
    paidMarkers: paidMarkers.length,
    firstPaidMarker: paidQuotes[0] != null ? truncate(paidQuotes[0], 120) : null,
    voidMarkers: voidMarkers.length,
    firstVoidMarker: voidMarkers[0] != null ? truncate(voidMarkers[0].text, 120) || null : null,
    ingestWarnings: ingestWarnings.length,
    firstIngestWarning: ingestWarnings[0] != null ? truncate(ingestWarnings[0], 120) : null,
  });
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

const INSTRUCTIONS_UNREADABLE = "(la lectura no trae la lista de instrucciones detectadas)";

/**
 * Instrucciones a revisar: las de la señal; si la señal viene vacía pero alguna lectura reportó
 * instrucciones (o no trae la lista), esas. La señal la produce otro módulo: no se le cree a ciegas.
 */
function suspiciousOf(input: EngineInput): ReadingSignals["suspiciousInstructions"] {
  const fromSignals = input.reading.signals.suspiciousInstructions;
  if (fromSignals.length > 0) return fromSignals;
  return okExtractions(input).flatMap((e) =>
    Array.isArray(e.embeddedInstructions)
      ? e.embeddedInstructions.map((i) => ({
          text: String(i?.text ?? ""),
          source: "model" as const,
          reason: String(i?.reason ?? "").trim() || "Instrucción reportada por el lector",
        }))
      : [{ text: INSTRUCTIONS_UNREADABLE, source: "model" as const, reason: "Lectura incompleta" }],
  );
}

const lec4: Evaluator = (f, input) => {
  const found = suspiciousOf(input);
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
  const prev = ctx.history.find((h) => normalizeFileHash(typeof h.fileHash === "string" ? h.fileHash : null) === hash);
  if (prev) {
    return fail(
      `Este mismo archivo ya se procesó el ${shortDate(prev.decidedAt)} (factura ${prev.invoiceId}, decisión: ${OUTCOME_LABEL[prev.outcome] ?? "desconocida"}).`,
      "Confirmar si es un reenvío del mismo archivo; no pagarlo dos veces.",
      { fileHash: shortHash, previousInvoiceId: prev.invoiceId, previousOutcome: prev.outcome },
    );
  }
  // Una decisión sin huella podría ser de este mismo archivo: no se descarta en silencio.
  const unhashed = ctx.history.filter((h) => normalizeFileHash(typeof h.fileHash === "string" ? h.fileHash : null) == null).length;
  if (unhashed > 0) {
    return notEvaluable(
      `Hay ${countText(unhashed, "decisión", "decisiones")} en el historial sin huella de archivo; no se puede descartar que este archivo ya se haya procesado.`,
      ACTION_HISTORY,
      { fileHash: shortHash, decisionsWithoutHash: unhashed },
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
  // Un pago sin proveedor, o de este proveedor sin número, podría ser esta misma factura.
  const noVendor = f.paid.filter((h) => isAbsent(h.vendorId)).length;
  const noNumber = f.paid.filter((h) => h.vendorId === vendor.id && normalizeInvoiceNumber(h.invoiceNumber) == null).length;
  const doubts = [
    noVendor > 0 ? `${countText(noVendor, "pago", "pagos")} sin proveedor` : null,
    noNumber > 0 ? `${countText(noNumber, "pago", "pagos")} de ${vendor.name} sin número de factura` : null,
    unknownOutcomeText(f),
  ].filter((x): x is string => x != null);
  if (doubts.length > 0) {
    return notEvaluable(
      `No se puede descartar que el número ${shown} ya se haya pagado: en el historial hay ${listEs(doubts)}.`,
      ACTION_HISTORY,
      { vendorId: vendor.id, invoiceNumber: number, paymentsWithoutVendor: noVendor, paymentsWithoutNumber: noNumber },
    );
  }
  return pass(`No hay otra factura pagada de ${vendor.name} con el número ${shown}.`, {
    vendorId: vendor.id,
    invoiceNumber: number,
    previousInvoiceId: null,
  });
};

/**
 * Otros acuerdos del proveedor cuya vigencia cubre el periodo facturado y con los que la factura
 * también cuadra (misma moneda, monto dentro de lo pactado). No hace falta que estén vigentes en la
 * fecha de emisión: si un acuerdo se renovó a mitad de mes, el mes ya pagado con el anterior no se
 * vuelve a pagar con el nuevo.
 */
function otherFittingAgreements(f: Facts, chosen: Agreement, ctx: DecisionContext): Agreement[] {
  const data = f.data;
  const cur = f.currency;
  const sel = f.selection;
  if (data == null || cur == null || sel == null || !isFiniteNumber(data.total)) return [];
  const total = data.total;
  const billed = sel.billedPeriod;
  const pool = billed == null ? sel.candidates : (f.vendor?.agreements ?? []).filter((a) => agreementCoversPeriod(a, billed));
  return pool.filter(
    (other) =>
      other.id !== chosen.id &&
      normalizeCurrency(other.currency) === cur &&
      amountEvaluation(other, data, cur, total, ctx).status === "pass",
  );
}

/**
 * Pagos del historial que impiden descartar que este periodo (o este pago único) ya se pagó: pagos
 * sin acuerdo, pagos de este acuerdo (o de otro con el que la factura también cuadra) mensuales sin
 * un periodo válido, y decisiones con un resultado desconocido. Devuelve las frases, o [] si no hay.
 */
function periodDoubts(f: Facts, chosen: Agreement, ctx: DecisionContext): string[] {
  const related = [chosen, ...otherFittingAgreements(f, chosen, ctx)];
  const monthlyIds = new Set(related.filter((a) => a.frequency !== "once").map((a) => a.id));
  const noAgreement = f.paid.filter((h) => isAbsent(h.agreementId)).length;
  const noPeriod = f.paid.filter((h) => monthlyIds.has(String(h.agreementId)) && periodOf(h.agreementPeriod) == null).length;
  return [
    noAgreement > 0 ? `${countText(noAgreement, "pago", "pagos")} sin acuerdo` : null,
    noPeriod > 0 ? `${countText(noPeriod, "pago", "pagos")} de este acuerdo sin un periodo válido` : null,
    unknownOutcomeText(f),
  ].filter((x): x is string => x != null);
}

/**
 * Si la factura cuadra también con OTRO acuerdo vigente del proveedor (misma moneda, mismo periodo
 * cubierto, monto dentro de lo pactado) y ese ya se pagó para este periodo (o era de pago único y
 * ya se pagó), no se puede descartar un cobro repetido aunque el acuerdo elegido esté libre.
 */
function paidUnderAnotherAgreement(f: Facts, chosen: Agreement, ctx: DecisionContext): Evaluation | null {
  const sel = f.selection;
  if (sel == null) return null;
  for (const other of otherFittingAgreements(f, chosen, ctx)) {
    const prev = f.paid.find(
      (h) => h.agreementId === other.id && (other.frequency === "once" || periodOf(h.agreementPeriod) === sel.billedPeriod),
    );
    if (prev == null) continue;
    const what =
      other.frequency === "once"
        ? `el acuerdo de pago único «${other.description}», que ya se pagó`
        : `el acuerdo «${other.description}», cuyo periodo ${formatPeriod(sel.billedPeriod ?? "")} ya se pagó`;
    return notEvaluable(
      `La factura también cuadra con ${what} (factura ${prev.invoiceId}); no se puede descartar un cobro repetido.`,
      "Confirmar con el proveedor a qué acuerdo corresponde esta factura y que ese periodo no se haya pagado ya.",
      { agreementId: chosen.id, otherAgreementId: other.id, previousInvoiceId: prev.invoiceId, period: f.period },
    );
  }
  return null;
}

const dup3: Evaluator = (f, _input, ctx) => {
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
    const doubts = periodDoubts(f, agreement, ctx);
    if (doubts.length > 0) {
      return notEvaluable(
        `No se puede descartar que el acuerdo de pago único «${agreement.description}» ya se haya pagado: en el historial hay ${listEs(doubts)}.`,
        ACTION_HISTORY,
        { agreementId: agreement.id, frequency: "once", period: null },
      );
    }
    const other = paidUnderAnotherAgreement(f, agreement, ctx);
    if (other) return other;
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
  const doubts = periodDoubts(f, agreement, ctx);
  if (doubts.length > 0) {
    return notEvaluable(
      `No se puede descartar que el periodo ${formatPeriod(period)} del acuerdo «${agreement.description}» ya se haya pagado: en el historial hay ${listEs(doubts)}.`,
      ACTION_HISTORY,
      { agreementId: agreement.id, frequency: "monthly", period },
    );
  }
  const other = paidUnderAnotherAgreement(f, agreement, ctx);
  if (other) return other;
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

/**
 * ¿Una cuenta escrita solo con letras y dígitos ASCII y separadores habituales (espacios, guiones,
 * puntos, barras, guion bajo)? Un valor ausente no cuenta como raro (de eso se ocupa LEC-1).
 */
function isPlainAccountText(raw: unknown): boolean {
  if (raw == null) return true;
  return typeof raw === "string" && /^[A-Za-z0-9\s\-‐-―./_]*$/.test(raw);
}

/**
 * Banco o código SWIFT/de ruteo que la factura (o alguna de las dos lecturas) da para la cuenta y que
 * no es el registrado, como texto para la explicación; null si no nombra otro banco. Un dato ausente
 * en la factura o en la ficha no se compara.
 */
function otherBankStated(input: EngineInput, data: InvoiceData, registered: Vendor["account"]): string | null {
  const stated = [
    { bank: data.bankName, routing: data.routingOrSwift },
    ...okExtractions(input).map((e) => ({ bank: e.payment?.bankName?.value, routing: e.payment?.routingOrSwift?.value })),
  ];
  for (const { bank, routing } of stated) {
    const routingDiffers = compareRoutingCodes(routing, registered.routingOrSwift) === "different";
    const bankDiffers = !bankNamesMayMatch(bank, registered.bankName);
    if (routingDiffers || bankDiffers) {
      return [bank, routing]
        .filter((x): x is string => typeof x === "string" && x.trim() !== "")
        .map((x) => `«${truncate(x.trim(), 60)}»`)
        .join(", ");
    }
  }
  return null;
}

const prv2: Evaluator = (f, input) => {
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
  // Los datos traen la cuenta ya limpia (solo letras y dígitos). Si alguna lectura la escribió con
  // otros caracteres (invisibles, «#», dígitos de ancho completo…), limpiarla podría convertir en
  // «la registrada» algo que no lo es: no se da por buena.
  if (okExtractions(input).some((e) => !isPlainAccountText(e.payment?.accountNumber?.value))) {
    return fail(
      `La cuenta destino leída trae caracteres que no son letras, dígitos ni separadores; no se puede confirmar que sea la registrada para ${vendor.name} (terminada en ${b}).`,
      "Confirmar la cuenta destino con el proveedor por un canal conocido, no por el que llegó la factura.",
      { ...params, match: false, unusualCharacters: true },
    );
  }
  if (invoiceAccount === registered) {
    // El mismo número en otro banco es otra cuenta: si la factura (o alguna lectura) nombra otro
    // banco u otro código SWIFT/de ruteo que el registrado, no se da por buena.
    const other = otherBankStated(input, f.data, vendor.account);
    if (other != null) {
      const registeredBank = [vendor.account.bankName, vendor.account.routingOrSwift].filter((x) => x != null && String(x).trim() !== "").join(", ");
      return fail(
        `El número de la cuenta destino (terminada en ${a}) coincide con el registrado para ${vendor.name}, pero la factura lo ubica en otro banco (${other}) y la cuenta registrada es de ${registeredBank || "otro banco"}: el mismo número en otro banco es otra cuenta.`,
        "Confirmar el banco y la cuenta destino con el proveedor por un canal conocido, no por el que llegó la factura.",
        { ...params, match: false, otherBank: true },
      );
    }
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

/**
 * "el 5 de octubre de 2026" o, si la factura no trae fecha de emisión y se usó el día de ctx.now,
 * "el 20 de octubre de 2026 (la factura no trae fecha de emisión; se usa la fecha actual)".
 */
function referenceText(date: string, source: "issue_date" | "now" | null): string {
  const base = `el ${formatDate(date)}`;
  return source === "now" ? `${base} (la factura no trae fecha de emisión; se usa la fecha actual)` : base;
}

const ACTION_DATE = "Confirmar la fecha de emisión de la factura para revisar la vigencia del acuerdo.";

const acu1: Evaluator = (f, _input, ctx) => {
  if (f.data == null) return derived(NO_DATA);
  const vendor = f.vendor;
  const sel = f.selection;
  if (vendor == null || sel == null) {
    return derived("Sin un proveedor registrado identificado no hay acuerdo que revisar.", { agreementId: null });
  }
  const params = {
    vendorId: vendor.id,
    agreementId: null,
    referenceDate: sel.referenceDate,
    referenceSource: sel.referenceSource,
    billedPeriod: sel.billedPeriod,
  };
  switch (sel.status) {
    case "no_agreements":
      return fail(
        `${vendor.name} no tiene acuerdos registrados.`,
        "Confirmar el acuerdo con el proveedor y registrarlo en la ficha antes de pagar.",
        params,
      );
    case "invalid_date":
      return notEvaluable(
        `La fecha de emisión de la factura («${truncate(String(f.data.issueDate), 40)}») no es una fecha válida; no se puede saber qué acuerdo estaba vigente.`,
        ACTION_DATE,
        params,
      );
    case "no_date":
      return notEvaluable(
        "La factura no trae fecha de emisión y no hay una fecha actual válida; no se puede saber qué acuerdo estaba vigente.",
        ACTION_DATE,
        params,
      );
    case "none_valid": {
      const ref = sel.referenceDate ?? "";
      const c = sel.closest;
      let detail = "";
      if (c != null) {
        const closestEnd = calendarDate(c.validTo);
        detail =
          closestEnd != null && closestEnd < ref
            ? `: «${c.description}» estuvo vigente ${describeValidity(c)}`
            : `: «${c.description}» empieza el ${formatDate(c.validFrom)}`;
      }
      return fail(
        `${vendor.name} no tiene un acuerdo vigente ${referenceText(ref, sel.referenceSource)}${detail}.`,
        "Confirmar si hay un acuerdo vigente con el proveedor; si se renovó, actualizar la ficha antes de pagar.",
        {
          ...params,
          closestAgreementId: c?.id ?? null,
          closestValidFrom: c?.validFrom ?? null,
          closestValidTo: c?.validTo ?? null,
        },
      );
    }
    case "invalid_period":
      return notEvaluable(
        `El periodo facturado («${truncate(String(f.data.servicePeriod), 40)}») no es un mes válido; no se puede comprobar que esté dentro de la vigencia del acuerdo.`,
        "Confirmar qué mes se está cobrando y que esté dentro de la vigencia del acuerdo.",
        params,
      );
    case "period_outside": {
      const c = sel.closest;
      const period = sel.billedPeriod ?? "";
      const which = c != null ? ` «${c.description}» (${describeValidity(c)})` : "";
      return fail(
        `El periodo facturado, ${formatPeriod(period)}, está fuera de la vigencia del acuerdo${which}: no se paga un servicio de antes de que empiece ni de después de que termine.`,
        "Confirmar con el proveedor qué mes se está cobrando; si el acuerdo se renovó o amplió, actualizar la ficha antes de pagar.",
        {
          ...params,
          closestAgreementId: c?.id ?? null,
          closestValidFrom: c?.validFrom ?? null,
          closestValidTo: c?.validTo ?? null,
        },
      );
    }
    case "future_date": {
      const today = isoDateOf(ctx.now);
      const todayText = today != null ? ` (hoy es ${formatDate(today)})` : "";
      return fail(
        `La fecha de emisión de la factura, ${formatDate(sel.referenceDate ?? "")}, es posterior a hoy${todayText}: una factura no se emite en el futuro, así que no se puede confirmar qué acuerdo estaba vigente.`,
        "Confirmar con el proveedor la fecha de emisión: la factura está fechada en el futuro.",
        { ...params, today },
      );
    }
    case "future_period": {
      const today = isoDateOf(ctx.now);
      const todayText = today != null ? ` (hoy es ${formatDate(today)})` : "";
      return fail(
        `El periodo facturado, ${formatPeriod(sel.billedPeriod ?? "")}, todavía no empieza${todayText}: no se paga por adelantado un servicio que aún no se presta.`,
        "Confirmar con el proveedor si es un cobro anticipado; si corresponde, aprobarlo a mano.",
        { ...params, today },
      );
    }
    case "selected": {
      const a = sel.agreement;
      if (a == null || sel.referenceDate == null || sel.billedPeriod == null) return derived(NO_AGREEMENT);
      return pass(
        `Acuerdo vigente ${referenceText(sel.referenceDate, sel.referenceSource)}: «${a.description}» (${describeValidity(a)}). El periodo facturado, ${formatPeriod(sel.billedPeriod)}, está dentro de su vigencia.`,
        { ...params, agreementId: a.id, validFrom: a.validFrom, validTo: a.validTo },
      );
    }
  }
};

/** Nombre en español de un país para la explicación de ACU-2 (el código si no está en la lista). */
const COUNTRY_NAME: Record<string, string> = {
  US: "Estados Unidos",
  CO: "Colombia",
  MX: "México",
  CL: "Chile",
  AR: "Argentina",
  EC: "Ecuador",
  SV: "El Salvador",
  PA: "Panamá",
  PR: "Puerto Rico",
  UY: "Uruguay",
  DO: "República Dominicana",
  CU: "Cuba",
  NZ: "Nueva Zelanda",
  AU: "Australia",
  CA: "Canadá",
  SG: "Singapur",
  HK: "Hong Kong",
  BR: "Brasil",
  PE: "Perú",
};
/** Nombre de la moneda local que se escribe con «$» (el código si no está en la lista). */
const LOCAL_DOLLAR_NAME: Record<string, string> = {
  USD: "el dólar estadounidense (USD)",
  COP: "el peso colombiano (COP)",
  MXN: "el peso mexicano (MXN)",
  CLP: "el peso chileno (CLP)",
  ARS: "el peso argentino (ARS)",
  UYU: "el peso uruguayo (UYU)",
  DOP: "el peso dominicano (DOP)",
  CUP: "el peso cubano (CUP)",
  NZD: "el dólar neozelandés (NZD)",
  AUD: "el dólar australiano (AUD)",
  CAD: "el dólar canadiense (CAD)",
  SGD: "el dólar de Singapur (SGD)",
  HKD: "el dólar de Hong Kong (HKD)",
};
const ACTION_DOLLAR_SIGN = (currency: string) =>
  `Pedir al proveedor que confirme la moneda (que la factura diga ${currency}) antes de pagar.`;

/**
 * Qué escribe la factura junto al total en lugar de la moneda (señal currencyMarker): "$" (un «$»
 * solo; también si el registro no la trae), "" (nada) u otro código ISO.
 */
function currencyMarkerOf(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toUpperCase() : "$";
}

/**
 * ACU-2 cuando la factura no nombra la moneda pactada junto al total (currencyOnlyDollarSign): con
 * otra moneda escrita, falla; con «$» solo, ese «$» tiene que ser la moneda pactada en el país del
 * proveedor (src/core/currency.ts); sin nada escrito, tiene que ser la moneda local de un país que la
 * escribe con «$». Sin país, sin evaluar.
 */
function dollarSignVerdict(cur: string, vendor: Vendor, rawMarker: unknown, base: CheckResult["params"]): Evaluation {
  const marker = currencyMarkerOf(rawMarker);
  const country = typeof vendor.country === "string" ? vendor.country.trim().toUpperCase() : "";
  const countryName = COUNTRY_NAME[country] ?? country;
  const action = ACTION_DOLLAR_SIGN(cur);
  if (marker !== "$" && marker !== "") {
    return fail(
      `La factura no dice ${cur} junto al total: lo que escribe es de otra moneda (${truncate(marker, 12)}). No se puede confirmar que cobre en ${cur}, la moneda pactada.`,
      action,
      { ...base, currencyOnlyDollarSign: true, currencyMarker: truncate(marker, 12), vendorCountry: country || null, bareDollarMeans: null },
    );
  }
  const bare = marker === "$";
  // Un «$» solo: lo que significa en el país. Nada escrito: la moneda local, solo si se escribe con «$».
  const means = bare ? bareDollarMeaning(country) : country ? localDollarSignCurrency(country) : null;
  const params = { ...base, currencyOnlyDollarSign: true, currencyMarker: marker, vendorCountry: country || null, bareDollarMeans: means };
  const written = bare ? "La factura solo escribe «$» y no dice la moneda" : "La factura no escribe la moneda junto al total (ni el código ni «$»)";
  if (country === "") {
    return notEvaluable(`${written}, y no se sabe el país del proveedor: no se puede confirmar que cobre en ${cur}, la moneda pactada.`, action, params);
  }
  if (means === cur) {
    const how = bare ? `escrita solo con «$», que para un proveedor de ${countryName} es ${cur}` : `sin moneda escrita junto al total, que para un proveedor de ${countryName} es ${cur}`;
    return pass(`La factura está en ${cur}, la moneda pactada (${how}).`, params);
  }
  if (means == null) {
    return fail(
      `${written}. Para un proveedor de ${countryName} un importe sin moneda no se puede dar por ${cur}: no se puede confirmar que cobre en la moneda pactada.`,
      action,
      params,
    );
  }
  const localName = LOCAL_DOLLAR_NAME[means] ?? means;
  const meaning = bare ? `el «$» es ${localName}` : `un importe sin moneda se entiende en ${localName}`;
  return fail(`${written}. Para un proveedor de ${countryName} ${meaning}, no ${cur}: no se puede confirmar que cobre en la moneda pactada.`, action, params);
}

const acu2: Evaluator = (f, input) => {
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
  if (cur === agreed) {
    // La moneda leída coincide con la pactada, pero ¿la factura la escribe junto al total o solo pone
    // «$»? Para un proveedor de Argentina, «$ 2.800» son pesos: leerlo como USD pagaría mil veces lo
    // cobrado. Registros viejos sin la señal: como antes.
    const signal: unknown = input.reading.signals.currencyOnlyDollarSign;
    if (signal !== true) return pass(`La factura está en ${cur}, la moneda pactada.`, { ...params, currencyOnlyDollarSign: signal === false ? false : null });
    return dollarSignVerdict(cur, f.vendor, input.reading.signals.currencyMarker, params);
  }
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
  return amountEvaluation(a, data, cur, total, ctx);
};

/**
 * Compara el monto de la factura con lo pactado en un acuerdo de la misma moneda: monto fijo con
 * tolerancia, o tarifa × horas (con tarifa y horas en cada línea y dentro del máximo). La usa ACU-3
 * con el acuerdo elegido y DUP-3 con los otros acuerdos a los que la factura podría imputarse.
 */
function amountEvaluation(a: Agreement, data: InvoiceData, cur: string, total: number, ctx: DecisionContext): Evaluation {
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
  // null = el acuerdo no fija máximo (se trata más abajo); otro valor no numérico es un dato corrupto.
  if (a.maxQuantity != null && !isFiniteNumber(a.maxQuantity)) {
    return notEvaluable(
      `El acuerdo por hora «${a.description}» tiene un máximo de horas no válido en la ficha.`,
      "Corregir el máximo de horas pactado en la ficha del proveedor.",
      { agreementId: a.id, kind: a.kind, rate, maxQuantity: String(a.maxQuantity) },
    );
  }
  // Cada línea debe decir cuántas horas y a qué tarifa: sin eso no se puede comprobar
  // «tarifa × cantidad» ni el máximo (una línea sin cantidad podría esconder horas de más).
  const lines = data.lineItems;
  const withoutQuantity = lines.filter((l) => !isFiniteNumber(l.quantity)).length;
  const withoutRate = lines.filter((l) => !isFiniteNumber(l.unitPrice)).length;
  if (lines.length === 0 || withoutQuantity > 0 || withoutRate > 0) {
    const what =
      lines.length === 0
        ? "La factura no detalla las horas ni la tarifa"
        : withoutQuantity > 0
          ? `${withoutQuantity === 1 ? "Una línea" : `${withoutQuantity} líneas`} de la factura no ${withoutQuantity === 1 ? "indica" : "indican"} la cantidad de horas`
          : `${withoutRate === 1 ? "Una línea" : `${withoutRate} líneas`} de la factura no ${withoutRate === 1 ? "indica" : "indican"} la tarifa por hora`;
    return notEvaluable(
      `${what}; no se puede comparar con la tarifa pactada (${money(rate, cur)} por hora).`,
      "Confirmar con el proveedor cuántas horas factura y a qué tarifa.",
      { agreementId: a.id, kind: a.kind, rate, quantity: null, linesWithoutQuantity: withoutQuantity, linesWithoutRate: withoutRate },
    );
  }
  // Suma limpia de ruido de coma flotante (0,1 + 0,2 h son 0,3 h, no 0,30000000000000004).
  const quantity = Number(lines.reduce((sum, l) => sum + (l.quantity ?? 0), 0).toPrecision(12));
  const expected = quantity * rate;
  const expectedCents = roundCents(quantity * toCents(rate));
  const diffCents = Math.abs(totalCents - expectedCents);
  const tolCents = toleranceCents(expectedCents, pct);
  const problems: string[] = [];

  if (lines.some((l) => (l.quantity ?? 0) <= 0)) problems.push("Hay líneas con cantidad de horas cero o negativa");

  const rateCents = toCents(rate);
  // La tarifa de cada línea debe ser exactamente la pactada en centavos, sin fracciones de centavo:
  // 900,004 por hora no es 900 (sus importes ya no salen de cantidad × tarifa pactada). Solo se
  // limpia el ruido de coma flotante (60,01 × 100 = 6000,999999999999 son 6001 centavos).
  const isPactedRate = (unitPrice: number) => Number((unitPrice * 100).toPrecision(15)) === rateCents;
  const wrongRates = unique(lines.filter((l) => !isPactedRate(l.unitPrice ?? 0)).map((l) => money(l.unitPrice ?? 0, cur)));
  if (wrongRates.length > 0) {
    problems.push(`La tarifa facturada (${listEs(wrongRates)} por hora) no es la pactada (${money(rate, cur)} por hora)`);
  }

  const max = a.maxQuantity;
  const overMax = isFiniteNumber(max) && quantity > max;
  const perWhat = a.frequency === "monthly" ? "por mes" : "en total";
  if (overMax) {
    problems.push(`Se facturan ${formatNumber(quantity)} h y el máximo pactado es ${formatNumber(max)} h ${perWhat}`);
  }

  if (diffCents > tolCents) {
    problems.push(
      `${formatNumber(quantity)} h × ${money(rate, cur)} = ${money(expectedCents / 100, cur)}, pero se facturan ${money(total, cur)} (diferencia de ${money(diffCents / 100, cur)}, fuera de la tolerancia de ±${formatPct(pct)})`,
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

  if (max == null) {
    // Sin máximo pactado no se puede comprobar que las horas estén dentro de lo acordado.
    return notEvaluable(
      `${formatNumber(quantity)} h × ${money(rate, cur)} cuadra con lo facturado, pero no se puede comprobar la cantidad: el acuerdo no define un máximo de horas («${a.description}»).`,
      "Confirmar que las horas facturadas estén dentro de lo acordado y registrar en la ficha el máximo de horas del acuerdo.",
      params,
    );
  }

  const maxText = `; máximo pactado ${formatNumber(max)} h ${perWhat}`;
  const match =
    diffCents === 0
      ? "igual a lo facturado"
      : `y se facturan ${money(total, cur)}, dentro de la tolerancia de ±${formatPct(pct)}`;
  return pass(`${formatNumber(quantity)} h × ${money(rate, cur)} = ${money(expectedCents / 100, cur)}, ${match}${maxText}.`, params);
}

// ───────────────────────── Límites y fondo ─────────────────────────

const lim1: Evaluator = (f, _input, ctx) => {
  const usd = f.usd;
  if (!usd.ok) return usdNotEvaluable(usd, f.data?.total);
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
  if (!usd.ok) return usdNotEvaluable(usd, f.data?.total);
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
  // Si `now` o un pago traen zona horaria y en UTC caen en otro mes, el pago cuenta si cae en el mes
  // de `now` según cualquiera de las dos lecturas: ante la duda se suma de más, nunca de menos.
  const nowMonths = instantMonths(ctx.now) ?? [month];
  // Un pago sin fecha válida podría ser de este mes: no se descarta en silencio.
  const undated = f.paid.filter((h) => isoDateOf(h.decidedAt) == null).length;
  if (undated > 0) {
    return notEvaluable(
      `Hay ${undated} pago(s) en el historial sin fecha válida; no se puede calcular lo pagado en ${formatPeriod(month)}.`,
      "Revisar el historial de pagos: hay pagos sin fecha válida.",
      { month, paymentsWithoutDate: undated },
    );
  }
  const unknown = unknownOutcomeText(f);
  if (unknown != null) {
    return notEvaluable(
      `En el historial hay ${unknown}; no se puede calcular lo pagado en ${formatPeriod(month)}.`,
      ACTION_UNKNOWN_OUTCOME,
      { month, decisionsWithUnknownOutcome: f.unknownOutcome.length },
    );
  }
  const inMonth = f.paid.filter((h) => (instantMonths(h.decidedAt) ?? []).some((m) => nowMonths.includes(m)));
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
  if (!usd.ok) return usdNotEvaluable(usd, f.data?.total);
  const rule = ruleValue(ctx, "initialFundUsd");
  if (!rule.ok) return rule.result;
  const unknown = unknownOutcomeText(f);
  if (unknown != null) {
    return notEvaluable(
      `En el historial hay ${unknown}; no se puede calcular el fondo disponible.`,
      ACTION_UNKNOWN_OUTCOME,
      { decisionsWithUnknownOutcome: f.unknownOutcome.length },
    );
  }
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
