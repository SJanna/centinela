/**
 * Pruebas de la revisión independiente de la guardia. Cada bloque demuestra un defecto concreto
 * (un camino por el que la guardia aprobaba un pago que no debía) o cubre un borde sin prueba.
 */
import { describe, expect, it } from "vitest";
import type { Agreement, Company, HistoryEntry, Vendor } from "../core/schemas";
import { guardPayment, GUARD_MESSAGES } from "./index";
import {
  bufeteDecision,
  bufeteQuote,
  camilaDecision,
  camilaOctober,
  cloudDecision,
  cloudOctober,
  COMPANY,
  entry,
  hourly,
  hourlyIds,
  makeCtx,
  makeDecision,
  makeInput,
} from "./test-fixtures";

function expectApproved(r: ReturnType<typeof guardPayment>) {
  expect(r.violations).toEqual([]);
  expect(r.approved).toBe(true);
}

function expectOnly(r: ReturnType<typeof guardPayment>, fragment: string) {
  expect(r.approved).toBe(false);
  expect(r.violations, `violaciones: ${JSON.stringify(r.violations)}`).toHaveLength(1);
  expect(r.violations[0]).toContain(fragment);
}

function expectViolation(r: ReturnType<typeof guardPayment>, fragment: string) {
  expect(r.approved).toBe(false);
  expect(r.violations.some((m) => m.includes(fragment)), `violaciones: ${JSON.stringify(r.violations)}`).toBe(true);
}

/** Copia de la empresa con el acuerdo de `vendorId` modificado. */
function withAgreement(vendorId: string, patch: Partial<Agreement>): Company {
  return {
    ...COMPANY,
    vendors: COMPANY.vendors.map((v): Vendor => (v.id === vendorId ? { ...v, agreements: v.agreements.map((a) => ({ ...a, ...patch })) } : v)),
  };
}

function cloud() {
  const input = makeInput(cloudOctober());
  return { input, decision: makeDecision(input, cloudDecision) };
}

// ───────────────────────── Historial mal formado: no se ignora en silencio ─────────────────────────

describe("revisión · historial mal formado bloquea el pago", () => {
  it("una entrada nula no se salta: podría ser un pago", () => {
    const { input, decision } = cloud();
    const history = [null as unknown as HistoryEntry];
    expectOnly(guardPayment(input, makeCtx({ history }), decision), "el historial tiene una entrada que no es válida");
  });

  it("un resultado desconocido (p. ej. «pagar» en minúscula) no cuenta como «no pagado»", () => {
    const { input, decision } = cloud();
    // Si esto fuera un pago, el fondo (USD 40.000) quedaría en USD 1 y no alcanzaría para USD 1.200.
    const history = [entry({ outcome: "pagar" as unknown as HistoryEntry["outcome"], amountUsd: 39999 })];
    expectOnly(guardPayment(input, makeCtx({ history }), decision), "el historial tiene una decisión con un resultado desconocido");
  });

  it("un pago sin proveedor impide descartar un número de factura repetido", () => {
    const { input, decision } = cloud();
    const history = [entry({ vendorId: null, invoiceNumber: "CM-10021", agreementId: "a-cloudmetrics-saas", agreementPeriod: "2026-09", amountUsd: 1200 })];
    expectOnly(guardPayment(input, makeCtx({ history }), decision), "el historial tiene un pago sin proveedor");
  });

  it("un pago sin acuerdo impide descartar que la cotización única ya se pagó", () => {
    const input = makeInput(bufeteQuote({ invoiceNumber: "BA-0452" }));
    const history = [entry({ vendorId: "v-bufete", invoiceNumber: "BA-0451", agreementId: null, amountUsd: 4500 })];
    expectOnly(guardPayment(input, makeCtx({ history }), makeDecision(input, bufeteDecision)), "el historial tiene un pago sin acuerdo");
  });

  it("una decisión anterior sin huella de archivo impide descartar que sea el mismo archivo", () => {
    const { input, decision } = cloud();
    const history = [entry({ outcome: "ESCALAR", fileHash: null as unknown as string, amountUsd: null })];
    expectOnly(guardPayment(input, makeCtx({ history }), decision), "el historial tiene una decisión sin huella de archivo");
  });
});

