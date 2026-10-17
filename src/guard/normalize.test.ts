import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  convertCents,
  formatCents,
  formatQuantity,
  guardAccount,
  guardCents,
  guardCurrency,
  guardDate,
  guardHash,
  guardInstantDay,
  guardInstantDays,
  guardInvoiceKey,
  guardNameKey,
  guardPeriod,
  guardStoredCents,
  guardTaxId,
  roundHalfAwayFromZero,
  sameTaxId,
  withinTolerance,
} from "./normalize";

describe("guardAccount", () => {
  it("quita separadores y pasa a mayúsculas", () => {
    expect(guardAccount("4512-0098-7731")).toBe("451200987731");
    expect(guardAccount(" 191 2345678.0/12 ")).toBe("1912345678012");
    expect(guardAccount("es12–3456_78")).toBe("ES12345678");
  });
  it("rechaza caracteres que no sean letras o dígitos ASCII en vez de descartarlos", () => {
    expect(guardAccount("4512​0098")).toBeNull();
    expect(guardAccount("４５１２")).toBeNull();
    expect(guardAccount("4512#0098")).toBeNull();
    expect(guardAccount("")).toBeNull();
    expect(guardAccount(" - ")).toBeNull();
    expect(guardAccount(null)).toBeNull();
  });
  it("conserva ceros a la izquierda", () => {
    expect(guardAccount("00-123-45678-09")).toBe("001234567809");
  });
});

describe("guardTaxId / sameTaxId", () => {
  const same = (a: string, b: string) => sameTaxId(guardTaxId(a)!, guardTaxId(b)!);

  it("separa el dígito de verificación cuando va tras un guion", () => {
    expect(guardTaxId("901.456.789-1")).toEqual({ full: "9014567891", base: "901456789" });
    expect(guardTaxId("76.543.210-K")).toEqual({ full: "76543210K", base: "76543210" });
    expect(guardTaxId("12.345.678/0001-90")).toEqual({ full: "12345678000190", base: "123456780001" });
    expect(guardTaxId("88-1234567")).toEqual({ full: "881234567", base: null });
    expect(guardTaxId("ENO210415AB3")).toEqual({ full: "ENO210415AB3", base: null });
  });
  it("no quita etiquetas ni tildes (misma semántica que taxIdsEquivalent del núcleo)", () => {
    expect(guardTaxId("RFC ENO210415AB3")?.full).toBe("RFCENO210415AB3");
    expect(guardTaxId("RUCA800101XYZ")?.full).toBe("RUCA800101XYZ");
    // «:» no es un separador: un id así es raro y no se aprueba.
    expect(guardTaxId("NIT: 901.456.789-1")).toBeNull();
    expect(guardTaxId("ÉNO210415AB3")).toBeNull();
    expect(same("NIT 901.456.789-1", "901.456.789-1")).toBe(false);
  });
  it("acepta espacios alrededor del guion del dígito de verificación y guiones tipográficos", () => {
    expect(guardTaxId("901 456 789 - 1")).toEqual({ full: "9014567891", base: "901456789" });
    expect(same("901.456.789\u20131", "901456789")).toBe(true);
  });
  it("compara con y sin dígito de verificación, nunca base contra base", () => {
    expect(same("901.456.789-1", "9014567891")).toBe(true);
    expect(same("901.456.789-1", "901456789")).toBe(true);
    expect(same("901456789", "901.456.789-1")).toBe(true);
    expect(same("901.456.789-1", "901.456.789-2")).toBe(false);
    expect(same("88-1234567", "881234567")).toBe(true);
    expect(same("88-1234567", "88-1234568")).toBe(false);
  });
  it("si los dos traen dígito de verificación separado, solo cuentan completos", () => {
    expect(same("9014567891-2", "901.456.789-1")).toBe(false);
    expect(same("901.456.789-1", "9014567891-2")).toBe(false);
    expect(same("30-71234567-8", "3071234567-8")).toBe(true);
  });
  it("rechaza ids con caracteres raros", () => {
    expect(guardTaxId("901★456")).toBeNull();
    expect(guardTaxId("")).toBeNull();
    expect(guardTaxId(null)).toBeNull();
  });
});

