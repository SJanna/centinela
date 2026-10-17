import { describe, expect, it } from "vitest";
import { initialsOf } from "./avatar";
import { checkIconStatus } from "./check-icon";
import { formatMoneyText, moneyParts } from "./money";
import { maskAccount } from "./typography";

describe("moneyParts (es-CO)", () => {
  it("separa miles con punto y decimales con coma", () => {
    expect(moneyParts(12_000_000, "COP")).toEqual({ sign: "", integer: "12.000.000", fraction: ",00", symbol: "$", code: "COP" });
    expect(moneyParts(4800, "USD").integer).toBe("4.800");
    expect(moneyParts(21579.5, "USD").fraction).toBe(",50");
  });

  it("CLP no lleva decimales", () => {
    expect(moneyParts(1_250_000, "CLP")).toMatchObject({ integer: "1.250.000", fraction: "" });
  });

  it("usa el signo menos tipográfico y + solo si se pide", () => {
    expect(moneyParts(-128, "USD").sign).toBe("−");
    expect(moneyParts(25_000, "USD", "always").sign).toBe("+");
    expect(moneyParts(0, "USD", "always").sign).toBe("");
    expect(moneyParts(-0.001, "USD").sign).toBe("");
  });

  it("monedas sin símbolo conocido quedan con el código", () => {
    expect(moneyParts(10, "xyz")).toMatchObject({ symbol: "", code: "XYZ" });
  });

  it("formatMoneyText da texto plano", () => {
    expect(formatMoneyText(118_800, "MXN")).toBe("118.800,00 MXN");
    expect(formatMoneyText(-1200.5)).toBe("−1.200,50 USD");
  });
});

describe("initialsOf", () => {
  it("ignora sufijos societarios y conectores", () => {
    expect(initialsOf("Camila Restrepo Dev S.A.S.")).toBe("CR");
    expect(initialsOf("Estudio Nopal S. de R.L.")).toBe("EN");
    expect(initialsOf("Datos del Sur SpA")).toBe("DS");
    expect(initialsOf("Bufete Andino Abogados S.A.S.")).toBe("BA");
  });

  it("una sola palabra usa la mayúscula interna o las dos primeras letras", () => {
    expect(initialsOf("CloudMetrics Inc.")).toBe("CM");
    expect(initialsOf("Northwind")).toBe("NO");
  });

  it("quita tildes y aguanta vacíos", () => {
    expect(initialsOf("Ávila Óptica")).toBe("AO");
    expect(initialsOf(null)).toBe("?");
    expect(initialsOf("")).toBe("?");
  });
});

describe("maskAccount", () => {
  it("deja los últimos 4 con espacio de no separación", () => {
    expect(maskAccount("4512-0098-7731")).toBe("•••• 7731");
    expect(maskAccount("123")).toBe("123");
  });
});

describe("checkIconStatus", () => {
  it("traduce el resultado del motor al icono", () => {
    expect(checkIconStatus("pass", "FRENAR")).toBe("pass");
    expect(checkIconStatus("fail", "FRENAR")).toBe("fail");
    expect(checkIconStatus("fail", "ESCALAR")).toBe("warn");
    expect(checkIconStatus("not_evaluable", "FRENAR")).toBe("warn");
  });
});
