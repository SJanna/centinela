import { describe, expect, it } from "vitest";
import { clopperPearson, inverseRegularizedBeta, regularizedBeta } from "./stats";

describe("Clopper-Pearson", () => {
  it("valores de referencia (95 %)", () => {
    // 0 de 10: [0, 1 − 0,025^(1/10)]; 10 de 10: [0,025^(1/10), 1].
    expect(clopperPearson(0, 10).high).toBeCloseTo(1 - 0.025 ** 0.1, 6);
    expect(clopperPearson(0, 10).low).toBe(0);
    expect(clopperPearson(10, 10).low).toBeCloseTo(0.025 ** 0.1, 6);
    expect(clopperPearson(10, 10).high).toBe(1);
    // 5 de 10: [0,1871, 0,8129] (tablas estándar).
    const mid = clopperPearson(5, 10);
    expect(mid.low).toBeCloseTo(0.187086, 5);
    expect(mid.high).toBeCloseTo(0.812914, 5);
    // 0 de 2000 pagos indebidos: el techo es ~0,18 %.
    expect(clopperPearson(0, 2000).high).toBeCloseTo(0.001843, 5);
  });

  it("el intervalo contiene la proporción observada y se angosta con más casos", () => {
    const small = clopperPearson(9, 10);
    const big = clopperPearson(900, 1000);
    for (const i of [small, big]) {
      expect(i.low).toBeLessThanOrEqual(i.rate);
      expect(i.high).toBeGreaterThanOrEqual(i.rate);
    }
    expect(big.high - big.low).toBeLessThan(small.high - small.low);
  });

  it("sin casos no hay información; entradas inválidas fallan", () => {
    expect(clopperPearson(0, 0)).toEqual({ rate: 0, low: 0, high: 1 });
    expect(() => clopperPearson(3, 2)).toThrow();
    expect(() => clopperPearson(-1, 2)).toThrow();
  });

  it("la beta incompleta y su inversa son consistentes", () => {
    expect(regularizedBeta(0.5, 2, 2)).toBeCloseTo(0.5, 10);
    expect(regularizedBeta(0.3, 1, 1)).toBeCloseTo(0.3, 10);
    for (const [a, b, p] of [
      [3, 7, 0.025],
      [12, 4, 0.975],
      [1, 50, 0.5],
    ]) {
      expect(regularizedBeta(inverseRegularizedBeta(p, a, b), a, b)).toBeCloseTo(p, 8);
    }
  });
});
