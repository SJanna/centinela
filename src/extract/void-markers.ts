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
 * 1. Sellos («ANULADA», «VOID», «BORRADOR», «DRAFT», «PROFORMA»…), sobre TODO el texto:
 *    - una palabra sello inequívoca (anulada/o, void/voided, borrador, draft, proforma) en mayúsculas en
 *      cualquier lugar de una línea: «ANULADA», «TOTAL A PAGAR COP 12.000.000 ANULADA», «ANULADA – NO
 *      PAGAR», «VOID INVOICE», «Invoice (VOID)», «PROFORMA N.º PF-1»; también partida por la extracción
 *      del PDF («ANULA DA», «A N U L A D A», «PRO FORMA»). No cuenta «BANK DRAFT» (un medio de pago);
 *    - la misma palabra con cualquier mayúscula si está sola en su línea (con una fecha o signos
 *      alrededor): «Anulada», «Proforma», «Draft», o detrás de «Estado / Status / Situación:»: «Estado:
 *      Anulada», «Status: void»; y «Proforma N.º …» / «Proforma #…»;
 *    - las ambiguas (muestra, sample, specimen, nula/o, cancelled/canceled) solo como sello: la línea
 *      entera en mayúsculas, sin más palabras que una fecha o acompañantes de sello («NO PAGAR», «DO
 *      NOT PAY», «POR ERROR», «REEMPLAZADA POR»…). «CANCELADO/A» solo ya es marca de pagado
 *      (paid-markers).
 * 2. Frases sobre el propio documento, solo en la parte del texto que es el documento (en un correo
 *    se quitan las líneas citadas de mensajes anteriores: «> …» y lo que sigue a «El … escribió:» /
 *    «On … wrote:»):
 *    - anulado: «factura / invoice / documento / comprobante (hasta 4 palabras: número, «electrónica»,
 *      «de venta»…) (fue / ha sido / está / queda / is / has been…) anulada / cancelada / void(ed) /
 *      nula / sin efecto»: «La factura CRD-1088 fue anulada», «Factura electrónica anulada ante la
 *      DIAN», «Invoice #42 is void», «Esta factura queda sin efecto»; «anulación / cancelación /
 *      cancellation / cancelamento (de la) factura», «Invoice cancellation notice»; «this invoice is
 *      void», «esta factura es nula» (estas últimas, sobre todo el texto);
 *    - nota crédito: solo cuando nombra al documento mismo: un título en su línea («NOTA CRÉDITO»,
 *      «CREDIT NOTE #», «Nota de crédito N.º NC-45») o «este documento es una nota crédito», «this is a
 *      credit note», «Tipo de documento: Nota crédito»;
 *    - borrador o proforma: «factura proforma», «proforma invoice», «prefactura», «draft invoice»,
 *      «borrador de factura», «sample invoice», «factura de muestra», «specimen invoice»;
 *    - no es una factura: «no válido como factura», «not valid as an invoice», «(is) not a (tax)
 *      invoice», «no es (una) factura», «sin validez fiscal / tributaria / legal», «não é (uma) fatura».
 *
 * No cuentan (falsos positivos medidos): «Nota fiscal de serviço» (es una factura en Brasil), «Nota:»
 * / «Notas», «la tabla muestra…», «Original / Copia», «Specimen collection fee», una nota crédito
 * nombrada como referencia o negada («no tiene nota crédito asociada», «Nº de nota de crédito: N/A»,
 * «Credit memo CM-201 applied»), y en las frases: las preguntas («¿Esto no es una factura proforma?»),
 * las condiciones («If your order is cancelled, this invoice is void», «Invoice is cancelled if not
 * paid»), las referencias a otra factura («Esa factura está anulada, vale esta», «la factura anterior
 * fue anulada», «Esta factura reemplaza la factura anulada FE-1020», «Comprobante cancelado y
 * sustituido por el presente»), las referencias a una proforma aprobada («Según prefactura PF-0045
 * aprobada», «Ref.: Factura proforma PF-12», «matches the proforma invoice PF-88») y «no es una
 * factura» en una cuenta de cobro (que sí se paga). Un sello en mayúsculas o en su línea marca siempre.
 */
import type { VoidDocumentKind } from "../core/schemas";
import { foldText, snippetAround } from "./heuristics";

/** Qué clase de documento no cobrable es (elige la acción que se le pide a la persona). */
export type VoidKind = VoidDocumentKind;

export interface VoidMarker {
  /** Línea del documento donde aparece (texto original, espacios colapsados). */
  text: string;
  /** Por qué no es un cobro válido, en español (si la línea activa varias marcas, unidas con "; "). */
  reason: string;
  /** La clase principal (si hay varias: anulado > nota crédito > borrador > no es factura). */
  kind: VoidKind;
}

const REASON: Record<VoidKind, string> = {
  void: "Dice que el documento está anulado o cancelado",
  credit_note: "Es una nota crédito (un abono a favor del cliente), no un cobro",
  draft: "Es un borrador, una proforma o un documento de muestra, no una factura definitiva",
  not_invoice: "Dice que no es una factura válida",
};
const KIND_ORDER: readonly VoidKind[] = ["void", "credit_note", "draft", "not_invoice"];

// ───────────────────────── Contexto de una frase ─────────────────────────

/** Excepciones que puede pedir una regla de frase. */
interface Skips {
  /** La frase está en una pregunta («¿…?»). */
  question?: boolean;
  /** La frase depende de una condición («si…», «if…», «en caso de…»). */
  conditional?: boolean;
  /** Habla de otra factura («esa factura», «la anterior», «reemplaza la factura anulada…»). */
  otherDocument?: boolean;
  /** Cita una proforma como referencia («según…», «ref.:», «matches…», «… aprobada»). */
  reference?: boolean;
  /** «No es una factura» en una cuenta de cobro (que sí se paga). */
  cuentaDeCobro?: boolean;
  /** Texto de una política («Cancellation policy: …»). */
  policy?: boolean;
}

const ALL_SKIPS: Skips = { question: true, conditional: true, otherDocument: true, reference: true, policy: true };

/** Límites de la frase que contiene [start, end) en el texto plegado: saltos de línea y . ! ? ; seguidos de espacio. */
function sentenceBounds(folded: string, start: number, end: number): [number, number] {
  let s = start;
  while (s > 0) {
    const ch = folded[s - 1];
    if (ch === "\n" || (/[.!?;]/.test(ch) && /\s/.test(folded[s] ?? " "))) break;
    s--;
  }
  let e = end;
  while (e < folded.length) {
    const ch = folded[e];
    if (ch === "\n") break;
    if (/[.!?;]/.test(ch) && (e + 1 >= folded.length || /\s/.test(folded[e + 1]))) {
      e++;
      break;
    }
    e++;
  }
  return [s, e];
}

/** Palabras de condición. «si» solo cuenta sin tilde en el original («sí» es una afirmación). */
const CONDITIONAL = /\b(?:if|unless|si|en\s+caso\s+de|a\s+menos\s+que|siempre\s+que|in\s+case|caso\s+(?:o|a)|salvo\s+que)\b/g;

function hasConditional(folded: string, from: number, to: number, original: string, map: number[]): boolean {
  const slice = folded.slice(from, to);
  for (const m of slice.matchAll(CONDITIONAL)) {
    if (m[0] === "si") {
      const at = map[from + m.index + 1];
      if (original[at] !== "i" && original[at] !== "I") continue;
    }
    return true;
  }
  return false;
}

const OTHER_DOC_BEFORE = /\b(?:esa|ese|aquella|aquel|that|those|previous|prior|old|la\s+otra|otra|anterior|vieja)\s+$/;
const OTHER_DOC_INSIDE = /\b(?:anterior|previous|prior|vieja|old|otra)\b/;
/** «reemplaza / sustituye (a) la factura anulada…»: la anulada es otra. */
const REPLACES_BEFORE = /\b(?:reemplaza|remplaza|sustituye|substitui|replaces|supersedes|sustitucion\s+de|reemplazo\s+de|in\s+(?:place|lieu)\s+of|en\s+lugar\s+de)\b/;
/** «… sustituido por el presente», «… vale esta»: el documento actual es el bueno. */
const REPLACED_BY_THIS = /\b(?:sustituid[oa]s?|reemplazad[oa]s?|remplazad[oa]s?|substituid[oa]s?|replaced|superseded)\s+(?:por|by)\s+(?:el\s+presente|la\s+presente|esta|este|this|el\s+actual|la\s+actual)\b|\bvale\s+esta\b|\besta\s+es\s+la\s+(?:buena|correcta|valida|vigente)\b|\bthis\s+one\s+is\s+(?:valid|correct)\b/;
const REFERENCE_BEFORE = /\b(?:segun|ref|referencia|de\s+acuerdo\s+(?:con|a)|conforme\s+(?:a|con)|matches|match|per|based\s+on|basad[oa]\s+en|corresponde\s+a|correspondiente\s+a|see|ver|en\s+base\s+a|related\s+to|relacionad[oa]\s+con|against|cotizad[oa]\s+en|quoted\s+in)\b/;
const REFERENCE_AFTER = /^[^\S\n]*(?:(?:n[.o°]*|no\.?|nro\.?|#|numero|number)[^\S\n]*)?[a-z0-9#./°-]*\d[a-z0-9#./°-]*[^\S\n]+(?:aprobad[oa]|approved|aceptad[oa]|accepted|firmad[oa]|signed)\b/;
const POLICY_BEFORE = /\b(?:politica|policy|terminos|terms|condiciones|conditions)\b/;

function skipped(skips: Skips, folded: string, original: string, map: number[], start: number, end: number): boolean {
  const [s, e] = sentenceBounds(folded, start, end);
  const before = folded.slice(s, start);
  const sentence = folded.slice(s, e);
  if (skips.question && (/¿[^?]*$/.test(before) || /\?\s*$/.test(sentence))) return true;
  if (skips.conditional) {
    const clauseEndRel = folded.slice(end, e).search(/,/);
    const clauseEnd = clauseEndRel === -1 ? e : end + clauseEndRel;
    if (hasConditional(folded, s, start, original, map) || hasConditional(folded, end, clauseEnd, original, map)) return true;
  }
  if (skips.otherDocument) {
    if (OTHER_DOC_BEFORE.test(before)) return true;
    if (OTHER_DOC_INSIDE.test(folded.slice(start, end))) return true;
    if (REPLACES_BEFORE.test(before)) return true;
    if (REPLACED_BY_THIS.test(folded.slice(end, e))) return true;
  }
  if (skips.reference) {
    const lineStart = folded.lastIndexOf("\n", start - 1) + 1;
    if (REFERENCE_BEFORE.test(folded.slice(lineStart, start))) return true;
    if (REFERENCE_AFTER.test(folded.slice(end, e))) return true;
  }
  if (skips.policy && POLICY_BEFORE.test(before)) return true;
  if (skips.cuentaDeCobro) {
    if (/\bcuenta\s+de\s+cobro\b|\bdocumento\s+(?:soporte|equivalente)\b/.test(folded)) return true;
  }
  return false;
}

// ───────────────────────── Frases ─────────────────────────

interface Rule {
  pattern: RegExp;
  kind: VoidKind;
  /** "document": solo la parte del texto que es el documento (sin citas de correos anteriores). */
  scope: "document" | "full";
  skips: Skips;
}

const DOC = "(?:factura|fatura|cuenta\\s+de\\s+cobro|documento|comprobante|nota\\s+fiscal|invoice|bill)";
/** Palabras que pueden ir entre el documento y la anulación: número, «electrónica», «de venta», «N.º». */
const FILLER =
  "(?:[^\\S\\n]+(?:[a-z0-9#./°:-]*\\d[a-z0-9#./°:-]*|n\\.o|n°|no\\.|no(?=[^\\S\\n]+[a-z]*-?\\d)|nro\\.?|num(?:ero)?\\.?|number|#|electronica|electronico|de|venta|fiscal|comercial|exportacion|tax|commercial|cfdi|folio|serie|[abcem]))";
const VOID_VERB = "(?:ha\\s+sido|fue|foi|esta|estan|queda|quedo|se\\s+encuentra|is|was|has\\s+been|have\\s+been|e)";
const VOID_WORD = "(?:anulad[oa]s?|cancelad[oa]s?|void(?:ed)?|cancell?ed|annulled|nul[oa]|invalidad[oa]|sin\\s+efecto|sem\\s+efeito)";
const VOID_NOUN = "(?:anulacion|cancelacion|cancellation|cancelamento|voiding)";
const CREDIT = "(?:nota\\s+(?:de\\s+)?credito|credit\\s+(?:note|memo)|nota\\s+de\\s+abono)";

const RULES: readonly Rule[] = [
  // «La factura CRD-1088 fue anulada», «Factura electrónica anulada», «Invoice #42 is void».
  {
    pattern: new RegExp(`\\b${DOC}\\b${FILLER}{0,4}\\s+(?:${VOID_VERB}\\s+)?${VOID_WORD}\\b`, "g"),
    kind: "void",
    scope: "document",
    skips: ALL_SKIPS,
  },
  // «Anulación de la factura CRD-1088», «Invoice cancellation notice».
  {
    pattern: new RegExp(`\\b${VOID_NOUN}\\s+(?:de\\s+(?:la\\s+|el\\s+)?|da\\s+|do\\s+|of\\s+(?:the\\s+)?)?${DOC}\\b|\\b${DOC}\\b${FILLER}{0,3}\\s+${VOID_NOUN}\\b(?!\\s+(?:policy|politica|terms|terminos|conditions|condiciones|fee|cargo))`, "g"),
    kind: "void",
    scope: "document",
    skips: ALL_SKIPS,
  },
  // «Esta factura es nula», «This invoice is void»: el documento habla de sí mismo (todo el texto).
  {
    pattern: new RegExp(`\\b(?:esta|este|this|el\\s+presente|la\\s+presente)\\s+(?:factura|fatura|documento|invoice|document|cuenta\\s+de\\s+cobro|comprobante)\\s+(?:es|is|e|esta|queda|fue|ha\\s+sido|was|has\\s+been)\\s+(?:nul[oa]|void(?:ed)?|invalid[oa]?|anulad[oa]|cancelad[oa]|cancell?ed|sin\\s+efecto)\\b`, "g"),
    kind: "void",
    scope: "full",
    skips: { question: true, conditional: true, policy: true },
  },
  // «Este documento es una nota crédito», «This is a credit note», «Tipo de documento: Nota crédito».
  {
    pattern: new RegExp(`\\b(?:esta|este|this)\\s+(?:documento\\s+|document\\s+)?(?:es|is|e)\\s+(?:una?\\s+|an?\\s+)?${CREDIT}\\b|\\b(?:tipo\\s+de\\s+(?:documento|comprobante)|document\\s+type)\\s*:?\\s*${CREDIT}\\b`, "g"),
    kind: "credit_note",
    scope: "document",
    skips: { question: true, conditional: true },
  },
  // Proforma, prefactura, borrador.
  {
    pattern: /\b(?:factura|fatura|invoice)\s+pro[\s-]?forma\b|\bpro[\s-]?forma\s+(?:invoice|factura|fatura)\b|\bpre[\s-]?factura\b|\bpro[\s-]?forma[^\S\n]*(?:n\.o|n°|no\.|no(?=\s*[a-z]*-?\d)|nro\.?|#|number|numero)/g,
    kind: "draft",
    scope: "document",
    skips: { question: true, conditional: true, reference: true },
  },
  {
    pattern: /\b(?:borrador\s+de\s+(?:factura|cuenta)|draft\s+invoice|(?:factura|invoice)\s+(?:borrador|draft)|sample\s+invoice|(?:factura|documento)\s+de\s+(?:muestra|ejemplo|prueba)|specimen\s+(?:invoice|copy|copia))\b/g,
    kind: "draft",
    scope: "document",
    skips: { question: true, conditional: true, reference: true },
  },
  // «No es una factura», «is not a tax invoice», «sin validez fiscal».
  {
    pattern: /\bno\s+(?:es\s+)?valid[oa]\s+como\s+factura\b|\bnot\s+valid\s+as\s+(?:an?\s+)?invoice\b|\bnot\s+an?\s+(?:tax\s+|valid\s+|official\s+|final\s+)?invoice\b|\bno\s+es\s+(?:una\s+)?factura\b|\bnao\s+e\s+(?:uma\s+)?(?:fatura|nota\s+fiscal)\b/g,
    kind: "not_invoice",
    scope: "document",
    skips: { question: true, conditional: true, cuentaDeCobro: true },
  },
  {
    pattern: /\bsin\s+validez\s+(?:fiscal|tributaria|legal|comercial)\b/g,
    kind: "not_invoice",
    scope: "document",
    skips: { question: true, conditional: true },
  },
];

// ───────────────────────── Citas de correos anteriores ─────────────────────────

const REPLY_HEADER = /^\s*(?:on\s.+\swrote:|el\s.+\sescribi[oó]:|em\s.+\sescreveu:)\s*$/i;
const BLOCK_HEADER = /^--- (?:Adjunto|Correo adjunto|Correo \(versión HTML\)):?.*---$/;

/**
 * El texto con las líneas citadas de mensajes anteriores en blanco (mismas posiciones): «> …» y, tras
 * «El … escribió:» / «On … wrote:», todo hasta el siguiente bloque de la entrada (un adjunto).
 */
export function withoutQuotedReplies(text: string): string {
  const lines = text.split("\n");
  let quoting = false;
  return lines
    .map((line) => {
      if (BLOCK_HEADER.test(line.trim())) quoting = false;
      else if (REPLY_HEADER.test(line)) quoting = true;
      const blank = quoting || /^\s*>/.test(line);
      return blank ? " ".repeat(line.length) : line;
    })
    .join("\n");
}

// ───────────────────────── Sellos ─────────────────────────

/** Palabras sello inequívocas: en mayúsculas cuentan en cualquier lugar; en otra caja, solas en su línea. */
const STRONG_STAMPS: Record<string, VoidKind> = {
  anulada: "void",
  anulado: "void",
  void: "void",
  voided: "void",
  borrador: "draft",
  draft: "draft",
  proforma: "draft",
};
/** Palabras sello ambiguas: solo con la línea entera en mayúsculas y nada más que acompañantes. */
const WEAK_STAMPS: Record<string, VoidKind> = {
  cancelled: "void",
  canceled: "void",
  nula: "void",
  nulo: "void",
  specimen: "draft",
  muestra: "draft",
  sample: "draft",
};
/** Palabras que pueden acompañar a un sello: una fecha, «pro» de «PRO FORMA», «NO PAGAR», «POR ERROR»… */
const STAMP_COMPANIONS: ReadonlySet<string> = new Set([
  "el", "en", "de", "del", "on", "em", "pro", "forma",
  "no", "pagar", "do", "not", "pay", "por", "error", "reemplazada", "reemplazado", "replaced", "by",
  "invoice", "factura", "fatura", "documento", "document", "copy", "copia", "sin", "valor", "value",
  "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
  "ene", "abr", "ago", "dic", "fev", "mai", "set", "out", "dez",
  "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "setiembre", "octubre", "noviembre", "diciembre",
  "january", "february", "march", "april", "june", "july", "august", "september", "october", "november", "december",
]);
const STATUS_LABEL = /^\s*(?:estado|status|situacion|state|estatus|condicion)\s*[:\-–]\s*(anulad[oa]|void(?:ed)?|cancell?ed|nul[oa]|borrador|draft|proforma)\b/;

function isUppercase(s: string): boolean {
  return s === s.toUpperCase() && s !== s.toLowerCase();
}

/** Palabras (letras) de una línea, con su posición, texto original y forma plegada. */
function wordsOf(line: string): { word: string; folded: string; index: number; end: number }[] {
  return [...line.matchAll(/\p{L}+/gu)].map((m) => ({ word: m[0], folded: foldText(m[0]).folded, index: m.index, end: m.index + m[0].length }));
}

interface Hit {
  line: string;
  position: number;
  kind: VoidKind;
}

/** Sellos en todo el texto (ver la marca 1 del encabezado). */
function stampHits(text: string, folded: string, map: number[]): Hit[] {
  const out: Hit[] = [];
  // Posición plegada de cada posición original (para revisar el contexto de un sello dentro de una frase).
  const foldedAt = new Map<number, number>();
  for (let k = map.length - 1; k >= 0; k--) foldedAt.set(map[k], k);
  let position = 0;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+/g, " ").trim();
    const words = wordsOf(raw);
    const lineHits = new Set<VoidKind>();
    // a) Sola en su línea (con fecha o acompañantes): las inequívocas en cualquier caja, las ambiguas
    //    solo con la línea entera en mayúsculas.
    if (words.length >= 1 && words.length <= 6) {
      const allUpper = words.every((w) => isUppercase(w.word));
      const joined = words.map((w) => w.folded).join("");
      const key =
        words.find((w) => STRONG_STAMPS[w.folded] != null)?.folded ??
        (allUpper ? words.find((w) => WEAK_STAMPS[w.folded] != null)?.folded : undefined) ??
        (STRONG_STAMPS[joined] != null ? joined : undefined);
      if (key != null) {
        const rest = words.filter((w) => w.folded !== key);
        if (key === joined || rest.every((w) => STAMP_COMPANIONS.has(w.folded))) lineHits.add(STRONG_STAMPS[key] ?? WEAK_STAMPS[key]);
      }
    }
    // b) Detrás de «Estado: / Status:».
    const lineFolded = foldText(raw).folded;
    const status = STATUS_LABEL.exec(lineFolded);
    if (status) {
      const w = status[1];
      lineHits.add(/^(?:borrador|draft|proforma)$/.test(w) ? "draft" : "void");
    }
    // c) Palabra sello inequívoca en mayúsculas en cualquier lugar de la línea (o partida: «ANULA DA»).
    const candidates: { kind: VoidKind; index: number; end: number }[] = [];
    for (const [i, w] of words.entries()) {
      if (!isUppercase(w.word)) continue;
      const kind = STRONG_STAMPS[w.folded];
      if (kind != null) {
        if (w.folded === "draft" && i > 0 && /^(?:bank|banker|bancario)$/.test(words[i - 1].folded)) continue;
        candidates.push({ kind, index: w.index, end: w.end });
        continue;
      }
      // Ventanas de 2 a 7 palabras en mayúsculas seguidas, separadas solo por espacios.
      let joined = w.folded;
      for (let j = i + 1; j < Math.min(words.length, i + 7); j++) {
        const gap = raw.slice(words[j - 1].end, words[j].index);
        if (!/^[ \t]+$/.test(gap) || !isUppercase(words[j].word)) break;
        joined += words[j].folded;
        const k = STRONG_STAMPS[joined];
        if (k != null) {
          candidates.push({ kind: k, index: w.index, end: words[j].end });
          break;
        }
      }
    }
    for (const c of candidates) {
      // Dentro de una frase, las mismas excepciones que las frases (otra factura, referencia, condición).
      const fs = foldedAt.get(position + c.index);
      const fe = foldedAt.get(position + c.end) ?? fs;
      const own = lineHits.size > 0;
      const skips: Skips = c.kind === "draft" ? { question: true, conditional: true, otherDocument: true, reference: true } : { question: true, conditional: true, otherDocument: true };
      if (!own && fs != null && fe != null && skipped(skips, folded, text, map, fs, fe)) continue;
      lineHits.add(c.kind);
    }
    for (const kind of lineHits) out.push({ line, position, kind });
    position += raw.length + 1;
  }
  return out;
}

/** Títulos de nota crédito en su línea: «NOTA CRÉDITO», «CREDIT NOTE #», «Nota de crédito N.º NC-45». */
function creditTitleHits(text: string): Hit[] {
  const out: Hit[] = [];
  let position = 0;
  const head = new RegExp(`^[\\s*#=_~\\-–—]*${CREDIT}\\b`);
  for (const raw of text.split("\n")) {
    const folded = foldText(raw).folded;
    const m = head.exec(folded);
    if (m) {
      const tail = folded.slice(m[0].length).replace(/[*=_~\-–—:]+\s*$/, "").trim();
      const tokens = tail === "" ? [] : tail.split(/\s+/);
      const ok =
        tokens.length <= 3 &&
        tokens.every((t) => /\d/.test(t) || /^(?:electronica|electronic|n[.o°]*|no\.?|nro\.?|numero|number|#|:|n[.o°]*:?|no\.?:)$/.test(t));
      if (ok) out.push({ line: raw.replace(/\s+/g, " ").trim(), position, kind: "credit_note" });
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
  const full = foldText(text);
  const documentText = withoutQuotedReplies(text);
  const docFolded = documentText === text ? full : foldText(documentText);
  const bySnippet = new Map<string, { position: number; kinds: Set<VoidKind> }>();
  const record = (snippet: string, position: number, kind: VoidKind) => {
    if (!snippet) return;
    const entry = bySnippet.get(snippet);
    if (entry) {
      entry.kinds.add(kind);
      entry.position = Math.min(entry.position, position);
    } else {
      bySnippet.set(snippet, { position, kinds: new Set([kind]) });
    }
  };
  for (const rule of RULES) {
    const { folded, map } = rule.scope === "full" ? full : docFolded;
    const source = rule.scope === "full" ? text : documentText;
    for (const m of folded.matchAll(rule.pattern)) {
      const fStart = m.index;
      const fEnd = m.index + m[0].length;
      if (skipped(rule.skips, folded, source, map, fStart, fEnd)) continue;
      const start = map[fStart];
      const end = Math.max(map[Math.min(fEnd, map.length - 1)], start + 1);
      record(snippetAround(text, start, end), start, rule.kind);
    }
  }
  for (const { line, position, kind } of stampHits(text, full.folded, full.map)) record(line, position, kind);
  for (const { line, position, kind } of creditTitleHits(documentText)) record(line, position, kind);
  return [...bySnippet.entries()]
    .sort((a, b) => a[1].position - b[1].position)
    .map(([snippet, { kinds }]) => {
      const ordered = KIND_ORDER.filter((k) => kinds.has(k));
      return { text: snippet, reason: ordered.map((k) => REASON[k]).join("; "), kind: ordered[0] };
    });
}
