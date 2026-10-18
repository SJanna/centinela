/**
 * ¿La propia lectura anota que el documento no es un cobro válido? Un lector puede ver un sello
 * «ANULADA», una marca de agua «BORRADOR» o el título «PROFORMA INVOICE», escribirlo en readerNotes y
 * aun así clasificar el documento como factura. Ninguna regla leía esas notas: el documento se pagaba.
 * Funciona en cualquier documento (también en imágenes, donde no hay texto que revisar), porque lo que
 * se lee es lo que escribió el lector. Solo puede escalar, nunca pagar.
 *
 * Marcas (sobre la nota plegada: minúsculas, sin tildes), por parte de la frase:
 * - borrador, draft, documento preliminar;
 * - proforma, pro forma, pro-forma;
 * - anulada/anulado/anulación, void/voided;
 * - nota (de) crédito, credit note/memo, nota de abono;
 * - «no es (una) factura», «not a (tax/valid/final) invoice», «sin validez», «no válido como factura»,
 *   «not valid». («no es un cobro» no cuenta: una lectura escribe «no es un cobro de cuenta de cobro»
 *   para decir que es una factura y no una cuenta de cobro.)
 * No cuentan si en la misma parte de la frase (hasta una coma), hasta 25 caracteres antes de la marca, hay una negación («no hay sello de
 * anulado», «sin marca de borrador», «no es un borrador», «no tiene notas crédito»).
 */

const MARKERS: readonly { pattern: RegExp; reason: string }[] = [
  { pattern: /\bborrador\b|\bdraft\b|\bdocumento\s+preliminar\b/g, reason: "es un borrador" },
  { pattern: /\bpro[\s-]?forma\b/g, reason: "es una proforma" },
  { pattern: /\banulad[oa]s?\b|\banulacion\b|\bvoid(?:ed)?\b/g, reason: "está anulado" },
  { pattern: /\bnotas?\s+(?:de\s+)?credito\b|\bcredit\s+(?:note|memo)s?\b|\bnota\s+de\s+abono\b/g, reason: "es una nota crédito" },
  {
    pattern:
      /\bno\s+es\s+(?:una\s+)?factura\b|\bnot\s+an?\s+(?:tax\s+|valid\s+|final\s+|real\s+)?invoice\b|\bsin\s+validez\b|\bno\s+(?:es\s+)?valid[oa]\s+como\s+factura\b|\bnot\s+valid\b/g,
    reason: "dice que no es una factura válida",
  },
];

/** Negación antes de la marca, en la misma parte de la frase. */
const NEGATION_BEFORE = /\b(?:no|sin|ni|ningun[oa]?|nada|tampoco|nunca|not|no\s+hay|no\s+tiene|no\s+lleva|no\s+aparece|no\s+muestra|no\s+se\s+ve|without|there\s+is\s+no)\b[^.;:!?,]{0,25}$/;

function fold(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export interface VoidNote {
  /** Parte de la nota donde aparece (texto original, espacios colapsados, hasta 160 caracteres). */
  text: string;
  /** Qué dice la nota del documento, en español («es un borrador»). */
  reason: string;
}

/** Marcas de documento no cobrable en una nota de lector. Una por parte de la frase, en orden. */
export function voidMarkersInNotes(notes: string | null | undefined): VoidNote[] {
  if (!notes || !notes.trim()) return [];
  const out: VoidNote[] = [];
  // Partes de la frase sobre el texto original; se pliega cada una (el plegado puede cambiar el largo).
  for (const raw of notes.split(/[.;:!?,\n]+/)) {
    const clause = fold(raw);
    const reasons: string[] = [];
    for (const { pattern, reason } of MARKERS) {
      for (const m of clause.matchAll(pattern)) {
        if (NEGATION_BEFORE.test(clause.slice(0, m.index))) continue;
        if (!reasons.includes(reason)) reasons.push(reason);
      }
    }
    if (reasons.length > 0) out.push({ text: raw.replace(/\s+/g, " ").trim().slice(0, 160), reason: reasons.join("; ") });
  }
  return out;
}
