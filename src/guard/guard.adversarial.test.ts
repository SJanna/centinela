/**
 * Revisión adversarial: la guardia sola (con un motor que hubiera dicho PAGAR por error) frena cada
 * camino por el que antes se registraba un pago indebido. Cada bloque fallaba antes del arreglo.
 */
import { describe, expect, it } from "vitest";
import type { Company, Vendor } from "../core/schemas";
import { guardPayment } from "./index";
import { guardBankCodeConflict, guardBankNameConflict } from "./normalize";
import { cloudDecision, cloudOctober, COMPANY, entry, makeCtx, makeDecision, makeInput } from "./test-fixtures";

function expectViolation(r: ReturnType<typeof guardPayment>, fragment: string) {
  expect(r.approved).toBe(false);
  expect(r.violations.some((m) => m.includes(fragment)), `violaciones: ${JSON.stringify(r.violations)}`).toBe(true);
}

function expectApproved(r: ReturnType<typeof guardPayment>) {
  expect(r.violations).toEqual([]);
  expect(r.approved).toBe(true);
}

function withCloud(patch: (v: Vendor) => Vendor): Company {
  return { ...COMPANY, vendors: COMPANY.vendors.map((v) => (v.id === "v-cloudmetrics" ? patch(v) : v)) };
}

describe("guardia · reglas absurdas", () => {
  it("una tolerancia de 1000 % no es una regla válida: no aprueba", () => {
    const input = makeInput(cloudOctober({ total: 4800, lineItems: [{ description: "Plan", quantity: 1, unitPrice: 4800, amount: 4800 }] }));
    const r = guardPayment(input, makeCtx({ rules: { amountTolerancePct: 1000 } }), makeDecision(input, { ...cloudDecision, amountUsd: 4800 }));
    expectViolation(r, "las reglas de la empresa no son válidas (tolerancia)");
  });

  it("100 % todavía es válida", () => {
    const input = makeInput(cloudOctober());
    expectApproved(guardPayment(input, makeCtx({ rules: { amountTolerancePct: 100 } }), makeDecision(input, cloudDecision)));
  });
});

describe("guardia · fechas futuras", () => {
  it("emisión posterior a hoy (+1 día): no aprueba", () => {
    const input = makeInput(cloudOctober({ issueDate: "2027-03-01", servicePeriod: "2027-03" }));
    const r = guardPayment(input, makeCtx(), makeDecision(input, { ...cloudDecision, agreementPeriod: "2027-03" }));
    expectViolation(r, "la fecha de emisión (2027-03-01) es posterior a hoy");
  });

  it("emisión de hoy por un mes que todavía no empieza: no aprueba", () => {
    const input = makeInput(cloudOctober({ servicePeriod: "2027-01" }));
    const r = guardPayment(input, makeCtx(), makeDecision(input, { ...cloudDecision, agreementPeriod: "2027-01" }));
    expectViolation(r, "el periodo cobrado (2027-01) todavía no empieza");
  });

  it("un día de margen por zona horaria: emisión de mañana sí; el 31 de octubre el mes siguiente también", () => {
    const tomorrow = makeInput(cloudOctober({ issueDate: "2026-10-21" }));
    expectApproved(guardPayment(tomorrow, makeCtx(), makeDecision(tomorrow, cloudDecision)));
    const november = makeInput(cloudOctober({ issueDate: "2026-11-01", servicePeriod: "2026-11" }));
    const r = guardPayment(november, makeCtx({ now: "2026-10-31T20:00:00-05:00" }), makeDecision(november, { ...cloudDecision, agreementPeriod: "2026-11" }));
    expectApproved(r);
  });
});

