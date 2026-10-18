import { describe, expect, it } from "vitest";
import { bareDollarMeaning, currencyOnlyAsDollarSign, namesCurrency } from "./currency-written";

describe("bareDollarMeaning", () => {
  it("«$» es la moneda local donde se escribe con «$»", () => {
    expect(bareDollarMeaning("US")).toBe("USD");
    expect(bareDollarMeaning("co")).toBe("COP");
    expect(bareDollarMeaning("MX")).toBe("MXN");
    expect(bareDollarMeaning("CL")).toBe("CLP");
    expect(bareDollarMeaning("AR")).toBe("ARS");
  });

  it("donde la moneda local tiene otro símbolo, «$» es el dólar", () => {
    expect(bareDollarMeaning("BR")).toBe("USD");
    expect(bareDollarMeaning("PE")).toBe("USD");
  });

  it("sin país no se sabe", () => {
    expect(bareDollarMeaning(null)).toBeNull();
    expect(bareDollarMeaning("")).toBeNull();
  });
});

describe("namesCurrency", () => {
  it("encuentra el código ISO como palabra", () => {
    expect(namesCurrency("USD", "Total USD 2.800,00")).toBe(true);
    expect(namesCurrency("USD", "Total: 2.800 usd")).toBe(true);
    expect(namesCurrency("COP", "Moneda: COP")).toBe(true);
    expect(namesCurrency("USD", "Total $ 2.800,00")).toBe(false);
    expect(namesCurrency("ARS", "PARS 12")).toBe(false);
  });

  it("acepta formas inequívocas", () => {
    expect(namesCurrency("USD", "US$ 4.500")).toBe(true);
    expect(namesCurrency("USD", "U$S 2.800")).toBe(true);
    expect(namesCurrency("USD", "Son: cuatro mil quinientos dólares")).toBe(true);
    expect(namesCurrency("COP", "La suma de: DOCE MILLONES DE PESOS M/CTE")).toBe(true);
    expect(namesCurrency("MXN", "$36,000.00 M.N.")).toBe(true);
    expect(namesCurrency("CLP", "Total CLP$ 4.800")).toBe(true);
    expect(namesCurrency("ARS", "Total AR$ 2.800")).toBe(true);
  });

  it("«pesos» solo no nombra ninguna moneda en particular", () => {
    expect(namesCurrency("COP", "La suma de cuatro mil pesos")).toBe(false);
    expect(namesCurrency("ARS", "La suma de cuatro mil pesos")).toBe(false);
  });
});

describe("currencyOnlyAsDollarSign", () => {
  it("una factura que solo pone «$» deja la moneda sin escribir", () => {
    expect(currencyOnlyAsDollarSign("USD", ["Importe Total $ 2.800,00", "$ 2.800,00"])).toBe(true);
  });

  it("basta con que un texto la nombre", () => {
    expect(currencyOnlyAsDollarSign("USD", ["Importe Total $ 2.800,00", "Moneda: USD"])).toBe(false);
  });

  it("no aplica a monedas que no se escriben con «$» solo", () => {
    expect(currencyOnlyAsDollarSign("BRL", ["R$ 9.500,00"])).toBe(false);
    expect(currencyOnlyAsDollarSign("PEN", ["S/ 6,000.00"])).toBe(false);
    expect(currencyOnlyAsDollarSign(null, ["$ 1"])).toBe(false);
  });
});
