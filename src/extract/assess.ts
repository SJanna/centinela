/**
 * Verificación de lecturas (código, sin modelo): compara las dos lecturas, revisa la aritmética,
 * comprueba que las citas existan en el texto plano (o, sin texto verificable, que la cita del total
 * traiga su etiqueta), corre los detectores de instrucciones, de documento ya pagado y de documento
 * que no es un cobro (anulado, borrador, proforma, nota crédito), revisa si la moneda solo se escribe
 * con «$», y pasa los avisos de la entrada (versión HTML distinta del texto, adjunto que no se pudo leer).
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
import {
  formatMoney,
  legalFormsAfter,
  normalizeAccount,
  normalizeName,
  splitLegalForm,
  stripTaxIdLabel,
  taxIdsEquivalent,
  toCents,
} from "../core/normalize";
import { detectSuspiciousInstructions } from "./heuristics";
import { detectPaidDocumentMarkers } from "./paid-markers";
import { detectVoidDocumentMarkers } from "./void-markers";
import { detectEarlierPeriodMarkers } from "./period-markers";
import { voidMarkersInNotes } from "./void-notes";
import { DOLLAR_SIGN_CURRENCIES, currencyMarkerIn, declaresCurrency, namesCurrency } from "./currency-written";

export const SECOND_READING_UNAVAILABLE = "segunda_lectura_no_disponible";
/** Clave en readersDisagreeOn cuando las dos lecturas imputan la factura a meses distintos. */
export const PERIOD_DISAGREEMENT = "periodo";
/** Clave en readersDisagreeOn cuando las dos lecturas dicen que la factura va dirigida a empresas distintas. */
export const BILL_TO_DISAGREEMENT = "destinatario";

/** Campos del destinatario de la factura (a quién va dirigida). No son críticos: si faltan, no se penaliza. */
export const BILL_TO_FIELDS = ["billToName", "billToTaxId"] as const;
export type BillToField = (typeof BILL_TO_FIELDS)[number];
/** Campos cuya cita se comprueba contra el texto del documento (evidenceNotFound). */
export type VerifiedField = CriticalField | BillToField;

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

/**
 * Texto del destinatario de la factura. Al revés que en un campo crítico, aquí «ausente» es lo que deja
 * pagar: solo es relleno lo que no tiene ninguna letra ni dígito de ningún alfabeto («—») o un relleno
 * conocido («N/A»). Un nombre en cirílico, griego, chino o de ancho completo es un destinatario.
 */
function billToText(value: string | null | undefined): string | null {
  const v = cleanText(value);
  if (v == null || !/[\p{L}\p{N}]/u.test(v)) return null;
  return PLACEHOLDERS.has(canonicalText(v)) ? null : v;
}

