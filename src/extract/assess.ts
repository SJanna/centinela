/**
 * Verificación de lecturas (código, sin modelo): compara las dos lecturas, revisa la aritmética,
 * comprueba que las citas existan en el texto plano y corre el detector de instrucciones.
 */
import {
  CRITICAL_FIELDS,
  ExtractionSchema,
  type CriticalField,
  type Extraction,
  type InvoiceData,
  type NormalizedDoc,
  type Reader,
  type ReaderResult,
  type ReadingAssessment,
  type ReadingSignals,
} from "../core/schemas";
import { formatMoney, normalizeAccount, normalizeName, toCents } from "../core/normalize";
import { detectSuspiciousInstructions } from "./heuristics";

export const SECOND_READING_UNAVAILABLE = "segunda_lectura_no_disponible";
/** Clave en readersDisagreeOn cuando las dos lecturas imputan la factura a meses distintos. */
export const PERIOD_DISAGREEMENT = "periodo";

// ───────────────────────── Normalización ─────────────────────────

function cleanText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const v = value.trim();
  return v.length > 0 ? v : null;
}

export function normalizeCurrency(value: string | null | undefined): string | null {
  if (value == null) return null;
  const v = value.toUpperCase().replace(/\s+/g, "");
  return v.length > 0 ? v : null;
}

/** Número de factura comparable: solo letras y dígitos, en mayúscula. "fv-0012" → "FV0012". */
export function normalizeInvoiceNumber(value: string | null | undefined): string | null {
  if (value == null) return null;
  const v = value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return v.length > 0 ? v : null;
}

function finiteOrNull(value: number | null): number | null {
  return value != null && Number.isFinite(value) ? value : null;
}

/**
 * Lo que un lector a veces escribe en vez de null («N/A», «—», «S/N», «Sin número»…), en forma
 * canónica. En un campo crítico cuenta como dato ausente: sin el dato nunca se paga.
 */
const PLACEHOLDERS = new Set([
  "na", "nd", "sn", "none", "null", "nil", "unknown", "ninguno", "ninguna", "desconocido", "desconocida",
  "noaplica", "noindica", "noaparece", "nodisponible", "noespecificado", "noespecificada", "noinformado",
  "sinnumero", "sindato", "sindatos", "notavailable", "notprovided", "notapplicable", "notspecified",
]);

function isPlaceholder(value: string): boolean {
  const canon = canonicalText(value);
  return canon.length === 0 || PLACEHOLDERS.has(canon);
}

/** Texto de un campo crítico: con trim y null si es un relleno sin letras ni dígitos o tipo «N/A». */
function criticalText(value: string | null | undefined): string | null {
  const v = cleanText(value);
  return v == null || isPlaceholder(v) ? null : v;
}

export function toInvoiceData(e: Extraction): InvoiceData {
  return {
    documentType: e.documentType,
    vendorName: criticalText(e.vendorName.value),
    vendorTaxId: cleanText(e.vendorTaxId.value),
    invoiceNumber: criticalText(e.invoiceNumber.value),
    issueDate: cleanText(e.issueDate.value),
    dueDate: cleanText(e.dueDate.value),
    servicePeriod: cleanText(e.servicePeriod.value),
    currency: normalizeCurrency(criticalText(e.currency.value)),
    subtotal: finiteOrNull(e.subtotal.value),
    tax: finiteOrNull(e.tax.value),
    total: finiteOrNull(e.total.value),
    lineItems: e.lineItems.map((line) => ({ ...line, description: line.description.trim() })),
    beneficiaryName: cleanText(e.payment.beneficiaryName.value),
    bankName: cleanText(e.payment.bankName.value),
    accountNumber: normalizeAccount(criticalText(e.payment.accountNumber.value)),
    routingOrSwift: cleanText(e.payment.routingOrSwift.value),
  };
}

interface AnyField {
  value: string | number | null;
  evidence: string | null;
  legible: boolean;
}

function criticalField(e: Extraction, field: CriticalField): AnyField {
  switch (field) {
    case "vendorName":
      return e.vendorName;
    case "invoiceNumber":
      return e.invoiceNumber;
    case "currency":
      return e.currency;
    case "total":
      return e.total;
    case "accountNumber":
      return e.payment.accountNumber;
  }
}

