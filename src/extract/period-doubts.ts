/**
 * Lecturas que dudan del periodo de servicio, sin modelo (errores honestos, redteam/attacks/honestos):
 * en una foto con el periodo borroso, las dos lecturas pueden dejarlo vacío. Entonces el motor imputaría
 * la factura al mes de su fecha y, si la factura era de un mes ya pagado, lo pagaría dos veces. Un
 * periodo que el documento SÍ trae pero no se lee no es un periodo ausente.
 *
 * Cuenta una lectura que:
 * - marca el periodo como ilegible (`servicePeriod.legible === false`), con o sin valor ("flag"); o
 * - anota en `readerNotes` que el periodo está borroso o no se lee ("note"): «periodo / period /
 *   competência» seguido, con solo palabras de relleno en medio, de una duda visual (borroso, ilegible,
 *   desenfocado, no se lee, no se pudo leer, blurry, illegible, unreadable, desfocado). Deducirlo de la
 *   fecha no es una duda: un periodo que la factura no escribe es «ausente», y de eso se ocupan DUP-3
 *   y el detector de mes anterior.
 *
 * Con texto verificable (un PDF con texto) cuentan igual: si una lectura duda del periodo, no se
 * imputa a ciegas. En las 1.486 lecturas reales guardadas del dataset (base y estrés) ninguna marca
 * el periodo ilegible ni lo anota borroso.
 */
import type { ReaderResult, ReadingSignals } from "@/core/schemas";

export type PeriodDoubt = NonNullable<ReadingSignals["servicePeriodDoubts"]>[number];

/** Sustantivos de periodo (texto plegado: sin tildes, minúsculas). */
const PERIOD_NOUNS = new Set(["periodo", "periodos", "period", "competencia"]);
/**
 * Palabras que pueden ir entre el periodo y la duda sin cambiar de qué se habla: «el periodo (PERIODO)
 * está borroso», «el periodo de facturación (BILLING PERIOD) está borroso», «el periodo de octubre de
 * 2026 se ve borroso». Cualquier otra palabra corta la búsqueda: «Cargos adicionales del periodo con un
 * monto borroso» habla del monto, no del periodo.
 */
const FILLER = new Set([
  "de", "del", "el", "la", "en", "es", "esta", "estan", "aparece", "aparecen", "se", "ve", "ven", "queda", "quedo",
  "is", "are", "appears", "seems", "looks", "the", "field", "campo", "valor", "value",
  "facturacion", "facturado", "servicio", "servicios", "billing", "service", "periodo", "period", "competencia",
  "totalmente", "parcialmente", "completamente", "muy", "algo", "bastante", "un", "poco", "partly", "partially", "very", "slightly",
  "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "setiembre", "octubre", "noviembre", "diciembre",
]);
/**
 * El periodo como complemento de otra cosa («Cargos adicionales del periodo están borrosos», «según el
 * periodo indicado»): la duda es de esa otra cosa. «El campo de periodo» sí habla del periodo.
 */
const MODIFIER_BEFORE = new Set(["del", "al", "por", "segun", "con", "para", "of", "for", "by", "per"]);

/** Duda VISUAL sobre lo escrito, por raíz. Sin «deducido» (un periodo que no está escrito es otra cosa). */
const BLUR_STEMS = ["borros", "ilegib", "ilegiv", "illegib", "desenfoc", "desfocad", "difumin", "tapad", "blurr", "unreadable", "obscured"];
/** Dudas de varias palabras («no se lee», «no se pudo leer», «not legible»). */
const BLUR_PHRASES: readonly string[][] = [
  ["no", "se", "lee"],
  ["no", "se", "leen"],
  ["no", "se", "pudo", "leer"],
  ["no", "se", "puede", "leer"],
  ["no", "pude", "leer"],
  ["no", "es", "legible"],
  ["no", "esta", "legible"],
  ["no", "legible"],
  ["no", "se", "distingue"],
  ["could", "not", "be", "read"],
  ["not", "legible"],
  ["not", "readable"],
];

function fold(s: string): string {
  return s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function blurAt(words: readonly string[], i: number): boolean {
  if (BLUR_STEMS.some((stem) => words[i].startsWith(stem))) return true;
  return BLUR_PHRASES.some((phrase) => phrase.every((w, k) => words[i + k] === w));
}

/** ¿Esta parte de la frase dice que el periodo mismo está borroso o no se lee? */
function partDoubtsPeriod(part: string): boolean {
  const words = fold(part).split(/[^a-z0-9]+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    if (!PERIOD_NOUNS.has(words[i])) continue;
    const before = words[i - 1] === "el" || words[i - 1] === "the" ? words[i - 2] : words[i - 1];
    if (before != null && MODIFIER_BEFORE.has(before)) continue;
    for (let j = i + 1; j < words.length && j <= i + 7; j++) {
      if (blurAt(words, j)) return true;
      if (!FILLER.has(words[j]) && !/^\d+$/.test(words[j])) break;
    }
  }
  return false;
}

/**
 * La parte de la nota (hasta un punto, coma, punto y coma o salto de línea) que dice que el periodo
 * está borroso o no se lee. La duda tiene que venir DESPUÉS del periodo y pegada a él (con palabras de
 * relleno en medio): «no hay partes borrosas en el periodo» o «el periodo no está borroso» no cuentan.
 */
export function periodDoubtInNote(note: string): string | null {
  for (const part of note.split(/[.,;!?\n]+/)) {
    if (partDoubtsPeriod(part)) {
      const text = part.replace(/\s+/g, " ").trim();
      if (text !== "") return text;
    }
  }
  return null;
}

/** Una entrada por lectura que duda del periodo (la marca primero; si no, la nota). */
export function periodDoubtsOf(readings: ReadonlyArray<ReaderResult | null | undefined>): PeriodDoubt[] {
  const out: PeriodDoubt[] = [];
  for (const r of readings) {
    if (!r?.ok) continue;
    const e = r.extraction;
    const sp = e.servicePeriod;
    if (sp?.legible === false) {
      out.push({ readerId: r.readerId, source: "flag", text: (sp.evidence ?? "").replace(/\s+/g, " ").trim() });
      continue;
    }
    const note = periodDoubtInNote(e.readerNotes ?? "");
    if (note != null) out.push({ readerId: r.readerId, source: "note", text: note });
  }
  return out;
}
