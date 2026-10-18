import { beforeAll, describe, expect, it } from "vitest";
import type { CheckCode } from "../../src/core/schemas";
import { readCases, readCompany, readScenarios } from "./cases";
import { evaluateDataset, humanOnlyIssues, type OracleResult } from "./oracle";
import { loadSpecs } from "./spec";
import { generatedCases } from "./test-helpers";

const rows = readCases();
const company = readCompany();
const scenarios = readScenarios();
let results: Map<string, OracleResult>;

beforeAll(async () => {
  const cases = await generatedCases();
  const specs = new Map(loadSpecs().map((s) => [s.id, s]));
  const byCase = new Map(
    cases.map((c) => [c.caseId, { caseId: c.caseId, sha256: c.sha256, groundTruth: c.groundTruth, humanOnly: humanOnlyIssues(specs.get(c.caseId)!, specs) }]),
  );
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
  // Northwind cobra USD 7.200 por acuerdo: cualquier factura suya supera el umbral de USD 5.000.
  // (Con el límite anterior de USD 25.000 también fallaba LIM-2: 21.005 + 7.200 > 25.000.)
  B23: ["LIM-1"],
  // Escenario base, B24 en adelante.
  // La nota crédito de USD 48 tampoco es el monto pactado (USD 240).
  B77: ["ACU-3"],
  // Las copias exactas repiten también número y periodo ya pagados.
  B79: ["DUP-2", "DUP-3"],
  B120: ["DUP-2", "DUP-3"],
  // El mismo número en otro formato (correo, foto) también repite el periodo ya pagado.
  B90: ["DUP-3"],
  B102: ["DUP-3"],
  B115: ["DUP-3"],
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
    expect(results.get("B56")!.amountUsd).toBeCloseTo(423.5, 6);
  });

  it("el escenario base paga USD 128.081,90: el 85 % del límite del mes (USD 150.000) y nunca toca el fondo", () => {
    const base = rows.filter((r) => r.escenario === "base").map((r) => results.get(r.id)!);
    const paid = base.filter((r) => r.outcome === "PAGAR");
    const cents = paid.reduce((s, r) => s + Math.round((r.amountUsd ?? 0) * 100), 0);
    expect(base).toHaveLength(120);
    expect(paid).toHaveLength(82);
    expect(cents).toBe(12_808_190);
    expect(cents).toBeLessThan(company.rules.periodLimitUsd * 100 * 0.9);
    expect(base.some((r) => r.failing.includes("LIM-2") || r.failing.includes("FON-1"))).toBe(false);
    // Ningún pago supera el umbral de aprobación: las facturas que lo superan escalan (B11, B23).
    expect(Math.max(...paid.map((r) => r.amountUsd ?? 0))).toBeLessThanOrEqual(company.rules.approvalThresholdUsd);
  });
});
