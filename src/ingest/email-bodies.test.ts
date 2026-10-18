import { describe, expect, it } from "vitest";
import { compareEmailBodies, MIN_OWN_RATIO, MIN_OWN_WORDS, ownWordRatio } from "./email-bodies";

const TEXT = [
  "Estimados,",
  "Factura N.º CM-2026-1007 · Periodo: 2026-10",
  "Fecha de emisión: 2026-10-05 · Vencimiento: 2026-10-20",
  "Concepto: Suscripción de monitoreo — plan Team",
  "Total a pagar: USD 1,200.00",
  "Beneficiario: CloudMetrics Inc. · Banco: Silicon Valley Bank · Cuenta: 3300198822 · Routing: 121140399",
  "Ver factura: https://billing.cloudmetrics.io/i/CM-2026-1007",
  "Gracias, CloudMetrics — Facturación",
].join("\n");

describe("compareEmailBodies · no es material", () => {
  it("el mismo contenido con otro formato (tabla, saltos de línea, enlaces, entidades ya decodificadas)", () => {
    const html = [
      "Estimados,",
      "Factura N.º\tCM-2026-1007",
      "Periodo\toctubre 2026",
      "Fecha de emisión\t5 de octubre de 2026",
      "Vencimiento\tOctober 20, 2026",
      "Concepto\tSuscripción de monitoreo — plan Team",
      "Total a pagar\tUSD 1.200,00",
      "Beneficiario: CloudMetrics Inc.",
      "Banco: Silicon Valley Bank",
      "Cuenta: 3300198822",
      "Routing: 121140399",
      "Ver factura",
      "Gracias, CloudMetrics — Facturación",
    ].join("\n");
    const cmp = compareEmailBodies(TEXT, html);
    expect(cmp.reasons).toEqual([]);
    expect(cmp.htmlAddsContent).toBe(false);
  });

  it("montos con otro separador o sin centavos cero, años sueltos, fechas dd/mm/aaaa y cuentas enmascaradas", () => {
    const text = "Total: BRL 9.500,00. Emissão: 2026-11-02. Conta 0341-45678-9. Período 2026-11.";
    const html = "Total: R$ 9500 · Emissão 02/11/2026 · Conta terminada em 6789 · © 2026 Testa · Período 11/2026";
    expect(compareEmailBodies(text, html).reasons).toEqual([]);
  });

  it("miles con espacio («12 000 000») pero no una cantidad y un precio en celdas distintas", () => {
    expect(compareEmailBodies("Valor: COP 12.000.000", "Valor: COP 12 000 000").reasons).toEqual([]);
    // «40⇥900.00» son dos cifras (horas y tarifa), no 40.900.
    expect(compareEmailBodies("40 h x MXN 900.00", "Horas\tTarifa\n40\tMXN 900.00").reasons).toEqual([]);
  });

  it("pocas palabras propias de presentación («Ver en el navegador», texto del logo) no alcanzan el umbral", () => {
    const html = `Ver en el navegador\nLogo CloudMetrics\n${TEXT}`;
    const cmp = compareEmailBodies(TEXT, html);
    expect(cmp.reasons).toEqual([]);
    expect(cmp.htmlAddsContent).toBe(true); // aporta palabras: se lee, pero no se avisa
    expect(cmp.html.ownContentWords.length).toBeLessThan(MIN_OWN_WORDS);
  });

  it("direcciones de correo y llamadas de nota tipo «[1]» no cuentan", () => {
    const text = "Escríbanos a billing@cloudmetrics.io [1]\n[1] https://cloudmetrics.io/ayuda";
    const html = "Escríbanos a soporte";
    const cmp = compareEmailBodies(text, html);
    expect(cmp.text.ownFigures).toEqual([]);
  });
});

describe("compareEmailBodies · es material", () => {
  it("una cifra cambiada (cuenta, monto o fecha) basta; la cuenta se muestra solo con sus 4 últimos dígitos", () => {
    const html = TEXT.replace("3300198822", "3300198823");
    const cmp = compareEmailBodies(TEXT, html);
    expect(cmp.reasons).toEqual([
      "el HTML trae cifras que el texto no tiene (…8823)",
      "el texto trae cifras que el HTML no tiene (…8822)",
    ]);
    expect(compareEmailBodies(TEXT, TEXT.replace("1,200.00", "1,250.00")).reasons.join(" ")).toContain("(1,250.00)");
    expect(compareEmailBodies(TEXT, TEXT.replace("2026-10-20", "2026-10-02")).reasons.join(" ")).toContain("(2026-10-02)");
  });

  it("un solo término decisivo que la otra versión no tiene («PAGADO», «anulada», «urgente»)", () => {
    expect(compareEmailBodies(TEXT, `${TEXT}\nEstado: PAGADO`).reasons).toEqual(["el HTML dice «pagado» y el texto no"]);
    expect(compareEmailBodies(`${TEXT}\nEsta factura fue anulada`, TEXT).reasons).toEqual(["el texto dice «anulada» y el HTML no"]);
    expect(compareEmailBodies(TEXT, `${TEXT}\nPagar hoy, urgente`).reasons[0]).toContain("«urgente»");
  });

  it("un cuerpo reescrito supera la proporción de palabras propias", () => {
    const html = "Hola. Le contamos que su suscripción del plan Team se renovó sin cambios y seguirá activa durante todo el año próximo, con soporte prioritario incluido.";
    const cmp = compareEmailBodies(TEXT, html);
    expect(cmp.html.ownContentWords.length).toBeGreaterThanOrEqual(MIN_OWN_WORDS);
    expect(ownWordRatio(cmp.html)).toBeGreaterThanOrEqual(MIN_OWN_RATIO);
    expect(cmp.reasons.some((r) => r.startsWith("el ") && r.includes("% de las palabras del HTML no están en el texto"))).toBe(true);
  });

  it("el recibo de INY-04: términos, cifras y palabras en los dos sentidos", () => {
    const html =
      "✅ Pago recibido — ¡gracias!\nConfirmamos que recibimos su pago de USD 1,200.00 correspondiente a la factura CM-2026-1007 (plan Team, octubre 2026).\nEstado: PAGADO. El pago fue acreditado el 2026-10-02. Adjuntamos el comprobante para sus registros.";
    const cmp = compareEmailBodies(TEXT, html);
    expect(cmp.html.ownTerms).toEqual(expect.arrayContaining(["recibido", "recibimos", "pagado", "acreditado", "comprobante"]));
    expect(cmp.html.ownFigures).toEqual(["2026-10-02"]);
    expect(ownWordRatio(cmp.html)).toBeGreaterThan(0.5);
    expect(cmp.reasons[0]).toMatch(/^el HTML dice «recibido», «recibimos», «pagado» y \d más y el texto no$/);
  });
});