function dataValue(data: InvoiceData, field: CriticalField): string | number | null {
  return data[field];
}

/** Valor de un campo crítico listo para comparar entre lecturas. */
function comparable(e: Extraction | null, field: CriticalField): string | null {
  if (!e) return null;
  switch (field) {
    case "vendorName":
      return normalizeName(e.vendorName.value);
    case "invoiceNumber":
      return normalizeInvoiceNumber(e.invoiceNumber.value);
    case "currency":
      return normalizeCurrency(e.currency.value);
    case "total": {
      const total = finiteOrNull(e.total.value);
      return total == null ? null : String(toCents(total));
    }
    case "accountNumber":
      return normalizeAccount(e.payment.accountNumber.value);
  }
}

// ───────────────────────── Señales ─────────────────────────

/** "YYYY-MM" (mes 01–12) o el mes de una fecha "YYYY-MM-DD" válida; cualquier otra cosa → null. */
function monthOfText(value: string | null | undefined): string | null {
  const v = value?.trim() ?? "";
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) return v;
  const m = /^(\d{4})-(0[1-9]|1[0-2])-(\d{2})$/.exec(v);
  if (!m) return null;
  const day = Number(m[3]);
  const daysInMonth = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
  return day >= 1 && day <= daysInMonth ? `${m[1]}-${m[2]}` : null;
}

/**
 * Mes facturado según una lectura: su servicePeriod o, si no lo trae, el mes de su issueDate.
 * null si la lectura no permite saberlo (incluido un servicePeriod escrito que no es un mes válido).
 */
export function billedPeriodOfReading(e: Extraction | null): string | null {
  if (!e) return null;
  const service = cleanText(e.servicePeriod?.value);
  if (service != null) return monthOfText(service);
  return monthOfText(cleanText(e.issueDate?.value));
}

/**
 * Periodo de una lectura para comparar con la otra: el mes (YYYY-MM) si se puede saber; si la
 * lectura SÍ trae el dato (servicePeriod o, sin él, issueDate) pero no es un mes o fecha válidos
 * («octubre 2026», «05/10/2026»), su texto canónico marcado como no confirmable; null si no lo trae.
 */
function periodKeyOfReading(e: Extraction | null): string | null {
  if (!e) return null;
  const written = cleanText(e.servicePeriod?.value) ?? cleanText(e.issueDate?.value);
  if (written == null) return null;
  return billedPeriodOfReading(e) ?? `sin-confirmar:${canonicalText(written)}`;
}

/**
 * LEC-2: campos críticos en que las lecturas no coinciden y, además, "periodo" si las dos lecturas
 * imputan la factura a meses distintos (servicePeriod, o el mes de issueDate si no hay). Si una de
 * las dos no trae el dato, eso no cuenta como desacuerdo; si lo trae escrito de una forma que no es
 * un mes válido, no confirma el de la otra y sí cuenta (salvo que las dos digan exactamente lo mismo).
 */
export function compareReadings(primary: ReaderResult, secondary: ReaderResult | null): string[] {
  if (!secondary || !secondary.ok) return [SECOND_READING_UNAVAILABLE];
  const a = primary.ok ? primary.extraction : null;
  const b = secondary.extraction;
  const out: string[] = CRITICAL_FIELDS.filter((field) => comparable(a, field) !== comparable(b, field));
  const periodA = periodKeyOfReading(a);
  const periodB = periodKeyOfReading(b);
  if (periodA != null && periodB != null && periodA !== periodB) out.push(PERIOD_DISAGREEMENT);
  return out;
}

const CENT_TOLERANCE = 1;

function formatQuantity(n: number): string {
  return new Intl.NumberFormat("es-CO", { maximumFractionDigits: 4 }).format(n);
}

