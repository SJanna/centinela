/**
 * Hechos derivados de la factura y la ficha de la empresa que usan varias comprobaciones:
 * proveedor emparejado, acuerdo vigente, periodo y monto en USD. Todo puro y determinista.
 */
import {
  legalFormsAfter,
  monthOf,
  normalizeName,
  normalizeTaxId,
  splitLegalForm,
  stripTaxIdLabel,
  taxIdsEquivalent,
  toCents,
} from "../core/normalize";
import type {
  Agreement,
  Company,
  DecisionContext,
  EngineInput,
  Extraction,
  HistoryEntry,
  InvoiceData,
  ReadingAssessment,
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

/**
 * Último día que puede traer una factura como emisión o periodo sin estar en el futuro: el día de
 * `now` (el más tardío entre el escrito y el de UTC) más uno, por las zonas horarias adelantadas.
 * null si `now` no es un instante válido (entonces no se puede saber qué es futuro).
 */
export function latestPlausibleDay(now: unknown): string | null {
  const days = instantDays(now);
  if (days == null) return null;
  const latest = days.written > days.utc ? days.written : days.utc;
  const [y, m, d] = latest.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
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

// ───────────────────────── Banco de la cuenta destino ─────────────────────────

/** Código de ruteo o SWIFT comparable: solo letras y dígitos, en mayúscula. null si no queda nada. */
function routingKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return v.length > 0 ? v : null;
}

const BIC = /^[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/;
const ABA = /^\d{9}$/;

/**
 * ¿Dos códigos bancarios son del mismo banco? "same" si coinciden (dos SWIFT/BIC con los mismos 8
 * primeros caracteres son del mismo banco: «SVBKUS6S» ≡ «SVBKUS6SXXX»); "different" si son del mismo
 * tipo (SWIFT con SWIFT, ruteo ABA con ABA, u otro código con otro) y no coinciden; "unknown" si son
 * de tipos distintos (p. ej. la ficha guarda el ABA y la factura trae el SWIFT): ahí decide el nombre.
 */
export function compareRoutingCodes(a: unknown, b: unknown): "same" | "different" | "unknown" {
  const x = routingKey(a);
  const y = routingKey(b);
  if (x == null || y == null) return "unknown";
  if (x === y) return "same";
  const kind = (v: string) => (BIC.test(v) ? "bic" : ABA.test(v) ? "aba" : "other");
  if (kind(x) !== kind(y)) return "unknown";
  if (kind(x) === "bic" && x.slice(0, 8) === y.slice(0, 8)) return "same";
  return "different";
}

/** Palabras que no distinguen un banco de otro («Banco», «Bank», «S.A.», «de»…). */
const GENERIC_BANK_WORDS: ReadonlySet<string> = new Set([
  "banco", "bank", "bco", "banca", "de", "del", "la", "el", "los", "las", "the", "of", "and", "y", "e", "do", "da",
  "dos", "das", "sa", "na", "n", "a", "s", "ltd", "ltda", "plc", "inc", "corp", "co", "company", "trust",
  "nacional", "national", "grupo", "group", "financiero", "financial", "multiple", "institucion",
]);
const CONNECTORS: ReadonlySet<string> = new Set(["de", "del", "la", "el", "los", "las", "the", "of", "and", "y", "e", "do", "da", "dos", "das"]);

function bankWords(raw: string): string[] {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\./g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0);
}

/**
 * ¿Dos nombres de banco pueden ser el mismo banco? Comparación tolerante a propósito (el lector
 * escribe el nombre de mil formas): sí si comparten una palabra distintiva («Itaú Unibanco» y
 * «Banco Itaú»), si una contiene a la otra sin espacios («JPMorgan» y «J.P. Morgan») o si una es la
 * sigla de la otra («BCP» y «Banco de Crédito del Perú», «SVB» y «Silicon Valley Bank»). No:
 * «Banco Pirata Internacional» y «Silicon Valley Bank». Un nombre ausente no se compara (true).
 */
export function bankNamesMayMatch(a: unknown, b: unknown): boolean {
  if (typeof a !== "string" || typeof b !== "string") return true;
  const wa = bankWords(a);
  const wb = bankWords(b);
  if (wa.length === 0 || wb.length === 0) return true;
  const sa = wa.filter((w) => !GENERIC_BANK_WORDS.has(w));
  const sb = wb.filter((w) => !GENERIC_BANK_WORDS.has(w));
  if (sa.length === 0 || sb.length === 0) return wa.join("") === wb.join("");
  if (sa.some((w) => sb.includes(w))) return true;
  const ca = sa.join("");
  const cb = sb.join("");
  if (ca.includes(cb) || cb.includes(ca)) return true;
  const acronym = (words: string[]) => words.filter((w) => !CONNECTORS.has(w)).map((w) => w[0]).join("");
  return (sa.length === 1 && acronym(wb) === sa[0]) || (sb.length === 1 && acronym(wa) === sb[0]);
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

/**
 * Mes facturado: servicePeriod; si la factura no lo trae, el mes al que el documento se refiere sin
 * lugar a dudas (`impliedPeriod`, de documentPeriodReference: «servicios del mes anterior» emitida en
 * noviembre → octubre); si tampoco, el mes de la fecha de referencia.
 */
export type BilledPeriod =
  | { ok: true; period: string; source: BilledPeriodSource }
  | { ok: false; reason: "invalid_service_period" | "no_date" };

export function billedPeriodOf(data: InvoiceData, referenceDate: string | null, impliedPeriod?: string | null): BilledPeriod {
  if (!isAbsent(data.servicePeriod)) {
    const period = periodOf(data.servicePeriod);
    return period != null ? { ok: true, period, source: "service_period" } : { ok: false, reason: "invalid_service_period" };
  }
  const implied = impliedPeriod != null && /^\d{4}-(0[1-9]|1[0-2])$/.test(impliedPeriod) ? impliedPeriod : null;
  const day = calendarDate(referenceDate);
  if (day == null) return { ok: false, reason: "no_date" };
  return implied != null ? { ok: true, period: implied, source: "document_reference" } : { ok: true, period: monthOf(day), source: "reference_date" };
}

/**
 * De dónde salió el mes facturado: "service_period" el periodo de servicio de la factura;
 * "document_reference" el mes al que el documento se refiere sin escribirlo como periodo («servicios
 * del mes anterior»); "reference_date" el mes de la fecha de referencia (emisión, o hoy).
 */
export type BilledPeriodSource = "service_period" | "document_reference" | "reference_date";

/** Mes anterior a un periodo "YYYY-MM" ya validado ("2026-01" → "2025-12"). */
export function previousPeriod(period: string): string {
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  return month > 1 ? `${period.slice(0, 4)}-${String(month - 1).padStart(2, "0")}` : `${String(year - 1).padStart(4, "0")}-12`;
}

/** Una referencia del documento (o de una lectura) a un mes anterior al de su fecha. */
export interface PeriodHint {
  /** El mes al que apunta (YYYY-MM), anterior al de la fecha. */
  month: string;
  /** El fragmento citado, o null si no hay (se supone el mes anterior sin haberlo leído). */
  text: string | null;
  /** true si es «el mes anterior» (sin nombre); false si nombra el mes. */
  relative: boolean;
  /** Dónde apareció: el texto del documento, una línea leída o la nota de una lectura. */
  source: "document" | "line_item" | "reader_note";
  readerId: string | null;
}

/**
 * Qué dice el documento sobre el mes que cobra cuando no trae periodo de servicio (señal
 * earlierPeriodMarkers, src/extract/period-markers.ts), frente al mes de su fecha:
 * - "none": no se refiere a ningún mes anterior (y se revisó el texto del documento): cobra el de su fecha;
 * - "single": todas las referencias apuntan a un mismo mes anterior y lo dice el texto del documento,
 *   o las dos lecturas: el pago se imputa a ese mes;
 * - "ambiguous": apuntan a varios meses, o solo una lectura lo dice: no se sabe a qué mes imputarlo;
 * - "unchecked": no se pudo revisar (sin la señal: registros viejos): puede cobrar el mes anterior.
 * En una imagen o un PDF sin texto la señal sale solo de las líneas y las notas de las lecturas; no se
 * supone el mes anterior (en el set de estrés escalaba 6 facturas mensuales legítimas: S0043, S0528,
 * S0597, S0629, S0926 y S1925).
 */
export type DocumentPeriodReference =
  | { kind: "none" }
  | { kind: "unchecked" }
  | { kind: "single"; period: string; hints: PeriodHint[] }
  | { kind: "ambiguous"; reason: "several_months" | "one_reading"; periods: string[]; hints: PeriodHint[] };

const HINT_SOURCES = ["document", "line_item", "reader_note"] as const;

/** Las referencias ordenadas para citar: primero el documento, luego las líneas, al final las notas. */
export function sortHints(hints: readonly PeriodHint[]): PeriodHint[] {
  return [...hints].sort((a, b) => HINT_SOURCES.indexOf(a.source) - HINT_SOURCES.indexOf(b.source));
}

/**
 * Ubica cada marca de la señal contra el mes de la fecha (`dateMonth`) y decide si el documento se
 * refiere sin lugar a dudas a un mes anterior. Una marca con un mes inválido se toma como «el mes
 * anterior» (ante la duda, no se descarta); las que caen en el mes de la fecha o después no cuentan.
 */
export function documentPeriodReference(reading: ReadingAssessment, dateMonth: string): DocumentPeriodReference {
  const markers: unknown = reading.signals.earlierPeriodMarkers;
  if (!Array.isArray(markers)) return { kind: "unchecked" };
  const previous = previousPeriod(dateMonth);
  const hints: PeriodHint[] = [];
  for (const raw of markers as unknown[]) {
    if (raw == null || typeof raw !== "object") {
      hints.push({ month: previous, text: null, relative: true, source: "reader_note", readerId: null });
      continue;
    }
    const m = raw as { text?: unknown; period?: unknown; month?: unknown; source?: unknown; readerId?: unknown };
    const text = typeof m.text === "string" && m.text.trim() !== "" ? m.text.trim() : null;
    const source = HINT_SOURCES.find((s) => s === m.source) ?? "reader_note";
    const readerId = typeof m.readerId === "string" && m.readerId.trim() !== "" ? m.readerId.trim() : null;
    let month: string;
    let relative = false;
    const named = typeof m.period === "string" ? /^\d{4}-(0[1-9]|1[0-2])$/.test(m.period.trim()) ? m.period.trim() : null : null;
    if (named != null) month = named;
    else if (m.period == null && typeof m.month === "number" && Number.isInteger(m.month) && m.month >= 1 && m.month <= 12) {
      // Mes sin año y sin fecha de emisión: la última vez que cayó antes del mes de la fecha.
      const year = Number(dateMonth.slice(0, 4));
      const current = Number(dateMonth.slice(5, 7));
      if (m.month === current) continue;
      month = `${m.month < current ? year : year - 1}-${String(m.month).padStart(2, "0")}`;
    } else {
      month = previous;
      relative = true;
    }
    if (month >= dateMonth) continue;
    hints.push({ month, text, relative, source, readerId });
  }
  if (hints.length === 0) return { kind: "none" };
  const sorted = sortHints(hints);
  const periods = Array.from(new Set(sorted.map((h) => h.month))).sort().reverse();
  if (periods.length > 1) return { kind: "ambiguous", reason: "several_months", periods, hints: sorted };
  const fromDocument = sorted.some((h) => h.source === "document");
  const readers = new Set(sorted.filter((h) => h.source !== "document" && h.readerId != null).map((h) => h.readerId));
  if (fromDocument || readers.size >= 2) return { kind: "single", period: periods[0], hints: sorted };
  return { kind: "ambiguous", reason: "one_reading", periods, hints: sorted };
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
  | "period_outside"
  /** La fecha de emisión es posterior a hoy (más un día de margen por zona horaria). */
  | "future_date"
  /** El periodo facturado es un mes que todavía no empieza (cobro por adelantado). */
  | "future_period";

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
   * De dónde salió billedPeriod: "service_period" si la factura dice qué mes cobra;
   * "document_reference" si el documento se refiere a ese mes sin escribirlo como periodo (`impliedPeriod`);
   * "reference_date" si se dedujo del mes de la fecha de referencia (emisión, o hoy si no hay emisión).
   * null sin periodo.
   */
  billedPeriodSource: BilledPeriodSource | null;
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
 * el de la moneda de la factura; si sigue el empate, el primero de la ficha. Con `now` válido, una
 * emisión posterior a hoy (+1 día) da "future_date" y un mes facturado posterior al actual,
 * "future_period"; sin `now` no se revisa.
 */
export function selectAgreement(
  vendor: Vendor,
  data: InvoiceData,
  now?: string | null,
  impliedPeriod?: string | null,
): AgreementSelection {
  const base = {
    agreement: null,
    referenceDate: null,
    referenceSource: null,
    billedPeriod: null,
    billedPeriodSource: null,
    closest: null,
    candidates: [],
  };
  if (vendor.agreements.length === 0) return { ...base, status: "no_agreements" };
  const ref = referenceDateOf(data, now);
  if (!ref.ok) return { ...base, status: ref.reason === "invalid_issue_date" ? "invalid_date" : "no_date" };
  const referenceDate = ref.date;
  const dated = { ...base, referenceDate, referenceSource: ref.source };
  // Una factura fechada en el futuro, o que cobra un mes que todavía no empieza, no se paga sola:
  // la vigencia se mediría con una fecha que aún no llegó y se pagaría un servicio no prestado.
  const latest = latestPlausibleDay(now);
  if (latest != null && referenceDate > latest) return { ...dated, status: "future_date" };

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

  const billed = billedPeriodOf(data, referenceDate, impliedPeriod);
  if (!billed.ok) return { ...dated, status: "invalid_period" };
  const billedAt = { ...dated, billedPeriod: billed.period, billedPeriodSource: billed.source };
  if (latest != null && billed.period > monthOf(latest)) return { ...billedAt, status: "future_period" };
  const currency = normalizeCurrency(data.currency);
  const covering = valid.filter((a) => agreementCoversPeriod(a, billed.period));
  if (covering.length === 0) {
    return { ...billedAt, status: "period_outside", closest: preferCurrency(valid, currency) };
  }
  return {
    ...billedAt,
    status: "selected",
    agreement: preferCurrency(covering, currency),
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

// ───────────────────────── Destinatario de la factura ─────────────────────────

/** La empresa compradora: a nombre de quién deben venir las facturas. */
export interface BuyerIdentity {
  /** Cómo se nombra en las explicaciones («Andes Labs Inc.»). */
  displayName: string;
  /** Nombres sin forma societaria (`splitLegalForm`) de razones sociales y alias, incluido `company.name`. */
  nameKeys: ReadonlySet<string>;
  /**
   * Formas societarias registradas para cada nombre («andes labs» → {"inc", ""}: «Andes Labs Inc.» y el
   * alias «Andes Labs»). Una factura con otra forma («Andes Labs S.A.S.») es otra razón social.
   */
  forms: ReadonlyMap<string, ReadonlySet<string>>;
  /** Ids tributarios registrados, tal como están en la ficha (vacío si no hay). */
  taxIds: readonly string[];
}

function stringsOf(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [];
}

/**
 * Identidad de la compradora según la ficha: `company.buyer` (razones sociales, alias, ids tributarios)
 * más `company.name`. Sin bloque `buyer` (p. ej. la empresa guardada en la base, que hoy solo guarda
 * nombre y reglas) queda solo el nombre y ningún id tributario con qué comparar.
 */
export function buyerIdentity(company: Company): BuyerIdentity {
  const buyer: unknown = company?.buyer;
  const b = buyer != null && typeof buyer === "object" ? (buyer as Record<string, unknown>) : {};
  const legalNames = stringsOf(b.legalNames);
  const name = typeof company?.name === "string" ? company.name.trim() : "";
  const names = [...legalNames, ...(name ? [name] : []), ...stringsOf(b.aliases)];
  const forms = new Map<string, Set<string>>();
  for (const n of names) {
    const parts = splitLegalForm(n);
    if (parts == null) continue;
    const set = forms.get(parts.base) ?? new Set<string>();
    set.add(parts.form);
    forms.set(parts.base, set);
  }
  return { displayName: legalNames[0]?.trim() || name || "la empresa", nameKeys: new Set(forms.keys()), forms, taxIds: stringsOf(b.taxIds) };
}

/**
 * Lo que un lector escribe a veces en vez de dejar el dato vacío («N/A», «—», «Sin dato»): cuenta como
 * dato ausente. Forma canónica: minúsculas, solo letras y dígitos ASCII, sin tildes.
 */
const BILL_TO_PLACEHOLDERS: ReadonlySet<string> = new Set([
  "na", "nd", "sn", "none", "null", "nil", "unknown", "ninguno", "ninguna", "desconocido", "desconocida", "noaplica",
  "noindica", "noaparece", "nodisponible", "noespecificado", "noespecificada", "sindato", "sindatos", "notavailable",
  "notprovided", "notapplicable", "notspecified",
]);

/**
 * Texto presente del destinatario. Para el destinatario, «ausente» es lo que deja pagar: solo cuenta
 * como ausente lo que no tiene ninguna letra ni dígito, de ningún alfabeto («—», «-»), o un relleno
 * conocido («N/A»). Un nombre en cirílico, griego, chino o con letras de ancho completo SÍ es un
 * destinatario (y, como no es la compradora, escala).
 */
function presentText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (!/[\p{L}\p{N}]/u.test(v)) return null;
  const canon = v.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return BILL_TO_PLACEHOLDERS.has(canon) ? null : v;
}

/**
 * Frases que ponen a un tercero junto al destinatario: «Pampa Labs c/o Andes Labs Inc.», «Andes Labs
 * Inc. por cuenta de Pampa Labs», «care of», «on behalf of», «aos cuidados de», «por conta de». Con
 * ellas no se puede saber de quién es la factura. «A nombre de» no cuenta (es la forma normal de decir
 * a quién se factura).
 */
const INTERMEDIARY =
  /(?:^|[^\p{L}\p{N}])(?:c\s*\/\s*o|(?:in\s+)?care\s+of|on\s+behalf\s+of|por\s+cuenta\s+(?:y\s+orden\s+)?de|en\s+nombre\s+y\s+por\s+cuenta\s+de|en\s+representacion\s+de|aos\s+cuidados\s+de|por\s+conta\s+(?:e\s+ordem\s+)?de)(?![\p{L}\p{N}])/u;

function namesIntermediary(text: string | null): boolean {
  return text != null && INTERMEDIARY.test(text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase());
}

/** A quién dice una lectura que va dirigida la factura. */
export interface BillTo {
  name: string | null;
  taxId: string | null;
  /** Cita del id tributario (de ahí sale su etiqueta: «NIT 901.888.123-4»). */
  taxIdEvidence: string | null;
  /** Cita del nombre. */
  nameEvidence: string | null;
  /** false si la lectura marcó el nombre o el id como ilegibles. */
  legible: boolean;
  source: "primary" | "secondary";
}

export type BillToVerdict =
  /** Ninguna lectura dice a quién va dirigida (común en correos y chats): no se penaliza. */
  | { status: "absent" }
  /** Va dirigida a la compradora (nombre o alias y, si trae id y la ficha tiene ids, también el id). */
  | { status: "buyer"; billTo: BillTo }
  /**
   * Va dirigida a otra empresa: otro nombre, otra forma societaria («Andes Labs S.A.S.»: otra razón
   * social), u otro id tributario aunque el nombre sea el mismo. `shown`: la cita que lo muestra, si
   * el valor leído no lo dice (una lectura que escribió «Andes Labs» y citó «Andes Labs S.A.S.»).
   */
  | { status: "other_company"; billTo: BillTo; reason: "name" | "legal_form" | "tax_id"; shown?: string }
  /** El destinatario viene con un tercero («c/o», «por cuenta de»): no se sabe de quién es la factura. */
  | { status: "ambiguous"; billTo: BillTo; shown: string }
  /** La lectura dice que hay destinatario pero lo marca como ilegible. */
  | { status: "unreadable"; billTo: BillTo }
  /** Trae solo un id tributario y la ficha no tiene ids con qué compararlo. */
  | { status: "unverifiable"; billTo: BillTo };

function billToOf(e: Extraction | null, data: InvoiceData | null, source: BillTo["source"]): BillTo | null {
  if (e == null && data == null) return null;
  const nameField = e?.billToName;
  const taxField = e?.billToTaxId;
  const name = presentText(data != null && data.billToName !== undefined ? data.billToName : nameField?.value);
  const taxId = presentText(data != null && data.billToTaxId !== undefined ? data.billToTaxId : taxField?.value);
  const nameEvidence = presentText(nameField?.evidence);
  const taxIdEvidence = presentText(taxField?.evidence);
  // Ilegible si la lectura trae el campo y no lo marca como legible, aunque no traiga valor ni cita: el
  // prompt pide found = true, value "" y legible = false para un destinatario que está pero no se lee
  // (un dato ausente viene con legible = true).
  const doubtful = (f: { legible?: unknown } | undefined) => f != null && f.legible !== true;
  const legible = !doubtful(nameField) && !doubtful(taxField);
  return { name, taxId, nameEvidence, taxIdEvidence, legible, source };
}

/** ¿El nombre es de la compradora? «Andes Labs» (sin forma) o con una forma registrada para ese nombre. */
function nameMatch(name: string, buyer: BuyerIdentity): "buyer" | "legal_form" | "other" {
  const parts = splitLegalForm(name);
  const forms = parts != null ? buyer.forms.get(parts.base) : undefined;
  if (parts == null || forms == null) return "other";
  return parts.form === "" || forms.has(parts.form) ? "buyer" : "legal_form";
}

/**
 * ¿La cita del nombre muestra a la compradora con una forma societaria que no es la suya? Una lectura
 * puede escribir «Andes Labs» y citar «Cliente: Andes Labs S.A.S.».
 */
function evidenceShowsOtherForm(evidence: string | null, buyer: BuyerIdentity): boolean {
  if (evidence == null) return false;
  for (const [base, forms] of buyer.forms) {
    if (legalFormsAfter(evidence, base).some((f) => f !== "" && !forms.has(f))) return true;
  }
  return false;
}

function judgeBillTo(b: BillTo, buyer: BuyerIdentity): BillToVerdict {
  if (!b.legible) return { status: "unreadable", billTo: b };
  if (b.name == null && b.taxId == null) return { status: "absent" };
  const match = b.name != null ? nameMatch(b.name, buyer) : null;
  if (b.taxId != null) {
    if (buyer.taxIds.length > 0) {
      const own = stripTaxIdLabel(b.taxId);
      if (!buyer.taxIds.some((t) => taxIdsEquivalent(own, t))) {
        return { status: "other_company", billTo: b, reason: match === "buyer" ? "tax_id" : match === "legal_form" ? "legal_form" : "name" };
      }
    } else if (b.name == null) {
      return { status: "unverifiable", billTo: b };
    }
  }
  if (match === "other") return { status: "other_company", billTo: b, reason: "name" };
  if (match === "legal_form") return { status: "other_company", billTo: b, reason: "legal_form" };
  if (evidenceShowsOtherForm(b.nameEvidence, buyer)) {
    return { status: "other_company", billTo: b, reason: "legal_form", shown: b.nameEvidence ?? undefined };
  }
  if (namesIntermediary(b.name) || namesIntermediary(b.nameEvidence)) {
    return { status: "ambiguous", billTo: b, shown: namesIntermediary(b.nameEvidence) ? b.nameEvidence! : b.name! };
  }
  return { status: "buyer", billTo: b };
}

/**
 * ¿A quién va dirigida la factura, según las dos lecturas? Corresponde a la compradora si el nombre
 * es una de sus razones sociales o alias —sin forma societaria («Andes Labs») o con una forma
 * registrada para ese nombre («Andes Labs, Inc.»); otra forma («Andes Labs S.A.S.», «Andes Labs LLC»)
 * es otra razón social— Y, si trae id tributario y la ficha tiene ids, ese id es uno de los suyos (sin
 * etiqueta y sin dígito de verificación separado). Un id distinto basta para que no corresponda aunque
 * el nombre sea igual. Se revisan la lectura principal y la segunda: basta que UNA diga otra empresa, un
 * tercero junto al destinatario («c/o») o un destinatario ilegible para no darlo por bueno. Sin
 * destinatario en ninguna lectura no se penaliza.
 */
export function judgeBillToOfReadings(input: EngineInput, company: Company): BillToVerdict {
  const r = input.reading;
  const primary = r.primary?.ok ? r.primary.extraction : null;
  const secondary = r.secondary?.ok ? r.secondary.extraction : null;
  const buyer = buyerIdentity(company);
  const verdicts = [billToOf(primary, r.data, "primary"), billToOf(secondary, null, "secondary")]
    .filter((b): b is BillTo => b != null)
    .map((b) => judgeBillTo(b, buyer));
  for (const status of ["other_company", "ambiguous", "unreadable", "unverifiable", "buyer"] as const) {
    const found = verdicts.find((v) => v.status === status);
    if (found) return found;
  }
  return { status: "absent" };
}

export interface Facts {
  data: InvoiceData | null;
  match: VendorMatch | null;
  vendor: Vendor | null;
  selection: AgreementSelection | null;
  agreement: Agreement | null;
  /** YYYY-MM del acuerdo mensual, o null (pago único o sin dato). */
  period: string | null;
  /**
   * De dónde salió `period` (null si no hay): "service_period" si la factura dice qué mes cobra;
   * "document_reference" si el documento se refiere sin lugar a dudas a un mes anterior al de su fecha
   * («servicios del mes anterior»): se imputa a ese mes; "reference_date" si es el mes de la fecha de
   * emisión (o de hoy).
   */
  periodSource: BilledPeriodSource | null;
  /**
   * Solo si la factura NO trae periodo de servicio y se pudo fechar: el mes de su fecha de referencia y
   * lo que dice el documento de otro mes (documentPeriodReference). DUP-3 revisa con esto que ningún
   * mes que la factura pueda estar cobrando ya se haya pagado. null en otro caso.
   */
  inferred: { dateMonth: string; reference: DocumentPeriodReference } | null;
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
  /** A quién va dirigida la factura comparado con la empresa compradora (ACU-1). */
  billTo: BillToVerdict;
  /** La empresa compradora según la ficha. */
  buyer: BuyerIdentity;
}

const KNOWN_OUTCOMES: readonly unknown[] = ["PAGAR", "FRENAR", "ESCALAR"];

export function buildFacts(input: EngineInput, ctx: DecisionContext): Facts {
  const data = input.reading.data;
  const match = data != null ? matchVendor(data, ctx.company.vendors) : null;
  const vendor = match?.vendor ?? null;
  let selection = data != null && vendor != null ? selectAgreement(vendor, data, ctx.now) : null;
  // Sin periodo escrito, el mes se deduce. Si el documento se refiere sin lugar a dudas a un mes
  // anterior al de su fecha («servicios del mes anterior»), el acuerdo mensual se revisa y se imputa
  // con ese mes: registrarlo con el mes de la fecha dejaría el mes de verdad libre para otra factura.
  let inferred: Facts["inferred"] = null;
  if (data != null && vendor != null && selection != null && selection.billedPeriodSource === "reference_date" && selection.billedPeriod != null) {
    inferred = { dateMonth: selection.billedPeriod, reference: documentPeriodReference(input.reading, selection.billedPeriod) };
    const ref = inferred.reference;
    if (ref.kind === "single" && selection.agreement != null && selection.agreement.frequency !== "once") {
      selection = selectAgreement(vendor, data, ctx.now, ref.period);
    }
  }
  const agreement = selection?.agreement ?? null;
  const period = agreement != null && agreement.frequency !== "once" ? (selection?.billedPeriod ?? null) : null;
  return {
    data,
    match,
    vendor,
    selection,
    agreement,
    period,
    periodSource: period != null ? (selection?.billedPeriodSource ?? null) : null,
    inferred,
    currency: normalizeCurrency(data?.currency),
    usd: computeUsdAmount(data, ctx.company.rules),
    paid: ctx.history.filter((h) => h.outcome === "PAGAR"),
    unknownOutcome: ctx.history.filter((h) => !KNOWN_OUTCOMES.includes(h.outcome)),
    billTo: data != null ? judgeBillToOfReadings(input, ctx.company) : { status: "absent" },
    buyer: buyerIdentity(ctx.company),
  };
}