// ───────────────────────── Mes de los pagos con zonas horarias mezcladas ─────────────────────────

describe("revisión · límite del mes con zonas horarias distintas", () => {
  const now = "2026-11-01T00:30:00Z";
  const novInput = () => makeInput(cloudOctober({ issueDate: "2026-11-01", servicePeriod: "2026-11", invoiceNumber: "CM-10022" }));
  const novDecision = (input: ReturnType<typeof novInput>) => makeDecision(input, { ...cloudDecision, agreementPeriod: "2026-11" });

  it("un pago escrito con otra zona horaria que cae en el mismo mes (en UTC) cuenta para el límite", () => {
    // 2026-10-31T19:15-05:00 es 2026-11-01T00:15Z: un cuarto de hora antes de `now`, en noviembre.
    const input = novInput();
    const history = [entry({ amountUsd: 3000, decidedAt: "2026-10-31T19:15:00-05:00" })];
    const r = guardPayment(input, makeCtx({ now, history, rules: { periodLimitUsd: 4000 } }), novDecision(input));
    expectOnly(r, "con este pago el mes sumaría USD 4.200,00");
  });

  it("y al revés: `now` escrito con zona horaria cuenta los pagos de su mes en UTC", () => {
    const input = novInput();
    const history = [entry({ amountUsd: 3000, decidedAt: "2026-11-01T00:15:00Z" })];
    const ctx = makeCtx({ now: "2026-10-31T19:30:00-05:00", history, rules: { periodLimitUsd: 4000 } });
    expectViolation(guardPayment(input, ctx, novDecision(input)), "por encima del límite mensual");
  });

  it("un pago de otro mes en cualquier interpretación no cuenta", () => {
    const input = novInput();
    const history = [entry({ amountUsd: 3000, decidedAt: "2026-10-30T19:15:00-05:00" })];
    expectApproved(guardPayment(input, makeCtx({ now, history, rules: { periodLimitUsd: 4000 } }), novDecision(input)));
  });

  it("una hora imposible en el historial no se acepta", () => {
    const { input, decision } = cloud();
    const history = [entry({ amountUsd: 10, decidedAt: "2026-10-10T25:61:00Z" })];
    expectOnly(guardPayment(input, makeCtx({ history }), decision), "el historial tiene un pago sin fecha válida");
  });
});

// ───────────────────────── Periodo de servicio fuera de la vigencia del acuerdo ─────────────────────────

describe("revisión · el periodo facturado debe estar dentro de la vigencia del acuerdo", () => {
  const company = withAgreement("v-cloudmetrics", { validFrom: "2026-03-01", validTo: "2026-10-31" });

  it("factura emitida en vigencia por un periodo posterior al fin del acuerdo", () => {
    const input = makeInput(cloudOctober({ issueDate: "2026-10-05", servicePeriod: "2027-03" }));
    const r = guardPayment(input, makeCtx({ company }), makeDecision(input, { ...cloudDecision, agreementPeriod: "2027-03" }));
    expectOnly(r, "el periodo 2027-03 está fuera de la vigencia del acuerdo");
  });

  it("factura emitida en vigencia por un periodo anterior al inicio del acuerdo", () => {
    const input = makeInput(cloudOctober({ issueDate: "2026-03-02", servicePeriod: "2026-02" }));
    const r = guardPayment(input, makeCtx({ company }), makeDecision(input, { ...cloudDecision, agreementPeriod: "2026-02" }));
    expectOnly(r, "el periodo 2026-02 está fuera de la vigencia del acuerdo");
  });

  it("los meses de inicio y fin del acuerdo sí están cubiertos", () => {
    const first = makeInput(cloudOctober({ issueDate: "2026-03-01", servicePeriod: "2026-03" }));
    expectApproved(guardPayment(first, makeCtx({ company }), makeDecision(first, { ...cloudDecision, agreementPeriod: "2026-03" })));
    const last = makeInput(cloudOctober({ issueDate: "2026-10-31", servicePeriod: "2026-10" }));
    expectApproved(guardPayment(last, makeCtx({ company }), makeDecision(last, cloudDecision)));
  });
});

// ───────────────────────── Bordes de vigencia (cobertura) ─────────────────────────