describe("guardia · el mismo número de cuenta en otro banco", () => {
  it("otro banco y otro SWIFT: no aprueba", () => {
    const input = makeInput(cloudOctober({ bankName: "Banco Pirata Internacional", routingOrSwift: "PIRAUS33" }));
    const company = withCloud((v) => ({ ...v, account: { ...v.account, routingOrSwift: "SVBKUS6S" } }));
    const r = guardPayment(input, makeCtx({ company }), makeDecision(input, cloudDecision));
    expectViolation(r, "la factura ubica la cuenta en otro banco");
  });

  it("mismo banco escrito igual pero otro número de ruteo ABA: no aprueba", () => {
    const input = makeInput(cloudOctober({ bankName: "Silicon Valley Bank", routingOrSwift: "026009593" }));
    expectViolation(guardPayment(input, makeCtx(), makeDecision(input, cloudDecision)), "la factura ubica la cuenta en otro banco");
  });

  it("otro banco sin código: no aprueba", () => {
    const input = makeInput(cloudOctober({ bankName: "Banco Pirata Internacional" }));
    expectViolation(guardPayment(input, makeCtx(), makeDecision(input, cloudDecision)), "la factura ubica la cuenta en otro banco");
  });

  it("el banco registrado escrito de otra forma, o un SWIFT donde la ficha guarda el ABA: aprueba", () => {
    for (const [bankName, routingOrSwift] of [
      ["SILICON VALLEY BANK, N.A.", "121140399"],
      ["SVB", null],
      ["Silicon Valley Bank", "SVBKUS6SXXX"],
    ] as const) {
      const input = makeInput(cloudOctober({ bankName, routingOrSwift }));
      expectApproved(guardPayment(input, makeCtx(), makeDecision(input, cloudDecision)));
    }
  });

  it("guardBankNameConflict y guardBankCodeConflict", () => {
    expect(guardBankNameConflict("Banco de Crédito del Perú", "BCP")).toBe(false);
    expect(guardBankNameConflict("Banco Itaú", "Itaú Unibanco")).toBe(false);
    expect(guardBankNameConflict("J.P. Morgan", "JPMorgan Chase")).toBe(false);
    expect(guardBankNameConflict("Interbank", "BCP")).toBe(true);
    expect(guardBankNameConflict("Banco de Chile", "BancoEstado")).toBe(true);
    expect(guardBankNameConflict(null, "BCP")).toBe(false);
    expect(guardBankCodeConflict("BCPLPEPLXXX", "BCPLPEPL")).toBe(false);
    expect(guardBankCodeConflict("BINPPEPL", "BCPLPEPL")).toBe(true);
    expect(guardBankCodeConflict("121140399", "BCPLPEPL")).toBe(false);
    expect(guardBankCodeConflict("12114O399", "121140399")).toBe(false);
    expect(guardBankCodeConflict("121140398", "121140399")).toBe(true);
    expect(guardBankCodeConflict("1211​40399", "121140399")).toBe(true);
  });
});

describe("guardia · acuerdo renovado a mitad de mes", () => {
  it("el mes ya pagado con el acuerdo anterior no se vuelve a pagar con el nuevo", () => {
    const company = withCloud((v) => ({
      ...v,
      agreements: [
        { ...v.agreements[0], validTo: "2026-10-10" },
        { ...v.agreements[0], id: "a-cloudmetrics-saas-2", validFrom: "2026-10-11", validTo: null },
      ],
    }));
    const input = makeInput(cloudOctober({ invoiceNumber: "CM-NUEVA", issueDate: "2026-10-15" }));
    const history = [
      entry({ vendorId: "v-cloudmetrics", invoiceNumber: "CM-VIEJA", agreementId: "a-cloudmetrics-saas", agreementPeriod: "2026-10", amountUsd: 1200 }),
    ];
    const r = guardPayment(input, makeCtx({ company, history }), makeDecision(input, { ...cloudDecision, agreementId: "a-cloudmetrics-saas-2" }));
    expectViolation(r, "el periodo 2026-10 del acuerdo a-cloudmetrics-saas ya se pagó");
  });
});