function money(amount: number, currency: string | null): string {
  if (currency) return formatMoney(amount, currency);
  return new Intl.NumberFormat("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
}

function shorten(s: string, max = 60): string {
  const v = s.replace(/\s+/g, " ").trim();
  return v.length > max ? `${v.slice(0, max - 1)}…` : v;
}

/** LEC-3: problemas aritméticos de la lectura (tolerancia de 1 centavo). Mensajes en español. */
export function arithmeticIssues(data: InvoiceData): string[] {
  const issues: string[] = [];
  const cur = data.currency;
  const lines = data.lineItems;
  const differs = (aCents: number, bCents: number) => Math.abs(aCents - bCents) > CENT_TOLERANCE;

  lines.forEach((line, i) => {
    if (line.quantity == null || line.unitPrice == null) return;
    const expected = line.quantity * line.unitPrice;
    if (differs(toCents(expected), toCents(line.amount))) {
      const label = line.description ? ` («${shorten(line.description)}»)` : "";
      issues.push(
        `Línea ${i + 1}${label}: ${formatQuantity(line.quantity)} × ${money(line.unitPrice, cur)} = ${money(expected, cur)}, pero la línea dice ${money(line.amount, cur)}.`,
      );
    }
  });

  const linesCents = lines.reduce((sum, line) => sum + toCents(line.amount), 0);
  const taxCents = data.tax == null ? 0 : toCents(data.tax);

  if (data.subtotal != null) {
    const subtotalCents = toCents(data.subtotal);
    if (lines.length > 0 && differs(linesCents, subtotalCents)) {
      issues.push(`Las líneas suman ${money(linesCents / 100, cur)}, pero el subtotal dice ${money(data.subtotal, cur)}.`);
    }
    if (data.total != null && differs(subtotalCents + taxCents, toCents(data.total))) {
      const expected = (subtotalCents + taxCents) / 100;
      issues.push(
        data.tax == null
          ? `El subtotal es ${money(data.subtotal, cur)} y no hay impuestos, pero el total dice ${money(data.total, cur)}.`
          : `Subtotal ${money(data.subtotal, cur)} + impuestos ${money(data.tax, cur)} = ${money(expected, cur)}, pero el total dice ${money(data.total, cur)}.`,
      );
    }
  } else if (lines.length > 0 && data.total != null && differs(linesCents + taxCents, toCents(data.total))) {
    const expected = (linesCents + taxCents) / 100;
    issues.push(
      data.tax == null
        ? `Las líneas suman ${money(linesCents / 100, cur)}, pero el total dice ${money(data.total, cur)}.`
        : `Las líneas suman ${money(linesCents / 100, cur)} y con impuestos de ${money(data.tax, cur)} dan ${money(expected, cur)}, pero el total dice ${money(data.total, cur)}.`,
    );
  }

  return issues;
}

const INSTRUCTION_WITHOUT_QUOTE = "(el lector reportó una instrucción sin citar el texto)";

/** LEC-4: instrucciones reportadas por los lectores + detector por patrones, sin duplicados. */
export function collectSuspiciousInstructions(
  doc: NormalizedDoc,
  readings: Array<ReaderResult | null>,
): ReadingSignals["suspiciousInstructions"] {
  const out: ReadingSignals["suspiciousInstructions"] = [];
  const seen = new Set<string>();
  const push = (text: string, source: "model" | "heuristic", reason: string) => {
    // Una instrucción reportada sin cita se conserva: descartarla dejaría pasar LEC-4.
    const t = text.replace(/\s+/g, " ").trim() || INSTRUCTION_WITHOUT_QUOTE;
    const key = `${source}|${t.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ text: t, source, reason: reason.trim() || "Instrucción detectada por el lector" });
  };

  for (const reading of readings) {
    if (!reading?.ok) continue;
    for (const item of reading.extraction.embeddedInstructions) push(item.text, "model", item.reason);
  }
  if (doc.plainText) {
    for (const item of detectSuspiciousInstructions(doc.plainText)) push(item.text, "heuristic", item.reason);
  }
  return out;
}

/** Forma canónica para buscar citas: NFKD, sin tildes, minúsculas, solo letras y dígitos. */
export function canonicalText(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function collapsedLower(s: string): string {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, "");
}

/** Cómo se suele escribir cada moneda (además del código), para no exigir el código literal. */
const CURRENCY_ALIASES: Record<string, string[]> = {
  USD: ["us$", "u$s", "dolar", "dollar"],
  COP: ["peso", "col$"],
  MXN: ["peso", "mx$"],
  CLP: ["peso", "clp$"],
  ARS: ["peso", "ar$"],
  BRL: ["r$", "real", "reais"],
  PEN: ["s/", "sol"],
  EUR: ["€", "euro"],
};

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= "0" && ch <= "9";
}

/**
 * ¿Aparece `needle` en `haystack` (ambos canónicos) sin partir un número? Una cita «USD 240» no
 * vale dentro de «USD 2.400,00» (canónico «usd240000»): si la cita empieza o termina en dígito,
 * el carácter vecino en el texto no puede ser otro dígito.
 */
function includesWithoutSplittingNumbers(haystack: string, needle: string): boolean {
  if (needle.length === 0) return false;
  const checkStart = isDigit(needle[0]);
  const checkEnd = isDigit(needle[needle.length - 1]);
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + 1)) {
    if (checkStart && isDigit(haystack[i - 1])) continue;
    if (checkEnd && isDigit(haystack[i + needle.length])) continue;
    return true;
  }
  return false;
}

/**
 * Números escritos en el texto: «2.400,00», «1,200.00», «12'000.000», «12 000 000», «4760000».
 * El segundo patrón une grupos de miles separados por espacio; el primero no (columnas de tablas).
 */
const NUMBER_PATTERNS = [/\d+(?:[.,'’]\d+)*/g, /\d+(?:(?:[.,'’]|[ \u00a0\u202f](?=\d{3}(?!\d)))\d+)*/g];

/** Lecturas posibles de un número escrito: último separador decimal y/o todos de miles. */
function numberReadings(token: string): number[] {
  const groups = token.split(/[^0-9]+/);
  if (groups.length === 1) return [Number(token)];
  const separators = token.match(/[^0-9]+/g) ?? [];
  const last = separators[separators.length - 1];
  const readings: number[] = [];
  if (last === "." || last === ",") {
    readings.push(Number(`${groups.slice(0, -1).join("")}.${groups[groups.length - 1]}`));
  }
  if (groups.slice(1).every((g) => g.length === 3)) readings.push(Number(groups.join("")));
  return readings;
}

/** ¿Algún número del texto vale exactamente `value` (al centavo)? «240» no está en «2.400,00». */
function amountAppears(value: number, text: string): boolean {
  const target = toCents(Math.abs(value));
  for (const pattern of NUMBER_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      if (numberReadings(match[0]).some((n) => Number.isFinite(n) && toCents(n) === target)) return true;
    }
  }
  return false;
}

function valueFound(field: CriticalField, value: string | number | null, doc: SearchableText): boolean {
  if (value == null) return false;
  if (typeof value === "number") return Number.isFinite(value) && amountAppears(value, doc.normalized);
  const canon = canonicalText(value);
  if (canon.length > 0 && doc.canonical.includes(canon)) return true;
  if (field === "currency") {
    const aliases = CURRENCY_ALIASES[value.toUpperCase().replace(/\s+/g, "")] ?? [];
    return aliases.some((alias) => doc.collapsed.includes(alias));
  }
  return false;
}

interface SearchableText {
  /** NFKC: dígitos de ancho completo → ASCII; conserva separadores para leer números. */
  normalized: string;
  /** Solo letras y dígitos, sin tildes, en minúsculas. */
  canonical: string;
  /** Minúsculas sin tildes ni espacios (conserva símbolos como «r$» o «s/»). */
  collapsed: string;
}

function evidenceFound(field: CriticalField, evidence: string, doc: SearchableText): boolean {
  const canon = canonicalText(evidence);
  if (canon.length > 0) return includesWithoutSplittingNumbers(doc.canonical, canon);
  // Una cita de puros símbolos («$», «€», «R$») solo respalda la moneda.
  return field === "currency" && doc.collapsed.includes(collapsedLower(evidence));
}

/**
 * Campos críticos cuya cita no aparece en el texto plano del documento (comparación tolerante a
 * mayúsculas, tildes, espacios, saltos de línea y separadores, pero sin partir números: «USD 240» no
 * está en «USD 2.400,00»). Si la cita no aparece pero el valor sí, no se marca; un monto se busca
 * leyendo los números del texto en sus formatos habituales, no como subcadena de dígitos. Solo aplica cuando hay texto plano y el documento no es una imagen; tampoco cuando
 * trae alguna imagen adjunta (p. ej. un correo con una foto), porque lo leído en la imagen nunca está
 * en el texto plano y daría falsos positivos.
 */
export function findEvidenceNotFound(doc: NormalizedDoc, extraction: Extraction): CriticalField[] {
  if (doc.plainText == null || doc.kind === "image" || doc.plainText.trim() === "") return [];
  if (doc.parts.some((part) => part.type === "image")) return [];
  const text: SearchableText = {
    normalized: doc.plainText.normalize("NFKC"),
    canonical: canonicalText(doc.plainText),
    collapsed: collapsedLower(doc.plainText),
  };
  const notFound: CriticalField[] = [];

  for (const field of CRITICAL_FIELDS) {
    const f = criticalField(extraction, field);
    const evidence = f.evidence?.trim();
    if (!evidence) continue;
    if (evidenceFound(field, evidence, text)) continue;
    if (valueFound(field, f.value, text)) continue;
    notFound.push(field);
  }
  return notFound;
}

// ───────────────────────── Evaluación ─────────────────────────

/**
 * Una lectura «ok» cuya extracción no cumple ExtractionSchema (p. ej. un lector externo que no valida
 * y deja un NaN o un campo sin definir) se convierte en lectura fallida: nunca se evalúa sobre datos rotos.
 */
function validated<T extends ReaderResult | null>(result: T): T | ReaderResult {
  if (!result || !result.ok) return result;
  const parsed = ExtractionSchema.safeParse(result.extraction);
  if (parsed.success) return result;
  const issue = parsed.error.issues[0];
  const where = issue && issue.path.length > 0 ? ` (campo «${issue.path.join(".")}»)` : "";
  return {
    ok: false,
    readerId: result.readerId,
    model: result.model,
    promptVersion: result.promptVersion,
    error: "parse_error",
    message: `La lectura no cumple el esquema de datos${where}.`,
  };
}

export function assessReadings(
  doc: NormalizedDoc,
  rawPrimary: ReaderResult,
  rawSecondary: ReaderResult | null,
): ReadingAssessment {
  const primary = validated(rawPrimary);
  const secondary = validated(rawSecondary);
  const extraction = primary.ok ? primary.extraction : null;
  const data = extraction ? toInvoiceData(extraction) : null;

  const missingCriticalFields: string[] = data
    ? CRITICAL_FIELDS.filter((field) => dataValue(data, field) == null)
    : [...CRITICAL_FIELDS];
  // Ilegible si CUALQUIERA de las dos lecturas dudó del dato: si la segunda no lo leyó con claridad,
  // la coincidencia entre ambas no lo respalda.
  const okReadings = [extraction, secondary?.ok ? secondary.extraction : null].filter((e): e is Extraction => e != null);
  const illegibleCriticalFields: string[] = extraction
    ? CRITICAL_FIELDS.filter((field) => okReadings.some((e) => !criticalField(e, field).legible))
    : [];

  const signals: ReadingSignals = {
    missingCriticalFields,
    illegibleCriticalFields,
    readersDisagreeOn: compareReadings(primary, secondary),
    arithmeticIssues: data ? arithmeticIssues(data) : [],
    suspiciousInstructions: collectSuspiciousInstructions(doc, [primary, secondary]),
    evidenceNotFound: extraction ? findEvidenceNotFound(doc, extraction) : [],
  };

  return { primary, secondary, data, signals };
}

/** Ejecuta un lector sin dejar escapar excepciones (un lector defectuoso no tumba el proceso). */
async function safeRead(reader: Reader, doc: NormalizedDoc): Promise<ReaderResult> {
  try {
    return await reader.read(doc);
  } catch (err) {
    return {
      ok: false,
      readerId: reader.id,
      model: reader.model,
      promptVersion: reader.promptVersion,
      error: "api_error",
      message: `Error inesperado del lector: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Lee la factura con ambos lectores en paralelo y verifica las lecturas. */
export async function readInvoice(
  doc: NormalizedDoc,
  readers: { primary: Reader; secondary: Reader | null },
): Promise<ReadingAssessment> {
  const [primary, secondary] = await Promise.all([
    safeRead(readers.primary, doc),
    readers.secondary ? safeRead(readers.secondary, doc) : Promise.resolve(null),
  ]);
  return assessReadings(doc, primary, secondary);
}