describe("guardNameKey", () => {
  it("ignora tildes, puntuación, mayúsculas, espacios y la forma societaria final", () => {
    expect(guardNameKey("Camila Restrepo Dev S.A.S.")).toBe("camilarestrepodev");
    expect(guardNameKey("CAMILA RESTREPO DEV SAS")).toBe("camilarestrepodev");
    expect(guardNameKey("Camila Restrepo Dev S. A. S.")).toBe("camilarestrepodev");
    expect(guardNameKey("Estudio Nopal S. de R.L.")).toBe("estudionopal");
    expect(guardNameKey("Inca Contenidos S.A.C.")).toBe("incacontenidos");
    expect(guardNameKey("Datos del Sur SpA")).toBe("datosdelsur");
    expect(guardNameKey("CloudMetrics Inc.")).toBe("cloudmetrics");
    expect(guardNameKey("Cloud Metrics")).toBe("cloudmetrics");
    expect(guardNameKey("Itaú Qualidade Ltda")).toBe("itauqualidade");
    expect(guardNameKey("Mexicana S.A. de C.V.")).toBe("mexicana");
  });
  it("solo quita formas societarias al final y nunca deja el nombre vacío", () => {
    expect(guardNameKey("SAS Analytics")).toBe("sasanalytics");
    expect(guardNameKey("Inc")).toBe("inc");
    expect(guardNameKey("...")).toBeNull();
    expect(guardNameKey(null)).toBeNull();
  });
});

describe("guardInvoiceKey", () => {
  it("es generosa para detectar duplicados", () => {
    expect(guardInvoiceKey("FE-0012")).toBe("FE12");
    expect(guardInvoiceKey("fe 12")).toBe("FE12");
    expect(guardInvoiceKey("2026-001")).toBe(guardInvoiceKey("2026-1"));
    expect(guardInvoiceKey("Nº 0")).toBe("N0");
    expect(guardInvoiceKey("F001-000245")).toBe("F1245");
  });
  it("vacía → null", () => {
    expect(guardInvoiceKey(" -- ")).toBeNull();
    expect(guardInvoiceKey(null)).toBeNull();
  });
});

describe("dinero", () => {
  it("centavos sin errores de coma flotante", () => {
    expect(guardCents(1.005)).toBe(101);
    expect(guardCents(0.1 + 0.2)).toBe(30);
    expect(guardCents(3000.0000000000005)).toBe(300000);
    expect(guardCents(-2.5)).toBe(-250);
    expect(guardCents(Number.NaN)).toBeNull();
    expect(guardCents(Number.POSITIVE_INFINITY)).toBeNull();
    expect(guardCents(1e300)).toBeNull();
    expect(guardCents(null)).toBeNull();
  });
  it("montos guardados: número o texto decimal estricto", () => {
    expect(guardStoredCents(3000)).toBe(300000);
    expect(guardStoredCents("3000.00")).toBe(300000);
    expect(guardStoredCents(" 1630.8 ")).toBe(163080);
    expect(guardStoredCents("3e3")).toBeNull();
    expect(guardStoredCents("1.200,00")).toBeNull();
    expect(guardStoredCents("")).toBeNull();
    expect(guardStoredCents(null)).toBeNull();
    expect(guardStoredCents({})).toBeNull();
  });
  it("redondeo de mitades lejos de cero", () => {
    expect(roundHalfAwayFromZero(250.49999999999997)).toBe(251);
    expect(roundHalfAwayFromZero(-0.5)).toBe(-1);
    expect(roundHalfAwayFromZero(-0.4)).toBe(0);
    expect(Object.is(roundHalfAwayFromZero(-0.4), -0)).toBe(false);
  });
  it("conversión a USD en centavos", () => {
    expect(convertCents(1200000000, 0.00025)).toBe(300000);
    expect(convertCents(950000, 0.19)).toBe(180500);
    expect(convertCents(3600000, 0.055)).toBe(198000);
    expect(convertCents(604000, 0.27)).toBe(163080);
  });
  it("tolerancia inclusiva", () => {
    expect(withinTolerance(121200, 120000, 1)).toBe(true);
    expect(withinTolerance(121201, 120000, 1)).toBe(false);
    expect(withinTolerance(118800, 120000, 1)).toBe(true);
    expect(withinTolerance(120000, 120000, 0)).toBe(true);
    expect(withinTolerance(120001, 120000, 0)).toBe(false);
  });
  it("formato de montos y cantidades", () => {
    expect(formatCents(480000, "USD")).toBe("USD 4.800,00");
    expect(formatCents(1200000000, "COP")).toBe("COP 12.000.000,00");
    expect(formatCents(5, "USD")).toBe("USD 0,05");
    expect(formatCents(-100050, "USD")).toBe("USD -1.000,50");
    expect(formatQuantity(37.5)).toBe("37,5");
    expect(formatQuantity(0.1 + 0.2)).toBe("0,3");
  });
  it("propiedad: guardCents coincide con aritmética decimal exacta para montos de 2 decimales", () => {
    fc.assert(
      fc.property(fc.integer({ min: -1e12, max: 1e12 }), (cents) => {
        expect(guardCents(cents / 100)).toBe(cents);
      }),
    );
  });
});