describe("revisión · bordes de la vigencia por fecha de emisión", () => {
  it("el día de inicio y el día de fin están dentro; el día siguiente al fin no", () => {
    const company = withAgreement("v-cloudmetrics", { validFrom: "2026-10-01", validTo: "2026-10-31" });
    const from = makeInput(cloudOctober({ issueDate: "2026-10-01" }));
    expectApproved(guardPayment(from, makeCtx({ company }), makeDecision(from, cloudDecision)));
    const to = makeInput(cloudOctober({ issueDate: "2026-10-31" }));
    expectApproved(guardPayment(to, makeCtx({ company }), makeDecision(to, cloudDecision)));
    const after = makeInput(cloudOctober({ issueDate: "2026-11-01", servicePeriod: "2026-11" }));
    expectOnly(guardPayment(after, makeCtx({ company }), makeDecision(after, { ...cloudDecision, agreementPeriod: "2026-11" })), "no hay acuerdo vigente");
  });
});

// ───────────────────────── Ids tributarios con dígito de verificación distinto ─────────────────────────

describe("revisión · id tributario", () => {
  it("si los dos traen dígito de verificación y difieren, no es el mismo proveedor", () => {
    // "9014567891-2" (90145678912) no es "901.456.789-1" (9014567891): antes se aceptaba
    // porque la base de uno coincidía con el número completo del otro.
    const input = makeInput(camilaOctober({ vendorTaxId: "9014567891-2", vendorName: "Otro Proveedor" }));
    expectOnly(guardPayment(input, makeCtx(), makeDecision(input, camilaDecision)), "ningún proveedor registrado corresponde");
  });
});

// ───────────────────────── Campos opcionales con un tipo inesperado ─────────────────────────

describe("revisión · un dato con tipo inesperado no se trata como ausente", () => {
  it("id tributario numérico: no se ignora para caer en la comparación por nombre", () => {
    const { input, decision } = cloud();
    const data = { ...input.reading.data!, vendorTaxId: 881234567 as unknown as string };
    expectViolation(guardPayment({ ...input, reading: { ...input.reading, data } }, makeCtx(), decision), "el id tributario de la factura no es válido");
  });

  it("fecha de emisión numérica: no se reemplaza por la fecha de hoy", () => {
    const { input, decision } = cloud();
    const data = { ...input.reading.data!, issueDate: 20260101 as unknown as string };
    expectOnly(guardPayment({ ...input, reading: { ...input.reading, data } }, makeCtx(), decision), "la fecha de emisión no es válida");
  });

  it("periodo de servicio numérico: no se reemplaza por el mes de emisión", () => {
    const { input, decision } = cloud();
    const data = { ...input.reading.data!, servicePeriod: 202609 as unknown as string };
    expectOnly(guardPayment({ ...input, reading: { ...input.reading, data } }, makeCtx(), decision), "el periodo de servicio no es válido");
  });
});

// ───────────────────────── Acuerdo por horas sin máximo ─────────────────────────

describe("revisión · acuerdo por horas sin máximo de cantidad", () => {
  it("no se puede verificar «cantidad ≤ máximo»: no se aprueba", () => {
    const company = withAgreement("v-datossur", { maxQuantity: null });
    const input = makeInput(hourly("datossur", 35));
    const d = makeDecision(input, { ...hourlyIds.datossur, agreementPeriod: "2026-10", amountUsd: 2100 });
    expectOnly(guardPayment(input, makeCtx({ company }), d), "el acuerdo a-datossur-analitica no define un máximo de cantidad");
  });
});

// ───────────────────────── Tasas de cambio heredadas ─────────────────────────

describe("revisión · tasas de cambio", () => {
  it("una tasa heredada por prototipo (no propia de fxToUsd) no cuenta", () => {
    const { input, decision } = cloud();
    const fxToUsd = Object.create({ USD: 1 }) as Record<string, number>;
    expectOnly(guardPayment(input, makeCtx({ rules: { fxToUsd } }), decision), "la moneda USD no tiene tasa de cambio registrada");
  });

  it("la guardia nunca responde con error interno ante datos de la empresa válidos y un historial vacío", () => {
    const { input, decision } = cloud();
    expect(guardPayment(input, makeCtx({ history: [] }), decision).violations).not.toContain(GUARD_MESSAGES.internalError);
  });
});
