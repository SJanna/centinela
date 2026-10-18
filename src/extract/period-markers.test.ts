import { describe, expect, it } from "vitest";
import { detectEarlierPeriodMarkers } from "./period-markers";

const periods = (text: string, issueMonth: string | null = "2026-11") => detectEarlierPeriodMarkers(text, issueMonth).map((m) => m.period);

describe("detectEarlierPeriodMarkers · referencias relativas", () => {
  it.each([
    "Servicios prestados durante el mes anterior a la fecha de emisión",
    "Honorarios del mes pasado",
    "Facturación a mes vencido",
    "Servicio del periodo inmediatamente anterior",
    "Ciclo de facturación previo",
    "Services rendered during the previous month",
    "Billing for the prior billing period",
    "Fees for last month",
    "Invoiced in arrears",
    "Serviços prestados no mês anterior",
    "Referente ao mês passado",
  ])("«%s» → el mes anterior (period null)", (text) => {
    const found = detectEarlierPeriodMarkers(text, "2026-11");
    expect(found).toHaveLength(1);
    expect(found[0]).toEqual({ text, period: null });
  });

  it("también sin fecha de emisión", () => {
    expect(periods("Servicios del mes anterior", null)).toEqual([null]);
  });
});

describe("detectEarlierPeriodMarkers · meses con nombre", () => {
  it("un mes anterior al de emisión, con año, en español, inglés y portugués", () => {
    expect(periods("Servicio de octubre de 2026")).toEqual(["2026-10"]);
    expect(periods("October 2026 service")).toEqual(["2026-10"]);
    expect(periods("Competência: Setembro/2026")).toEqual(["2026-09"]);
    expect(periods("Honorarios agosto 2026")).toEqual(["2026-08"]);
    expect(periods("Desde May 2026")).toEqual(["2026-05"]);
  });

  it("con el día entre el mes y el año («October 31, 2026»)", () => {
    expect(periods("Cutoff October 31, 2026")).toEqual(["2026-10"]);
    expect(periods("Due December 1, 2026")).toEqual([]);
  });

  it("el mes de emisión y los posteriores no cuentan (fecha de emisión, vencimiento)", () => {
    expect(periods("Date of issue November 5, 2026")).toEqual([]);
    expect(periods("Vencimiento: 20 de noviembre de 2026")).toEqual([]);
    expect(periods("Date due December 9, 2026")).toEqual([]);
    expect(periods("Medellín, 6 de noviembre de 2026")).toEqual([]);
  });

  it("sin año: el último mes con ese nombre antes del de emisión, si fue hace 3 meses o menos", () => {
    expect(periods("Factura de octubre")).toEqual(["2026-10"]);
    expect(periods("Servicios de agosto")).toEqual(["2026-08"]);
    expect(periods("Servicios de julio")).toEqual([]);
    // En enero, «diciembre» es el del año anterior.
    expect(periods("Factura de diciembre", "2027-01")).toEqual(["2026-12"]);
    // «vence el 5 de diciembre» en una factura de noviembre no es diciembre del año anterior.
    expect(periods("Vence el 5 de diciembre")).toEqual([]);
    expect(periods("Servicio de noviembre")).toEqual([]);
    // Sin mes de emisión no se puede ubicar.
    expect(periods("Factura de octubre", null)).toEqual([]);
  });

  it("«may» y «marco» solo cuentan con año (son palabras comunes)", () => {
    expect(periods("You may pay by wire")).toEqual([]);
    expect(periods("Marco legal del contrato")).toEqual([]);
    expect(periods("Março/2026")).toEqual(["2026-03"]);
  });

  it("las fechas numéricas no cuentan (10/11 puede ser octubre o noviembre)", () => {
    expect(periods("Fecha de corte 31/10/2026")).toEqual([]);
    expect(periods("Resolución DIAN del 15/01/2026")).toEqual([]);
  });

  it("una línea por mes, con el texto original", () => {
    const found = detectEarlierPeriodMarkers("Asunto: Factura – octubre de 2026\nPeriodo: octubre de 2026\nTotal COP 12.000.000", "2026-11");
    expect(found).toEqual([
      { text: "Asunto: Factura – octubre de 2026", period: "2026-10" },
      { text: "Periodo: octubre de 2026", period: "2026-10" },
    ]);
  });

  it("texto vacío o sin referencias", () => {
    expect(detectEarlierPeriodMarkers(null, "2026-11")).toEqual([]);
    expect(detectEarlierPeriodMarkers("   ", "2026-11")).toEqual([]);
    expect(detectEarlierPeriodMarkers("Desarrollo backend – tarifa fija mensual\nTOTAL COP 12.000.000", "2026-11")).toEqual([]);
  });
});
