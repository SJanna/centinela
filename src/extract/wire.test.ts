import { describe, expect, it } from "vitest";
import { ExtractionSchema } from "../core/schemas";
import { extractionOutputFormat } from "./anthropic-reader";
import { makeExtraction, field } from "./test-utils";
import { extractionToWire, parseWireNumber, wireToExtraction, WireExtractionSchema } from "./wire";

/** Cuenta parámetros con tipos unión (anyOf/oneOf o "type" en arreglo) en un JSON Schema. */
function countUnions(node: unknown): number {
  if (Array.isArray(node)) return node.reduce((n, x) => n + countUnions(x), 0);
  if (node == null || typeof node !== "object") return 0;
  const obj = node as Record<string, unknown>;
  const here = ("anyOf" in obj || "oneOf" in obj || Array.isArray(obj.type)) ? 1 : 0;
  return here + Object.values(obj).reduce<number>((n, v) => n + countUnions(v), 0);
}

describe("esquema de cable", () => {
  it("no tiene tipos unión (la API admite como máximo 16)", () => {
    expect(countUnions(extractionOutputFormat().schema)).toBe(0);
  });

  it("ida y vuelta: Extraction → cable → Extraction", () => {
    const e = makeExtraction();
    const back = wireToExtraction(WireExtractionSchema.parse(extractionToWire(e)));
    expect(back.ok).toBe(true);
    if (back.ok) expect(ExtractionSchema.parse(back.extraction)).toEqual(e);
  });
});

describe("parseWireNumber", () => {
  it("acepta solo decimales simples", () => {
    expect(parseWireNumber("12000000")).toBe(12000000);
    expect(parseWireNumber(" 9500.5 ")).toBe(9500.5);
    expect(parseWireNumber("-3")).toBe(-3);
    for (const bad of ["12.000.000,00", "1,200.00", "1e3", "USD 1200", "", "NaN", "Infinity", "1 200"]) {
      expect(parseWireNumber(bad), bad).toBeNull();
    }
  });
});

describe("wireToExtraction", () => {
  it("dato ausente → null; evidencia vacía → null", () => {
    const w = extractionToWire(makeExtraction({ tax: field<number>(null, null) }));
    const r = wireToExtraction(w);
    expect(r.ok && r.extraction.tax).toEqual({ value: null, evidence: null, legible: true });
  });

  it("found=false ignora cualquier value que venga", () => {
    const w = extractionToWire(makeExtraction());
    w.vendorName = { found: false, value: "Alguien", evidence: "", legible: true };
    const r = wireToExtraction(w);
    expect(r.ok && r.extraction.vendorName.value).toBeNull();
  });

  it("un total que no es número no se adivina: queda ausente e ilegible", () => {
    const w = extractionToWire(makeExtraction());
    w.total = { found: true, value: "12.000.000,00", evidence: "COP 12.000.000,00", legible: true };
    const r = wireToExtraction(w);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.extraction.total).toEqual({ value: null, evidence: "COP 12.000.000,00", legible: false });
      expect(r.extraction.readerNotes).toMatch(/total/);
    }
  });

  it("una línea con monto inválido invalida la lectura", () => {
    const w = extractionToWire(makeExtraction());
    w.lineItems = [{ description: "Servicio", quantity: "", unitPrice: "", amount: "mil" }];
    expect(wireToExtraction(w).ok).toBe(false);
  });

  it("cantidad o precio vacíos → null; inválidos → error", () => {
    const w = extractionToWire(makeExtraction());
    w.lineItems = [{ description: "Horas", quantity: "40", unitPrice: "", amount: "36000" }];
    const r = wireToExtraction(w);
    expect(r.ok && r.extraction.lineItems[0]).toEqual({ description: "Horas", quantity: 40, unitPrice: null, amount: 36000 });
    w.lineItems = [{ description: "Horas", quantity: "cuarenta", unitPrice: "900", amount: "36000" }];
    expect(wireToExtraction(w).ok).toBe(false);
  });
});
