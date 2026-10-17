/**
 * Reglas absurdas por la API: la empresa puede cambiar sus reglas, pero no a valores que harían
 * pagar cualquier cosa (o que dejarían a la guardia sin poder revisar nada).
 */
import { describe, expect, it } from "vitest";
import { loadDatasetCompany } from "@/pipeline";
import { RulesInputSchema } from "./company";

const rules = loadDatasetCompany().rules;
const accepts = (patch: Record<string, unknown>) => RulesInputSchema.safeParse({ ...rules, ...patch }).success;

describe("RulesInputSchema", () => {
  it("acepta las reglas del dataset y los bordes válidos", () => {
    expect(accepts({})).toBe(true);
    expect(accepts({ amountTolerancePct: 0 })).toBe(true);
    expect(accepts({ amountTolerancePct: 100 })).toBe(true);
    expect(accepts({ approvalThresholdUsd: 0, periodLimitUsd: 0, initialFundUsd: 0 })).toBe(true);
    expect(accepts({ initialFundUsd: 1_000_000_000_000 })).toBe(true);
  });

  it.each([
    ["tolerancia 1000 %", { amountTolerancePct: 1000 }],
    ["tolerancia 100,01 %", { amountTolerancePct: 100.01 }],
    ["tolerancia negativa", { amountTolerancePct: -1 }],
    ["umbral negativo", { approvalThresholdUsd: -1 }],
    ["umbral como texto", { approvalThresholdUsd: "5000" }],
    ["umbral null (así llega un NaN por JSON)", { approvalThresholdUsd: null }],
    ["límite mensual enorme (centavos no exactos)", { periodLimitUsd: 1e16 }],
    ["fondo enorme", { initialFundUsd: 1e300 }],
    ["tasa cero", { fxToUsd: { ...rules.fxToUsd, COP: 0 } }],
    ["tasa negativa", { fxToUsd: { ...rules.fxToUsd, COP: -0.00025 } }],
    ["USD distinto de 1", { fxToUsd: { ...rules.fxToUsd, USD: 0.5 } }],
    ["moneda en minúsculas", { fxToUsd: { ...rules.fxToUsd, eur: 1.08 } }],
    ["moneda que no es un código", { fxToUsd: { ...rules.fxToUsd, "US$": 1 } }],
  ])("rechaza %s", (_label, patch) => {
    expect(accepts(patch)).toBe(false);
  });
});
