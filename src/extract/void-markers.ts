/**
 * Detector de documento QUE NO ES UN COBRO VÁLIDO por patrones (sin modelo), en español, inglés y
 * portugués: una factura anulada, un borrador, una proforma, una nota crédito o un documento de
 * muestra. Pueden traer número, total y datos bancarios igual que una factura, y los lectores los
 * confunden con un cobro. Cualquier marca produce ESCALAR (LEC-1) y la guardia rechaza el pago; un
 * falso positivo nunca paga, solo pide a una persona que mire.
 *
 * Busca sobre el texto plegado (minúsculas, sin tildes, sin invisibles) del texto plano del documento
 * (PDF con texto, correo, chat). La cita que devuelve es la línea del texto original.
 *
 * Marcas (documentadas a propósito):
 * 1. Sello en su propia línea, en mayúsculas o con letras separadas, con signos, números o una fecha
 *    alrededor: «ANULADA», «ANULADO», «VOID», «VOIDED», «CANCELLED», «CANCELED», «BORRADOR», «DRAFT»,
 *    «PROFORMA», «PRO FORMA», «SPECIMEN», «MUESTRA», «SAMPLE», «NULA», «NULO», «CANCELADA» en
 *    portugués va con «fatura/nota»; «CANCELADO/A» solo ya es marca de pagado (paid-markers).
 * 2. Frases: «factura/cuenta de cobro/documento anulad…», «(esta factura) fue/ha sido anulada»,
 *    «invoice (is/was/has been) void(ed)/cancel(l)ed», «this invoice is void», «fatura/nota fiscal
 *    cancelada/anulada», «nota (de) crédito», «credit note/memo», «nota de crédito», «factura
 *    proforma», «proforma invoice», «pre-factura», «prefactura», «no válid… como factura», «not valid
 *    as (an) invoice», «(this) is not a (tax) invoice», «(esto) no es una factura», «sin validez (fiscal /
 *    tributaria / legal)», «documento de muestra», «sample invoice», «draft invoice», «borrador de
 *    factura».
 *
 * No cuentan: «Nota fiscal de serviço» (es una factura en Brasil), «Nota:» / «Notas», «la tabla
 * muestra…» (muestra como verbo: solo cuenta como sello en su línea), «Original / Copia».
 */
import { foldText, snippetAround } from "./heuristics";

export interface VoidMarker {
  /** Línea del documento donde aparece (texto original, espacios colapsados). */
  text: string;
  /** Por qué no es un cobro válido, en español. */
  reason: string;
}

const REASON_VOID = "Dice que el documento está anulado o cancelado";
const REASON_DRAFT = "Es un borrador, una proforma o un documento de muestra, no una factura definitiva";
const REASON_CREDIT = "Es una nota crédito (un abono a favor del cliente), no un cobro";
const REASON_NOT_INVOICE = "Dice que no es una factura válida";

interface Rule {
  pattern: RegExp;
  reason: string;
}

const DOC = "(?:factura|fatura|cuenta\\s+de\\s+cobro|documento|comprobante|nota\\s+fiscal|invoice|bill)";

const RULES: readonly Rule[] = [
  { pattern: new RegExp(`\\b${DOC}\\s+(?:(?:ha\\s+sido|fue|foi|esta|is|was|has\\s+been)\\s+)?(?:anulad[oa]|cancelad[oa]|void(?:ed)?|cancell?ed|nul[oa])\\b`, "g"), reason: REASON_VOID },
  { pattern: /\b(?:esta|este|this)\s+(?:factura|fatura|documento|invoice|document)\s+(?:es|is|e)\s+(?:nul[oa]|void|invalid[oa]?)\b/g, reason: REASON_VOID },
  { pattern: /\bnota\s+(?:de\s+)?credito\b|\bcredit\s+(?:note|memo)\b|\bnota\s+de\s+abono\b/g, reason: REASON_CREDIT },
  { pattern: /\b(?:factura|fatura|invoice)\s+pro[\s-]?forma\b|\bpro[\s-]?forma\s+(?:invoice|factura|fatura)\b|\bpre[\s-]?factura\b/g, reason: REASON_DRAFT },
  { pattern: /\b(?:borrador\s+de\s+(?:factura|cuenta)|draft\s+invoice|(?:factura|invoice)\s+(?:borrador|draft)|sample\s+invoice|(?:factura|documento)\s+de\s+(?:muestra|ejemplo|prueba)|specimen)\b/g, reason: REASON_DRAFT },
  { pattern: /\bno\s+(?:es\s+)?valid[oa]\s+como\s+factura\b|\bnot\s+valid\s+as\s+(?:an?\s+)?invoice\b|\bis\s+not\s+an?\s+(?:tax\s+|valid\s+|official\s+|final\s+)?invoice\b|\bno\s+es\s+(?:una\s+)?factura\b|\bsin\s+validez\s+(?:fiscal|tributaria|legal|comercial)\b|\bnao\s+e\s+(?:uma\s+)?(?:fatura|nota\s+fiscal)\b/g, reason: REASON_NOT_INVOICE },
];