export function toInvoiceData(e: Extraction): InvoiceData {
  return {
    documentType: e.documentType,
    vendorName: criticalText(e.vendorName.value),
    vendorTaxId: cleanText(e.vendorTaxId.value),
    billToName: billToText(e.billToName?.value),
    billToTaxId: billToText(e.billToTaxId?.value),
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
 * ¿Las dos lecturas dicen que la factura va dirigida a empresas distintas? Solo se compara lo que traen
 * las DOS: el nombre (sin forma societaria final: «Andes Labs Inc.» = «ANDES LABS») si ambas lo traen,
 * y el id tributario (sin etiqueta) si ambas lo traen. Que una lo traiga y la otra no, no es desacuerdo.
 */
export function billToDisagrees(a: Extraction | null, b: Extraction | null): boolean {
  if (!a || !b) return false;
  const nameA = billToText(a.billToName?.value);
  const nameB = billToText(b.billToName?.value);
  if (nameA != null && nameB != null && !sameBillToName(nameA, nameB)) return true;
  const taxA = billToText(a.billToTaxId?.value);
  const taxB = billToText(b.billToTaxId?.value);
  return taxA != null && taxB != null && !taxIdsEquivalent(stripTaxIdLabel(taxA), stripTaxIdLabel(taxB));
}

/**
 * ¿Dos lecturas nombran al mismo destinatario? Mismo nombre y, si las dos traen forma societaria, la
 * misma («Andes Labs» = «Andes Labs Inc.», pero «Andes Labs Inc.» ≠ «Andes Labs LLC»). Un nombre sin
 * letras ASCII (otro alfabeto) se compara letra a letra.
 */
function sameBillToName(a: string, b: string): boolean {
  const pa = splitLegalForm(a);
  const pb = splitLegalForm(b);
  if (pa == null || pb == null) return unicodeCanonical(a) === unicodeCanonical(b);
  return pa.base === pb.base && (pa.form === "" || pb.form === "" || pa.form === pb.form);
}

/**
 * LEC-2: campos críticos en que las lecturas no coinciden; además, "periodo" si las dos lecturas
 * imputan la factura a meses distintos (servicePeriod, o el mes de issueDate si no hay), y
 * "destinatario" si las dos dicen a quién va dirigida y no coinciden (billToDisagrees). Si una de
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
  if (billToDisagrees(a, b)) out.push(BILL_TO_DISAGREEMENT);
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

export const RECEIPT_READING_REASON = "La lectura clasifica el documento como recibo de algo ya pagado";

/**
 * Señal de documento ya pagado: una entrada por lectura que lo clasifica como «receipt» (fuente
 * "model") y una por cada marca del detector por patrones sobre el texto plano (fuente "heuristic").
 * Cualquier entrada basta para no pagar: LEC-1 escala y la guardia rechaza.
 */
export function collectPaidDocumentMarkers(
  doc: NormalizedDoc,
  readings: Array<ReaderResult | null>,
): NonNullable<ReadingSignals["paidDocumentMarkers"]> {
  const out: NonNullable<ReadingSignals["paidDocumentMarkers"]> = [];
  for (const reading of readings) {
    if (!reading?.ok || reading.extraction.documentType !== "receipt") continue;
    out.push({ text: `Clasificado como recibo por ${reading.readerId}`, source: "model", reason: RECEIPT_READING_REASON });
  }
  if (doc.plainText) {
    for (const m of detectPaidDocumentMarkers(doc.plainText)) out.push({ text: m.text, source: "heuristic", reason: m.reason });
  }
  return out;
}

/**
 * Señal de documento que no es un cobro válido: una entrada por cada marca del detector por patrones
 * (factura anulada, borrador, proforma, nota crédito, «no es una factura») sobre el texto plano, el
 * mismo texto que revisa el detector de ya pagado. Cualquier entrada basta para no pagar: LEC-1 escala
 * y la guardia rechaza. Sin texto plano (una foto) depende de que una lectura diga «other».
 */
export function collectVoidDocumentMarkers(
  doc: NormalizedDoc,
  readings: Array<ReaderResult | null> = [],
): NonNullable<ReadingSignals["voidDocumentMarkers"]> {
  const out: NonNullable<ReadingSignals["voidDocumentMarkers"]> = doc.plainText
    ? detectVoidDocumentMarkers(doc.plainText).map((m) => ({ text: m.text, reason: m.reason, kind: m.kind }))
    : [];
  // Lo que la propia lectura anota (sello, marca de agua o título que vio), también en imágenes: una
  // lectura puede anotar «marca de agua BORRADOR» y aun así clasificar el documento como factura.
  for (const reading of readings) {
    if (!reading?.ok) continue;
    for (const note of voidMarkersInNotes(reading.extraction.readerNotes)) {
      out.push({ text: `${reading.readerId} anota: «${note.text}»`, reason: `Una lectura anota que el documento ${note.reason}`, kind: note.kind });
    }
  }
  return out;
}

/**
 * Señal de factura que cobra un mes anterior al de su fecha (src/extract/period-markers.ts): sobre el
 * texto plano del documento, la descripción de cada línea y la nota de cada lectura que funcionó. El
 * mes de emisión es el de la lectura principal (o, si no lo trae, el de la segunda). Solo la usan
 * DUP-3 y la guardia cuando la factura no trae periodo de servicio.
 */
export function collectEarlierPeriodMarkers(
  doc: NormalizedDoc,
  data: InvoiceData | null,
  readings: Array<ReaderResult | null> = [],
): NonNullable<ReadingSignals["earlierPeriodMarkers"]> {
  const ok = readings.filter((r): r is Extract<ReaderResult, { ok: true }> => r?.ok === true);
  const issueDates = [data?.issueDate, ...ok.map((r) => r.extraction.issueDate.value)];
  const issue = issueDates.find((d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.trim()));
  const issueMonth = issue ? issue.trim().slice(0, 7) : null;
  const out: NonNullable<ReadingSignals["earlierPeriodMarkers"]> = [];
  const seen = new Set<string>();
  const add = (text: string, period: string | null) => {
    const key = `${period ?? ""}|${text}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ text, period });
    }
  };
  for (const m of detectEarlierPeriodMarkers(doc.plainText, issueMonth)) add(m.text, m.period);
  for (const r of ok) {
    for (const line of r.extraction.lineItems ?? []) {
      for (const m of detectEarlierPeriodMarkers(line.description, issueMonth)) add(m.text, m.period);
    }
    for (const m of detectEarlierPeriodMarkers(r.extraction.readerNotes, issueMonth)) {
      add(`${r.readerId} anota: «${m.text}»`, m.period);
    }
  }
  return out;
}

/** Cómo escribe el documento la moneda del total: currencyOnlyDollarSign y currencyMarker de las señales. */
export interface CurrencyWriting {
  /** true si la moneda leída es USD/COP/MXN/CLP/ARS y el documento no la nombra junto al total. */
  onlyDollarSign: boolean;
  /** Si onlyDollarSign: "$" (un «$» solo), "" (nada) u otro código ISO («R$» → "BRL"). Si no, "". */
  marker: string;
}

const NOT_ONLY_DOLLAR: CurrencyWriting = { onlyDollarSign: false, marker: "" };

/** Primera palabra después de un importe que puede ser su moneda («2.800,00 USD», «$2,800.00 Dlls», «2,800.00 US Dollars»). */
function currencyWordAfter(after: string): string {
  const first = /^[^\S\n]*[^\s\d(),;|]{1,12}/.exec(after);
  if (!first) return "";
  const word = first[0].trim().toLowerCase();
  if (!/^(?:us|u\.s\.|pesos?|dolares|dólares|dollars?)$/.test(word)) return first[0];
  const second = /^[^\S\n]+[^\s\d(),;|]{1,12}/.exec(after.slice(first[0].length));
  return second ? first[0] + second[0] : first[0];
}

/**
 * Lo que el documento escribe junto a cada aparición de un importe: en su línea, desde el número
 * anterior (o el comienzo de la línea) hasta el importe y la palabra que lo sigue; si antes del
 * importe no hay letras (la etiqueta quedó en la línea de arriba, como en «TOTAL» / «$ 4.800»), también
 * la línea anterior. «Importe Total $ 2.800,00» → «Importe Total $ 2.800,00»; «1 COP 12.000.000 COP
 * 12.000.000» → « COP 12.000.000 COP».
 */
export function amountSegments(text: string, value: number | null | undefined): string[] {
  if (value == null || !Number.isFinite(value) || value === 0) return [];
  const target = toCents(Math.abs(value));
  const out = new Set<string>();
  for (const pattern of NUMBER_PATTERNS) {
    for (const m of text.matchAll(pattern)) {
      if (!numberReadings(m[0]).some((n) => Number.isFinite(n) && toCents(n) === target)) continue;
      const start = m.index;
      const end = start + m[0].length;
      const lineStart = start === 0 ? 0 : text.lastIndexOf("\n", start - 1) + 1;
      const nl = text.indexOf("\n", end);
      const lineEnd = nl === -1 ? text.length : nl;
      const before = text.slice(lineStart, start);
      let cut = 0;
      for (const n of before.matchAll(/\d(?:[\d.,'’]*\d)?/g)) cut = n.index + n[0].length;
      let prefix = before.slice(cut);
      if (!/\p{L}/u.test(prefix) && lineStart > 0) {
        const prevStart = lineStart === 1 ? 0 : text.lastIndexOf("\n", lineStart - 2) + 1;
        const prev = text.slice(prevStart, lineStart - 1);
        if (prev.length <= 60 && !/\d/.test(prev)) prefix = `${prev}\n${prefix}`;
      }
      out.add(`${prefix}${m[0]}${currencyWordAfter(text.slice(end, lineEnd))}`);
    }
  }
  return [...out];
}

/** Dónde aparece una cita en el texto (sin partir números), en posiciones del texto original. */
function quoteSpans(text: string, quote: string | null | undefined): string[] {
  const canonQuote = canonicalText(quote ?? "");
  if (canonQuote.length === 0) return [];
  let canon = "";
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = canonicalText(text[i]);
    for (let k = 0; k < c.length; k++) map.push(i);
    canon += c;
  }
  const out: string[] = [];
  const checkStart = isDigit(canonQuote[0]);
  const checkEnd = isDigit(canonQuote[canonQuote.length - 1]);
  for (let i = canon.indexOf(canonQuote); i !== -1; i = canon.indexOf(canonQuote, i + 1)) {
    if (checkStart && isDigit(canon[i - 1])) continue;
    if (checkEnd && isDigit(canon[i + canonQuote.length])) continue;
    const start = map[i];
    const end = map[i + canonQuote.length - 1] + 1;
    const nl = text.indexOf("\n", end);
    out.push(`${text.slice(start, end)}${currencyWordAfter(text.slice(end, nl === -1 ? text.length : nl))}`);
  }
  return out;
}

/**
 * ¿La moneda leída solo aparece como «$» (o sin nada) junto al total? Para USD/COP/MXN/CLP/ARS (las
 * que se escriben con «$» solo), onlyDollarSign es true si el documento no la nombra de forma explícita
 * (código ISO, «US$», «dólares», «pesos argentinos», «Dlls»…; currency-written.ts) donde cobra:
 * - Con texto verificable (hasVerifiableText) cuenta SOLO esto del texto plano: (a) un campo que
 *   declara la moneda («Moneda: USD», «CURRENCY» / «USD», «Valores en USD», el total en letras «SON: …
 *   PESOS M/CTE»), y (b) lo escrito junto a cada aparición del total y del subtotal leídos
 *   (amountSegments: la etiqueta y la moneda en su línea). Si el importe no aparece en el texto, junto
 *   a las citas del total y del subtotal de las dos lecturas que sí aparecen (quoteSpans). Una mención
 *   suelta en otra línea no cuenta: «Cotización dólar BNA: $ 1.050», «Equivalente: USD 2,67», «no se
 *   aceptan dólares», la firma del correo «Cotizamos en USD», el asunto, los nombres de adjuntos.
 * - Sin texto verificable (una foto, un PDF escaneado, un correo con una imagen): cuentan las citas
 *   de moneda, total y subtotal, y CADA lectura que funcionó tiene que nombrar la moneda en sus
 *   propias citas. Si una de las dos solo copió «$ 4.800», no hay acuerdo sobre lo que dice el
 *   documento, y una cita inventada por un solo lector no basta para pagar. Límite: si las dos lecturas
 *   inventan «USD» en sus citas de una foto, no hay texto contra el cual comprobarlo.
 * Las notas del lector (readerNotes) nunca cuentan: son palabras del modelo. El motor (ACU-2) y la
 * guardia deciden con el país del proveedor si ese «$» es la moneda pactada. marker dice qué escribe
 * el documento en su lugar (currencyMarkerIn): "$", "" (nada) u otra moneda.
 */
export function assessCurrencyWriting(doc: NormalizedDoc, data: InvoiceData | null, readings: Array<ReaderResult | null>): CurrencyWriting {
  if (data == null || data.currency == null) return NOT_ONLY_DOLLAR;
  const code = data.currency.trim().toUpperCase();
  if (!DOLLAR_SIGN_CURRENCIES.includes(code)) return NOT_ONLY_DOLLAR;
  const extractions = readings.flatMap((r) => (r?.ok ? [r.extraction] : []));
  if (hasVerifiableText(doc) && doc.plainText != null) {
    const text = doc.plainText;
    if (declaresCurrency(code, text)) return NOT_ONLY_DOLLAR;
    let segments = [...amountSegments(text, data.total), ...amountSegments(text, data.subtotal)];
    if (segments.length === 0) {
      segments = extractions.flatMap((e) => [...quoteSpans(text, e.total?.evidence), ...quoteSpans(text, e.subtotal?.evidence)]);
    }
    if (segments.some((s) => namesCurrency(code, s))) return NOT_ONLY_DOLLAR;
    return { onlyDollarSign: true, marker: currencyMarkerIn(code, segments) };
  }
  const quotesOf = (e: Extraction) => [e.currency?.evidence, e.total?.evidence, e.subtotal?.evidence];
  const names = (e: Extraction) => quotesOf(e).some((q) => namesCurrency(code, q) || declaresCurrency(code, q));
  if (extractions.length > 0 && extractions.every(names)) return NOT_ONLY_DOLLAR;
  return { onlyDollarSign: true, marker: currencyMarkerIn(code, extractions.flatMap(quotesOf)) };
}

/** Compatibilidad: solo el booleano de assessCurrencyWriting. */
export function currencyWrittenOnlyAsDollarSign(
  doc: NormalizedDoc,
  data: InvoiceData | null,
  readings: Array<ReaderResult | null>,
): boolean {
  return assessCurrencyWriting(doc, data, readings).onlyDollarSign;
}

export const INGEST_WARNING_WITHOUT_MESSAGE = "La entrada dejó un aviso sin detalle: parte del archivo no se pudo leer o no coincide con lo leído";

/**
 * Avisos de la entrada (NormalizedDoc.warnings): el correo trae una versión HTML distinta del texto
 * plano o un adjunto que no se pudo leer. Lo que una persona ve no es lo que leyeron los lectores:
 * cualquier aviso basta para no pagar (LEC-1 escala y la guardia rechaza). Un aviso sin mensaje se
 * conserva con un texto genérico: descartarlo dejaría pasar el pago.
 */
export function collectIngestWarnings(doc: NormalizedDoc): string[] {
  const warnings: unknown = doc.warnings;
  if (!Array.isArray(warnings)) return [];
  const out: string[] = [];
  for (const w of warnings as unknown[]) {
    const message = typeof (w as { message?: unknown })?.message === "string" ? (w as { message: string }).message : "";
    const text = message.replace(/\s+/g, " ").trim() || INGEST_WARNING_WITHOUT_MESSAGE;
    if (!out.includes(text)) out.push(text);
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

/**
 * Formas que solo cuentan como palabra (sobre minúsculas sin tildes): «$ 2,800.00 Dlls» (México),
 * «U.S.D.», «DOL» (código de AFIP). Las mismas que reconoce currency-written.ts para la señal de «$».
 */
const CURRENCY_WORD_ALIASES: Record<string, RegExp[]> = {
  USD: [/\bdll?s\b/, /(?<![a-z])u\.\s?s\.\s?d\b/, /\bdol\b/],
};

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

/**
 * ¿El código de moneda aparece como palabra («USD 1.200», «(COP)», «USD1200»)? No vale dentro de
 * otra palabra ni uniendo palabras: «plus Delivery» no contiene USD y «copia» no contiene COP.
 */
function currencyCodeAppears(code: string, lowerText: string): boolean {
  if (!/^[a-z]{3}$/.test(code)) return false;
  return new RegExp(`(?:^|[^a-z])${code}(?![a-z])`).test(lowerText);
}

/**
 * ¿El valor leído está en el texto del documento? Una cita que sí está en el texto no basta: el
 * lector podría citar la línea correcta y devolver otro valor, o no citar nada.
 */
function valueFound(field: VerifiedField, value: string | number, doc: SearchableText): boolean {
  if (typeof value === "number") return Number.isFinite(value) && amountAppears(value, doc.normalized);
  if (field === "currency") {
    const code = value.toLowerCase().replace(/\s+/g, "");
    if (currencyCodeAppears(code, doc.lower)) return true;
    const aliases = CURRENCY_ALIASES[code.toUpperCase()] ?? [];
    if (aliases.some((alias) => doc.collapsed.includes(alias))) return true;
    return (CURRENCY_WORD_ALIASES[code.toUpperCase()] ?? []).some((re) => re.test(doc.lower));
  }
  if (field === "billToName") return billToNameFound(value, doc);
  const canon = canonicalText(value);
  if (canon.length > 0 && doc.canonical.includes(canon)) return true;
  // El nombre del proveedor puede venir sin la forma societaria que el lector agregó («Inc.», «S.A.S.»).
  if (field === "vendorName") {
    const base = canonicalText(normalizeName(value) ?? "");
    return base.length > 0 && doc.canonical.includes(base);
  }
  return false;
}

/** Solo letras y dígitos de cualquier alfabeto, en minúsculas (NFKC: el ancho completo pasa a ASCII). */
function unicodeCanonical(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * ¿El destinatario leído está en el texto? Como el nombre del proveedor, puede venir sin la forma
 * societaria, o con una que el texto no trae (el lector la agregó). Pero si el texto solo lo muestra
 * con OTRA forma societaria («Andes Labs S.A.S.»), una lectura que dice «Andes Labs Inc.» no está
 * respaldada: es otra razón social. Un nombre en otro alfabeto se busca letra a letra.
 */
function billToNameFound(value: string, doc: SearchableText): boolean {
  const canon = canonicalText(value);
  const parts = splitLegalForm(value);
  if (parts == null) {
    const u = unicodeCanonical(value);
    return u.length > 0 && unicodeCanonical(doc.lower).includes(u);
  }
  const forms = legalFormsAfter(doc.lower, parts.base);
  if (forms.length === 0) return canon.length > 0 && doc.canonical.includes(canon);
  if (parts.form === "" || forms.includes(parts.form)) return true;
  return forms.every((f) => f === "");
}

interface SearchableText {
  /** NFKC: dígitos de ancho completo → ASCII; conserva separadores para leer números. */
  normalized: string;
  /** NFKD, sin tildes y en minúsculas; conserva espacios y signos (para buscar palabras). */
  lower: string;
  /** Solo letras y dígitos, sin tildes, en minúsculas. */
  canonical: string;
  /** Minúsculas sin tildes ni espacios (conserva símbolos como «r$» o «s/»). */
  collapsed: string;
}

function searchable(text: string): SearchableText {
  return {
    normalized: text.normalize("NFKC"),
    lower: text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase(),
    canonical: canonicalText(text),
    collapsed: collapsedLower(text),
  };
}

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
 * ¿La cita del lector respalda el valor? Solo si la cita está en el texto (sin partir números) Y el
 * valor está en la cita: citar la línea correcta y devolver otro valor no cuenta. Sirve para textos
 * de PDF con espacios entre letras o dígitos («2 . 4 0 0 , 0 0»), donde el número no se lee entero
 * pero la cita sí aparece. Una cita hecha solo de símbolos («$», «R$») respalda únicamente la moneda.
 */
function quoteBacksValue(field: VerifiedField, value: string | number, evidence: string | null, doc: SearchableText): boolean {
  const ev = evidence?.trim() ?? "";
  if (ev.length === 0) return false;
  const canon = canonicalText(ev);
  if (canon.length === 0) return field === "currency" && doc.collapsed.includes(collapsedLower(ev));
  if (!includesWithoutSplittingNumbers(doc.canonical, canon)) return false;
  const quote = searchable(ev);
  if (valueFound(field, value, quote)) return true;
  return field === "currency" && typeof value === "string" && symbolQuoteBacksCurrency(value.toUpperCase().replace(/\s+/g, ""), quote);
}

/**
 * Símbolos con que se escribe cada moneda, del más largo al más corto: «US$» y «R$» se reconocen
 * antes que «$», que puede ser de dólares o de pesos.
 */
const CURRENCY_SYMBOLS: readonly [string, readonly string[]][] = [
  ["clp$", ["CLP"]],
  ["col$", ["COP"]],
  ["us$", ["USD"]],
  ["u$s", ["USD"]],
  ["mx$", ["MXN"]],
  ["ar$", ["ARS"]],
  ["r$", ["BRL"]],
  ["s/", ["PEN"]],
  ["€", ["EUR"]],
  ["$", ["USD", "COP", "MXN", "CLP", "ARS"]],
];

/**
 * Una cita con un símbolo de moneda («$ 12.000.000») respalda una moneda que se escribe con ese
 * símbolo, siempre que la cita no nombre otra moneda: «$» respalda COP, pero «Total MXN $ 1.200»
 * no respalda USD.
 */
function symbolQuoteBacksCurrency(code: string, quote: SearchableText): boolean {
  let rest = quote.collapsed;
  const possible = new Set<string>();
  for (const [symbol, codes] of CURRENCY_SYMBOLS) {
    if (!rest.includes(symbol)) continue;
    codes.forEach((c) => possible.add(c));
    rest = rest.split(symbol).join("");
  }
  if (!possible.has(code)) return false;
  return !Object.keys(CURRENCY_ALIASES).some((other) => other !== code && currencyCodeAppears(other.toLowerCase(), quote.lower));
}

/**
 * ¿Hay texto plano contra el cual comprobar las citas? No en una imagen, ni en un PDF sin capa de
 * texto, ni en un documento que trae alguna imagen adjunta (lo leído en la imagen no está en el texto).
 */
export function hasVerifiableText(doc: NormalizedDoc): boolean {
  if (doc.plainText == null || doc.kind === "image" || doc.plainText.trim() === "") return false;
  return !doc.parts.some((part) => part.type === "image");
}

/**
 * Formas de «total» que NO son el total a pagar (sobre texto plegado):
 * - antes de impuestos o parciales: «Subtotal», «Sub-total», «Sub total», «Total sin IVA», «Total (sin
 *   IVA)», «Total s/IVA» (pero no «Total S/ 6,000.00», soles), «Total antes de impuestos», «Total before tax», «Total excl. VAT», «Total ex
 *   VAT», «Total without VAT», «Total pretax», «Total HT», «Total sem impostos», «Total parcial», «Total
 *   neto», «Net total», «Total bruto», «Total gravado», «Total exento»;
 * - totales de otra cosa: «Total IVA» / «Total impuestos» / «Total tax» (pero no «Total IVA incluido»),
 *   «Total descuento», «Total retenciones», «Total de horas», «Total items».
 * «Total neto a pagar» sigue contando: se quita «Total neto» y queda «a pagar».
 */
const NOT_A_TOTAL_LABEL = new RegExp(
  [
    "\\bsub[\\s.\\-]{0,2}total\\b",
    "\\b(?:net|neto|parcial)\\s+total\\b",
    "\\btotal\\s*[(\\[]?\\s*(?:(?:sin|antes|before|excl|excluding|ex|without|sem|pre|pretax|ht|parcial|neto|net|bruto|gravado|gravada|exento|exenta|exempt|descuentos?|discounts?|retenciones|retencion|withholding|horas|hours|hrs|items|articulos|lineas|units|unidades|qty|cantidad|de\\s+(?:horas|items|articulos|lineas|unidades))\\b|s\\s*\\/\\s*(?:iva|igv|impuestos?|impostos?|imp\\b|vat|tax))",
    "\\btotal\\s*[(\\[]?\\s*(?:iva|igv|vat|tax|taxes|impuestos?|impostos?|icms|iss|itbis|isv)\\b(?!\\s*\\.?\\s*(?:incl|inc\\b|incluido|incluida|incluidos|included|inclusive|incluso))",
  ].join("|"),
  "g",
);

/**
 * Etiquetas del total a pagar (sobre texto plegado: minúsculas, sin tildes): «Total», «Total a pagar»,
 * «Grand total», «Total due», «Importe/Monto/Valor total», «Total geral», «Total a cobrar», «Valor a
 * pagar», «Neto a pagar», «Amount due», «Balance due», «Amount payable», «Saldo pendiente», «Valor
 * líquido», y en una cuenta de cobro «la suma de» / «por valor de».
 */
const TOTAL_LABEL =
  /\btotal\b|\ba\s+(?:pagar|cobrar)\b|\b(?:amount|balance)\s+(?:due|payable)\b|\bsaldo\s+(?:pendiente|adeudado)\b|\bvalor\s+liquido\b|\b(?:la|por\s+la)\s+suma\s+de\b|\bpor\s+valor\s+de\b/;

function foldLabel(s: string): string {
  return s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** ¿La cita trae una etiqueta del total a pagar («Total», «Total a pagar», «Amount due»…)? «Subtotal» no cuenta. */
export function quoteHasTotalLabel(evidence: string | null | undefined): boolean {
  const folded = foldLabel(evidence ?? "").replace(NOT_A_TOTAL_LABEL, " ");
  return TOTAL_LABEL.test(folded);
}

/**
 * Regla para documentos sin texto verificable (imagen, PDF sin capa de texto, adjunto en imagen): ahí
 * la cita del total no se puede comprobar contra el texto, y un lector puede poner como total el
 * subtotal visible cuando la línea del total está borrosa. El total de una lectura solo cuenta como
 * legible si su cita trae una etiqueta de total y no es la misma cita del subtotal. Devuelve true si
 * esa lectura NO confirma el total (y entonces el total queda ilegible → LEC-1 escala). Un total sin
 * valor no se marca aquí (eso es un dato ausente).
 */
export function totalNotConfirmedByQuote(doc: NormalizedDoc, extraction: Extraction): boolean {
  if (hasVerifiableText(doc)) return false;
  const total = extraction.total;
  if (total.value == null) return false;
  const evidence = total.evidence?.trim() ?? "";
  if (!quoteHasTotalLabel(evidence)) return true;
  const subtotal = extraction.subtotal.evidence?.trim() ?? "";
  return subtotal !== "" && canonicalText(subtotal) === canonicalText(evidence);
}

/** Palabras del total a pagar en una nota del lector («el total», «Amount due», «el monto a pagar»). */
const NOTE_TOTAL = /\btotal\b|\bamount\s+due\b|\bbalance\s+due\b|\ba\s+(?:pagar|cobrar)\b|\bmonto\b|\bimporte\b|\bla\s+suma\s+de\b|\bvalor\s+(?:total|a\s+pagar|liquido)\b/;
/** La nota dice que no se lee o que se dedujo («borroso», «ilegible», «no se pudo leer», «se dedujo», «blurred», «inferred»). */
const NOTE_DOUBT =
  /borros|ilegib|desenfoc|difumin|tapad|cubiert[oa]|borron|blurr?|illegib|unreadable|obscured|no\s+(?:se\s+)?(?:pudo|puede|pude|podia)\s+leer|no\s+(?:es\s+|son\s+|esta\s+)?legible|sin\s+valor\s+legible|no\s+se\s+(?:lee|leen|distingue)|se\s+(?:dedujo|deduce|deducen|infiere|infirio|infieren|estimo|asumio)|deducid[oa]|inferid[oa]|\b(?:inferred|deduced|estimated|assumed|could\s+not\s+(?:be\s+)?read)\b/;
/** Una duda negada en la misma parte de la frase («no hay partes borrosas», «sin desenfoque»). */
const NOTE_NEGATED = /\b(?:no\s+hay|sin|ningun[oa]?|nada|tampoco\s+hay|nothing|no\s+part|not)\b[^,.;:]{0,30}(?:borros|desenfoc|difumin|blurr?|ilegib|illegib)/;
/** La misma parte de la frase afirma que el total se lee («el total es legible», «se lee con claridad»). */
const NOTE_READS_FINE = /\b(?:es|son|esta|estan|is|are)\s+(?:legibles?|claros?|nitidos?|clear|legible|readable)\b|\bse\s+lee\s+(?:bien|con\s+claridad|claramente)\b|\bclearly\s+(?:visible|readable|legible)\b/;

function foldNote(s: string): string {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Regla para documentos sin texto verificable: la cita del total no se puede comprobar, y si la línea
 * del total está borrosa un lector puede copiar la fila del subtotal CON una etiqueta inventada
 * («Total $86,400.00 MXN»), que la regla de la cita no distingue de la fila real. Lo que sí queda es lo
 * que la propia lectura anota: si en readerNotes una misma parte de la frase habla del total (o del
 * «Amount due», del monto a pagar) y dice que está borroso, que no se pudo leer o que se dedujo, el
 * total de esa lectura no cuenta como legible aunque diga legible. Solo puede escalar, nunca pagar.
 */
export function totalDoubtedInNotes(doc: NormalizedDoc, extraction: Extraction): boolean {
  if (hasVerifiableText(doc)) return false;
  if (extraction.total.value == null) return false;
  const clauses = foldNote(extraction.readerNotes ?? "").split(/[,.;:\n]+/);
  return clauses.some((c) => NOTE_TOTAL.test(c) && NOTE_DOUBT.test(c) && !NOTE_NEGATED.test(c) && !NOTE_READS_FINE.test(c));
}

/**
 * Campos críticos cuyo VALOR no está respaldado por el texto plano del documento: ni el valor
 * aparece en el texto (comparación tolerante a mayúsculas, tildes, espacios, saltos de línea y
 * separadores; un monto se busca leyendo los números del texto en sus formatos habituales, no como
 * subcadena de dígitos: «240» no está en «2.400,00»), ni la cita del lector lo contiene. Que la cita
 * exista no basta: un lector engañado puede citar la línea correcta y devolver otro valor, o no
 * citar nada. Un campo sin valor no se marca (eso es LEC-1, dato ausente).
 * Lo mismo con el destinatario de la factura (billToName, billToTaxId) cuando la lectura lo trae: si
 * un lector dice que va dirigida a la empresa y eso no está en el texto, no se le cree (el destinatario
 * decide ACU-1). Solo aplica cuando hay texto plano y el documento no es una imagen; tampoco cuando trae
 * alguna imagen adjunta (p. ej. un correo con una foto), porque lo leído en la imagen nunca está en el
 * texto plano y daría falsos positivos.
 */
export function findEvidenceNotFound(doc: NormalizedDoc, extraction: Extraction): VerifiedField[] {
  if (!hasVerifiableText(doc) || doc.plainText == null) return [];
  const text = searchable(doc.plainText);
  const notFound: VerifiedField[] = [];

  for (const field of CRITICAL_FIELDS) {
    const f = criticalField(extraction, field);
    if (f.value == null) continue;
    if (valueFound(field, f.value, text)) continue;
    if (quoteBacksValue(field, f.value, f.evidence, text)) continue;
    notFound.push(field);
  }
  for (const field of BILL_TO_FIELDS) {
    const f = extraction[field];
    const value = billToText(f?.value);
    if (value == null) continue;
    if (valueFound(field, value, text)) continue;
    if (field === "billToTaxId" && valueFound(field, stripTaxIdLabel(value), text)) continue;
    if (quoteBacksValue(field, value, f?.evidence ?? null, text)) continue;
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
  // la coincidencia entre ambas no lo respalda. Sin texto verificable, el total además necesita una
  // cita con su etiqueta que no sea la del subtotal (totalNotConfirmedByQuote) y que ninguna lectura
  // anote que está borroso o que lo dedujo (totalDoubtedInNotes).
  const okReadings = [extraction, secondary?.ok ? secondary.extraction : null].filter((e): e is Extraction => e != null);
  const illegibleCriticalFields: string[] = extraction
    ? CRITICAL_FIELDS.filter((field) =>
        okReadings.some(
          (e) => !criticalField(e, field).legible || (field === "total" && (totalNotConfirmedByQuote(doc, e) || totalDoubtedInNotes(doc, e))),
        ),
      )
    : [];

  const currency = assessCurrencyWriting(doc, data, [primary, secondary]);
  const signals: ReadingSignals = {
    missingCriticalFields,
    illegibleCriticalFields,
    readersDisagreeOn: compareReadings(primary, secondary),
    arithmeticIssues: data ? arithmeticIssues(data) : [],
    suspiciousInstructions: collectSuspiciousInstructions(doc, [primary, secondary]),
    evidenceNotFound: extraction ? findEvidenceNotFound(doc, extraction) : [],
    paidDocumentMarkers: collectPaidDocumentMarkers(doc, [primary, secondary]),
    ingestWarnings: collectIngestWarnings(doc),
    voidDocumentMarkers: collectVoidDocumentMarkers(doc, [primary, secondary]),
    currencyOnlyDollarSign: currency.onlyDollarSign,
    currencyMarker: currency.marker,
    earlierPeriodMarkers: collectEarlierPeriodMarkers(doc, data, [primary, secondary]),
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