describe("moneda, fechas, periodos y huellas", () => {
  it("moneda", () => {
    expect(guardCurrency(" cop ")).toBe("COP");
    expect(guardCurrency("US$")).toBeNull();
    expect(guardCurrency("pesos")).toBeNull();
  });
  it("fechas de calendario válidas", () => {
    expect(guardDate("2026-10-05")).toBe("2026-10-05");
    expect(guardDate("2026-02-29")).toBeNull();
    expect(guardDate("2024-02-29")).toBe("2024-02-29");
    expect(guardDate("2026-13-01")).toBeNull();
    expect(guardDate("05/10/2026")).toBeNull();
    expect(guardDate("2026-10-05T00:00:00Z")).toBeNull();
  });
  it("instantes ISO", () => {
    expect(guardInstantDay("2026-10-20T15:00:00Z")).toBe("2026-10-20");
    expect(guardInstantDay("2026-10-20T15:00:00.123-05:00")).toBe("2026-10-20");
    expect(guardInstantDay("2026-10-20")).toBe("2026-10-20");
    expect(guardInstantDay("2026-10-20 15:00:00+00")).toBe("2026-10-20");
    expect(guardInstantDay("2026-10-20 15:00:00.5+0000")).toBe("2026-10-20");
    expect(guardInstantDay(new Date("2026-10-20T15:00:00Z"))).toBe("2026-10-20");
    expect(guardInstantDay(new Date("no es fecha"))).toBeNull();
    expect(guardInstantDay("2026-10-32T00:00:00Z")).toBeNull();
    expect(guardInstantDay("Tue Oct 20 2026 10:00:00 GMT-0500")).toBeNull();
    expect(guardInstantDay("hoy")).toBeNull();
    expect(guardInstantDay("2026-10-20T24:00:00Z")).toBeNull();
    expect(guardInstantDay("2026-10-20T10:60:00Z")).toBeNull();
    expect(guardInstantDay("2026-10-20T10:00:00+25:00")).toBeNull();
  });
  it("días posibles de un instante: el escrito y, si difiere, el de UTC", () => {
    expect(guardInstantDays("2026-10-20T15:00:00Z")).toEqual(["2026-10-20"]);
    expect(guardInstantDays("2026-10-20")).toEqual(["2026-10-20"]);
    expect(guardInstantDays("2026-10-20T23:00:00")).toEqual(["2026-10-20"]);
    expect(guardInstantDays("2026-10-31T19:15:00-05:00")).toEqual(["2026-10-31", "2026-11-01"]);
    expect(guardInstantDays("2026-11-01 01:00:00+0300")).toEqual(["2026-11-01", "2026-10-31"]);
    expect(guardInstantDays("2026-12-31T23:30:00-01")).toEqual(["2026-12-31", "2027-01-01"]);
    expect(guardInstantDays("2026-10-20T10:00:00+05:30")).toEqual(["2026-10-20"]);
    expect(guardInstantDays(new Date("2026-10-31T23:59:59Z"))).toEqual(["2026-10-31"]);
    expect(guardInstantDays("2026-02-30T10:00:00Z")).toBeNull();
    expect(guardInstantDays(null)).toBeNull();
  });
  it("periodos", () => {
    expect(guardPeriod("2026-10")).toBe("2026-10");
    expect(guardPeriod("2026-10-15")).toBe("2026-10");
    expect(guardPeriod("2026-00")).toBeNull();
    expect(guardPeriod("octubre 2026")).toBeNull();
  });
  it("huellas", () => {
    expect(guardHash(" ABC ")).toBe("abc");
    expect(guardHash("")).toBeNull();
  });
});