const STAMPS: Record<string, string> = {
  anulada: REASON_VOID,
  anulado: REASON_VOID,
  void: REASON_VOID,
  voided: REASON_VOID,
  cancelled: REASON_VOID,
  canceled: REASON_VOID,
  nula: REASON_VOID,
  nulo: REASON_VOID,
  borrador: REASON_DRAFT,
  draft: REASON_DRAFT,
  proforma: REASON_DRAFT,
  specimen: REASON_DRAFT,
  muestra: REASON_DRAFT,
  sample: REASON_DRAFT,
};
/** Palabras que pueden acompañar al sello: una fecha o «pro» de «PRO FORMA». */
const STAMP_COMPANIONS: ReadonlySet<string> = new Set([
  "el", "en", "de", "del", "on", "em", "pro", "forma",
  "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
  "ene", "abr", "ago", "dic", "fev", "mai", "set", "out", "dez",
  "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "setiembre", "octubre", "noviembre", "diciembre",
  "january", "february", "march", "april", "june", "july", "august", "september", "october", "november", "december",
]);

function isUppercase(s: string): boolean {
  return s === s.toUpperCase() && s !== s.toLowerCase();
}

/** Líneas que son un sello: «ANULADA», «*** VOID ***», «DRAFT», «PRO FORMA», «A N U L A D A», «ANULADA 12/10/2026». */
function stampLines(text: string): { line: string; position: number; reason: string }[] {
  const out: { line: string; position: number; reason: string }[] = [];
  let position = 0;
  for (const raw of text.split("\n")) {
    let words = [...raw.matchAll(/\p{L}+/gu)].map((m) => m[0]);
    if (words.length >= 4 && words.every((w) => [...w].length === 1)) words = [words.join("")];
    if (words.length >= 1 && words.length <= 6 && words.every(isUppercase)) {
      const folded = words.map((w) => foldText(w).folded);
      const joined = folded.join("");
      const key = folded.find((w) => STAMPS[w] != null) ?? (joined === "proforma" ? "proforma" : undefined);
      const rest = folded.filter((w) => w !== key);
      if (key != null && rest.every((w) => STAMP_COMPANIONS.has(w))) {
        out.push({ line: raw.replace(/\s+/g, " ").trim(), position, reason: STAMPS[key] });
      }
    }
    position += raw.length + 1;
  }
  return out;
}

/**
 * Busca marcas de que el documento no es un cobro válido. Devuelve una entrada por línea (si una
 * línea activa varias marcas, las razones se unen con "; "), en el orden del documento.
 */
export function detectVoidDocumentMarkers(text: string): VoidMarker[] {
  if (!text) return [];
  const { folded, map } = foldText(text);
  const bySnippet = new Map<string, { position: number; reasons: Set<string> }>();
  const record = (snippet: string, position: number, reason: string) => {
    if (!snippet) return;
    const entry = bySnippet.get(snippet);
    if (entry) {
      entry.reasons.add(reason);
      entry.position = Math.min(entry.position, position);
    } else {
      bySnippet.set(snippet, { position, reasons: new Set([reason]) });
    }
  };
  for (const rule of RULES) {
    for (const m of folded.matchAll(rule.pattern)) {
      const start = map[m.index];
      const end = Math.max(map[Math.min(m.index + m[0].length, map.length - 1)], start + 1);
      record(snippetAround(text, start, end), start, rule.reason);
    }
  }
  for (const { line, position, reason } of stampLines(text)) record(line, position, reason);
  return [...bySnippet.entries()]
    .sort((a, b) => a[1].position - b[1].position)
    .map(([snippet, { reasons }]) => ({ text: snippet, reason: [...reasons].join("; ") }));
}
