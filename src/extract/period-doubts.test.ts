import { describe, expect, it } from "vitest";
import type { Extraction, ReaderResult } from "../core/schemas";
import { periodDoubtInNote, periodDoubtsOf } from "./period-doubts";
import { makeExtraction } from "./test-utils";

function reader(readerId: string, over: Partial<Extraction>): ReaderResult {
  return { ok: true, readerId, model: "claude-haiku-5-5", promptVersion: "v6", extraction: { ...makeExtraction(), ...over } };
}

describe("periodDoubtInNote: la nota dice que el periodo mismo está borroso o no se lee", () => {
  it.each([
    ["El campo de periodo está borroso; no se pudo leer con certeza el mes/año.", "El campo de periodo está borroso"],
    ["El período (PERIODO) está borroso: el valor que se alcanza a leer es ilegible", "El período (PERIODO) está borroso: el valor que se alcanza a leer es ilegible"],
    ["El periodo de facturación (BILLING PERIOD) está borroso, no se puede confirmar el mes.", "El periodo de facturación (BILLING PERIOD) está borroso"],
    ["El periodo de octubre de 2026 se ve borroso.", "El periodo de octubre de 2026 se ve borroso"],
    ["The billing period is blurry.", "The billing period is blurry"],
    ["Service period illegible.", "Service period illegible"],
    ["PERIODO ilegible", "PERIODO ilegible"],
    ["El periodo no se lee.", "El periodo no se lee"],
    ["Competência ilegível na foto.", "Competência ilegível na foto"],
  ])("«%s»", (note, part) => {
    expect(periodDoubtInNote(note)).toBe(part);
  });

  it.each([
    "El monto de 'Cargos adicionales del periodo' está borroso e ilegible.",
    "No hay partes borrosas en el periodo ni en el total.",
    "El periodo no está borroso.",
    "10/07 y 09/08 no son ambiguos por el contexto de vencimiento y periodo, pero marcadas como no legibles por deducción del formato.",
    "Se toma 2026-10-12 por el periodo indicado y se marca no legible.",
    "Periodo deducido de la fecha de emisión.",
    "El periodo cubierto es octubre de 2026.",
    "Periodo no indicado en el documento.",
    "El total está borroso; el periodo se lee bien.",
    "Documento sin marcas de anulado, borrador ni proforma.",
  ])("no cuenta: «%s»", (note) => {
    expect(periodDoubtInNote(note)).toBeNull();
  });
});

describe("periodDoubtsOf", () => {
  it("una entrada por lectura: la marca de ilegible primero, si no la nota", () => {
    const flagged = reader("lector-a", {
      servicePeriod: { value: null, evidence: "PERIODO 10/2026 (borroso)", legible: false },
      readerNotes: "El campo de periodo está borroso.",
    });
    const noted = reader("lector-b", { readerNotes: "El periodo se ve borroso en la foto." });
    expect(periodDoubtsOf([flagged, noted])).toEqual([
      { readerId: "lector-a", source: "flag", text: "PERIODO 10/2026 (borroso)" },
      { readerId: "lector-b", source: "note", text: "El periodo se ve borroso en la foto" },
    ]);
  });

  it("un periodo que la factura no trae (vacío y legible) no es una duda", () => {
    const blank = reader("lector-a", { servicePeriod: { value: null, evidence: null, legible: true }, readerNotes: "Sin periodo escrito." });
    expect(periodDoubtsOf([blank, null])).toEqual([]);
  });

  it("una lectura que falló no cuenta", () => {
    const failed: ReaderResult = { ok: false, readerId: "lector-b", model: "m", promptVersion: "v6b", error: "api_error", message: "x" };
    expect(periodDoubtsOf([failed])).toEqual([]);
  });
});
