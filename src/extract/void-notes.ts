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
 * Frases genéricas («no es una factura», «sin validez», «not a tax invoice») NO cuentan en las notas:
 * las lecturas las escriben también de documentos que sí se pagan («Documento es un mensaje de chat con
 * datos de factura; no es una factura formal», «representación impresa sin validez fiscal visible» de
 * un CFDI). En el texto del propio documento sí cuentan (void-markers.ts).
 * No cuentan si antes, en la misma oración, hay una negación que la alcanza («no hay sello de anulado»,
 * «sin marca de borrador», «no es un borrador», «no tiene notas crédito», «Ninguna marca de anulado,
 * borrador, proforma ni pagado»: con v6 las lecturas anotan así que NO vieron marcas).
 */

import type { VoidDocumentKind } from "../core/schemas";

const MARKERS: readonly { pattern: RegExp; reason: string; kind: VoidDocumentKind }[] = [
  { pattern: /\bborrador\b|\bdraft\b|\bdocumento\s+preliminar\b/g, reason: "es un borrador", kind: "draft" },
  { pattern: /\bpro[\s-]?forma\b/g, reason: "es una proforma", kind: "draft" },
  { pattern: /\banulad[oa]s?\b|\banulacion\b|\bvoid(?:ed)?\b/g, reason: "está anulado", kind: "void" },
  { pattern: /\bnotas?\s+(?:de\s+)?credito\b|\bcredit\s+(?:note|memo)s?\b|\bnota\s+de\s+abono\b/g, reason: "es una nota crédito", kind: "credit_note" },
];

/**
 * Negación: una palabra negativa antes de la marca en la misma oración niega la marca y todo lo que
 * sigue en una lista («Ninguna marca de anulado, borrador, proforma ni pagado»; «no se encontraron
 * marcas de anulación, borrador o muestra»), hasta que la oración cambia de rumbo: «pero», «aunque»,
 * «sin embargo», «y es…», «, es…» («No tiene vencimiento y es una proforma» sí cuenta).
 */
const NEGATOR = /\b(?:no|sin|ni|ningun[oa]?s?|nada|tampoco|nunca|not|none|neither|nor|without)\b/;
const SCOPE_BREAK =
  /\b(?:pero|aunque|sin\s+embargo|no\s+obstante|salvo|excepto|but|however|although|except)\b|(?:\by|,)\s+(?:(?:el|la)\s+(?:documento|factura)\s+)?(?:es|esta|se\s+trata|se\s+clasifica|dice|indica|lleva|tiene|muestra|figura|aparece|declara|presenta)\b|\band\s+(?:is|it\s+is|has|shows|says)\b/g;

function negatedBefore(prefix: string): boolean {
  let from = 0;
  for (const m of prefix.matchAll(SCOPE_BREAK)) from = m.index + m[0].length;
  return NEGATOR.test(prefix.slice(from));
}

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
  /** Clase de la primera marca de esa parte de la nota. */
  kind: VoidDocumentKind;
}

/** Marcas de documento no cobrable en una nota de lector. Una por parte de la frase, en orden. */
export function voidMarkersInNotes(notes: string | null | undefined): VoidNote[] {
  if (!notes || !notes.trim()) return [];
  const out: VoidNote[] = [];
  // Oraciones del texto original; se pliega cada una (el plegado puede cambiar el largo). No se parte en
  // las comas: una negación cubre la lista que sigue.
  for (const raw of notes.split(/[.;:!?\n]+/)) {
    const clause = fold(raw);
    const reasons: string[] = [];
    let kind: VoidDocumentKind | null = null;
    for (const { pattern, reason, kind: k } of MARKERS) {
      for (const m of clause.matchAll(pattern)) {
        if (negatedBefore(clause.slice(0, m.index))) continue;
        if (!reasons.includes(reason)) reasons.push(reason);
        kind ??= k;
      }
    }
    if (kind != null) out.push({ text: raw.replace(/\s+/g, " ").trim().slice(0, 160), reason: reasons.join("; "), kind });
  }
  return out;
}
