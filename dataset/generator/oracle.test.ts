import { beforeAll, describe, expect, it } from "vitest";
import type { CheckCode } from "../../src/core/schemas";
import { readCases, readCompany, readScenarios } from "./cases";
import { evaluateDataset, type OracleResult } from "./oracle";
import { generatedCases } from "./test-helpers";

const rows = readCases();
const company = readCompany();
const scenarios = readScenarios();
let results: Map<string, OracleResult>;

beforeAll(async () => {
  const cases = await generatedCases();
  const byCase = new Map(cases.map((c) => [c.caseId, { caseId: c.caseId, sha256: c.sha256, groundTruth: c.groundTruth }]));
  results = new Map(evaluateDataset(company, scenarios, rows, byCase).map((r) => [r.caseId, r]));
});

/**
 * Comprobaciones que fallan además de las esperadas, de forma inevitable por cómo están
 * definidos el caso y la ficha (se documentan aquí para que un cambio no pase inadvertido).
 */
const KNOWN_EXTRA_FAILURES: Record<string, CheckCode[]> = {
  // El mismo archivo también repite número y periodo ya pagados.
  B07: ["DUP-2", "DUP-3"],
  // Reenviar la misma factura también repite el periodo ya pagado.
  B08: ["DUP-3"],
  // Facturar en COP una cotización pactada en USD tampoco cuadra en monto.
  B14: ["ACU-3"],
  // La nota visible no cambia nada más.
  B16: [],
  // Si el total dice 2.180 con 30 h × 60, tampoco cuadra con la tarifa.
  B18: ["ACU-3"],
  // Northwind cobra USD 7.200 por acuerdo: cualquier factura suya supera el umbral de USD 5.000,
  // y a esa altura del escenario base ya se pagaron USD 21.005 (21.005 + 7.200 > 25.000).
  B23: ["LIM-1", "LIM-2"],
  // La foto del mismo documento también repite el periodo ya pagado.
  H03: ["DUP-3"],
  // El correo que pide pagar a otra cuenta es, además, una instrucción incrustada.
  H05: ["LEC-4"],
};

describe("oráculo del dataset (lectura perfecta + reglas de company.json)", () => {
  it("cada caso produce la decisión esperada de casos.csv", () => {
    const wrong = rows
      .filter((r) => results.get(r.id)!.outcome !== r.decision_esperada)
      .map((r) => `${r.id}: esperaba ${r.decision_esperada}, sale ${results.get(r.id)!.outcome} (${results.get(r.id)!.failing.join(", ")})`);
    expect(wrong).toEqual([]);
  });

  it("los códigos esperados fallan en cada caso", () => {
    for (const r of rows) {
      const res = results.get(r.id)!;
      for (const code of r.codigos_esperados) expect(res.failing, `${r.id} debería fallar ${code}`).toContain(code);
    }
  });

  it("cada caso falla solo por lo que describe (más los efectos inevitables documentados)", () => {
    for (const r of rows) {
      const res = results.get(r.id)!;
      const extra = res.failing.filter((code) => !r.codigos_esperados.includes(code));
      expect(extra, r.id).toEqual(KNOWN_EXTRA_FAILURES[r.id] ?? []);
    }
  });

  it("los casos PAGAR no tienen comprobaciones sin evaluar", () => {
    for (const r of rows.filter((x) => x.decision_esperada === "PAGAR")) {
      expect(results.get(r.id)!.notEvaluable, r.id).toEqual([]);
    }
  });

  it("los montos en USD de los escenarios cuadran con las descripciones", () => {
    expect(results.get("M03")!.amountUsd).toBeCloseTo(1805, 6);
    expect(results.get("B12")!.amountUsd).toBeCloseTo(3400, 6);
    expect(results.get("H08")!.amountUsd).toBeCloseTo(1630.8, 6);
  });
});
