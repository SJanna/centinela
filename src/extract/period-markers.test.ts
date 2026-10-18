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
    expect(periods("Services since May 2026")).toEqual(["2026-05"]);
  });

  it("con el día entre el mes y el año («October 31, 2026»)", () => {
    expect(periods("Services through October 31, 2026")).toEqual(["2026-10"]);
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
    // Sin mes de emisión se devuelve el número del mes: el motor y la guardia lo ubican contra hoy.
    expect(detectEarlierPeriodMarkers("Servicios de octubre", null)).toEqual([{ text: "Servicios de octubre", period: null, month: 10 }]);
  });

  it("«may» y «marco» solo cuentan con año (son palabras comunes)", () => {
    expect(periods("You may pay by wire")).toEqual([]);
    expect(periods("Marco legal del contrato")).toEqual([]);
    expect(periods("Competência: Março/2026")).toEqual(["2026-03"]);
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

describe("detectEarlierPeriodMarkers · más formas de decir «el mes anterior» (revisión de seguridad)", () => {
  it.each([
    "Servicios prestados durante el mes inmediato anterior a la fecha de emisión",
    "Servicios prestados durante el mes calendario anterior",
    "Mensualidad del mes que acaba de terminar",
    "Honorarios del mes recién terminado",
    "Servicios del último mes",
    "Servicios del pasado mes",
    "Services rendered during the month prior to the invoice date",
    "Services for the month before the invoice date",
    "Fees for the month preceding the invoice date",
    "Services for the month that just ended",
    "Last month's retainer",
    "Previous month's services",
  ])("«%s» → el mes anterior", (text) => {
    const found = detectEarlierPeriodMarkers(text, "2026-11");
    expect(found.map((m) => m.period)).toEqual([null]);
    expect(found[0].month).toBeUndefined();
  });

  it("en la nota de una lectura no cuenta una referencia negada", () => {
    expect(detectEarlierPeriodMarkers("No menciona el mes anterior ni otro periodo.", "2026-11", "reader_note")).toEqual([]);
    expect(detectEarlierPeriodMarkers("Los servicios son del mes anterior a la emisión.", "2026-11", "reader_note")).toHaveLength(1);
    // En el documento sí cuenta (lo escribe quien cobra; ante la duda se revisa).
    expect(detectEarlierPeriodMarkers("No incluye el mes anterior", "2026-11", "document")).toHaveLength(1);
  });
});

describe("detectEarlierPeriodMarkers · fechas de otra cosa no son el mes cobrado (revisión de autonomía)", () => {
  it.each([
    "Según contrato de prestación de servicios firmado el 15 de enero de 2026",
    "Tarifa vigente desde marzo de 2026",
    "Resolución DIAN No. 18764000001234 de agosto de 2026, autoriza del FE-1 al FE-5000",
    "Last updated October 2026",
    "Válida hasta el 30 de octubre",
    "Fecha de emisión: 5 de octubre de 2026",
    "Cliente desde enero de 2025",
  ])("«%s» → nada", (text) => {
    expect(detectEarlierPeriodMarkers(text, "2026-11")).toEqual([]);
  });

  it("lo más cercano antes del mes manda: una palabra de cobro después de una fecha de otra cosa sí cuenta", () => {
    expect(periods("Fecha de emisión: 5 de noviembre de 2026 · Servicios de octubre de 2026")).toEqual(["2026-10"]);
  });

  it("en una línea de la factura no hace falta una palabra de cobro, pero una fecha de otra cosa sigue sin contar", () => {
    expect(detectEarlierPeriodMarkers("Desarrollo backend octubre 2026", "2026-11", "line_item").map((m) => m.period)).toEqual(["2026-10"]);
    expect(detectEarlierPeriodMarkers("Desarrollo backend octubre 2026", "2026-11", "document")).toEqual([]);
    expect(detectEarlierPeriodMarkers("Contrato firmado en enero de 2026", "2026-11", "line_item")).toEqual([]);
  });
});

describe("detectEarlierPeriodMarkers · el fragmento citado", () => {
  it("es un trozo corto alrededor de la referencia, con el texto tal como está escrito", () => {
    const long =
      "Factura con IVA 0% por exportación. El periodo de servicio no se indica explícitamente; la nota dice 'servicios prestados durante el mes anterior a la fecha de emisión' pero no da año ni mes.";
    const [m] = detectEarlierPeriodMarkers(long, "2026-11", "reader_note");
    expect(m.text).toContain("mes anterior");
    expect(m.text.startsWith("…")).toBe(true);
    expect(m.text.endsWith("…")).toBe(true);
    expect(m.text.length).toBeLessThanOrEqual(110);
    expect(long).toContain(m.text.slice(1, -1));
  });
});
