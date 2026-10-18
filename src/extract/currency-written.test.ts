import { describe, expect, it } from "vitest";
import { bareDollarMeaning, currencyMarkerIn, currencyOnlyAsDollarSign, declaresCurrency, hasBareDollarSign, namesCurrency } from "./currency-written";

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

describe("namesCurrency: formas de escribir el dólar y símbolos pegados a una palabra (hallazgo AUT-8)", () => {
  it("«Dlls», «DLS», «U.S.D.», «DOL» nombran el dólar", () => {
    expect(namesCurrency("USD", "Total $2,800.00 Dlls")).toBe(true);
    expect(namesCurrency("USD", "Total $2,800.00 DLS")).toBe(true);
    expect(namesCurrency("USD", "Total U.S.D. 2,800.00")).toBe(true);
    expect(namesCurrency("USD", "DOL 2.800,00")).toBe(true);
  });

  it("un «$» pegado a una palabra no es «US$», «AR$» ni «R$»", () => {
    expect(namesCurrency("USD", "Bonus $ 100")).toBe(false);
    expect(namesCurrency("ARS", "Total a pagar $ 2.800")).toBe(false);
    expect(namesCurrency("BRL", "Valor $ 2.800")).toBe(false);
    expect(namesCurrency("BRL", "Valor R$ 2.800")).toBe(true);
  });
});

describe("declaresCurrency: un campo de moneda, no una mención suelta (hallazgo SEG-1)", () => {
  it("campos con etiqueta y el total en letras", () => {
    expect(declaresCurrency("USD", "Moneda: USD")).toBe(true);
    expect(declaresCurrency("USD", "CURRENCY\nUSD")).toBe(true);
    expect(declaresCurrency("COP", "MONEDA\nCOP")).toBe(true);
    expect(declaresCurrency("USD", "All amounts in USD")).toBe(true);
    expect(declaresCurrency("USD", "Valores expresados en dólares")).toBe(true);
    expect(declaresCurrency("COP", "SON: DOCE MILLONES DE PESOS M/CTE")).toBe(true);
  });

  it("menciones sueltas no declaran la moneda del documento", () => {
    expect(declaresCurrency("USD", "Cotización dólar BNA (referencia): $ 1.050,00")).toBe(false);
    expect(declaresCurrency("USD", "Pagos únicamente en pesos; no se aceptan dólares.")).toBe(false);
    expect(declaresCurrency("USD", "Cotizamos en USD para clientes del exterior")).toBe(false);
    expect(declaresCurrency("USD", "Moneda de referencia: USD")).toBe(false);
    expect(declaresCurrency("USD", "Tipo de cambio BNA: 1 USD = 1.050 ARS")).toBe(false);
  });
});

describe("currencyMarkerIn: qué escribe el total en lugar de la moneda (hallazgos F2 y AUT-7)", () => {
  it("«$» solo, nada, u otra moneda", () => {
    expect(currencyMarkerIn("USD", ["Importe Total $ 2.800,00"])).toBe("$");
    expect(currencyMarkerIn("USD", ["Total 2,800.00"])).toBe("");
    expect(currencyMarkerIn("USD", ["Total R$ 2.800,00"])).toBe("BRL");
    expect(currencyMarkerIn("USD", ["TOTAL COP 12.000.000"])).toBe("COP");
    expect(currencyMarkerIn("COP", ["Total US$ 4.500"])).toBe("USD");
  });

  it("hasBareDollarSign no cuenta «US$», «R$», «U$S»", () => {
    expect(hasBareDollarSign("$ 2.800")).toBe(true);
    expect(hasBareDollarSign("Total:$2,800")).toBe(true);
    expect(hasBareDollarSign("R$ 2.800")).toBe(false);
    expect(hasBareDollarSign("U$S 2.800")).toBe(false);
    expect(hasBareDollarSign("US$2,800")).toBe(false);
  });
});
