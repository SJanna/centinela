/**
 * La guardia contra la empresa real del dataset (dataset/company.json, solo lectura): una factura
 * «perfecta» por cada acuerdo, emitida en octubre de 2026, debe aprobarse salvo que el acuerdo no
 * esté vigente o el monto supere el umbral. Detecta si la normalización propia de la guardia no
 * reconoce los formatos reales de ids tributarios, nombres y cuentas registrados.
 */
import { describe, expect, it } from "vitest";
import companyJson from "../../dataset/company.json";
import type { Company } from "../core/schemas";
import { guardPayment } from "./index";
import { makeCtx, makeDecision, makeInput, type InvoiceSpec } from "./test-fixtures";

const company = companyJson as unknown as Company;
const ISSUE = "2026-10-15";

function perfectInvoice(vendor: Company["vendors"][number], agreement: Company["vendors"][number]["agreements"][number]): InvoiceSpec {
  const hourly = agreement.kind === "hourly";
  const quantity = hourly ? Math.min(10, agreement.maxQuantity ?? 10) : 1;
  const unitPrice = hourly ? (agreement.rate ?? 0) : (agreement.amount ?? 0);
  const total = quantity * unitPrice;
  return {
    vendorName: vendor.name,
    vendorTaxId: vendor.taxId,
    invoiceNumber: `${vendor.id}-2026-10`,
    issueDate: ISSUE,
    servicePeriod: "2026-10",
    currency: agreement.currency,
    total,
    lineItems: [{ description: agreement.description, quantity, unitPrice, amount: total }],
    accountNumber: vendor.account.accountNumber,
  };
}

const cases = company.vendors.flatMap((vendor) => vendor.agreements.map((agreement) => ({ vendor, agreement })));

describe("guardPayment · empresa del dataset", () => {
  it.each(cases.map((c) => [c.vendor.id, c] as const))("%s", (_id, { vendor, agreement }) => {
    const spec = perfectInvoice(vendor, agreement);
    const input = makeInput(spec, { invoiceId: `inv-${vendor.id}`, fileHash: `hash-${vendor.id}` });
    const usd = Number(((spec.total ?? 0) * company.rules.fxToUsd[agreement.currency]).toFixed(2));
    const decision = makeDecision(input, { vendorId: vendor.id, agreementId: agreement.id, agreementPeriod: "2026-10", amountUsd: usd });
    const r = guardPayment(input, makeCtx({ company }), decision);

    const active = agreement.validFrom <= ISSUE && (agreement.validTo === null || ISSUE <= agreement.validTo);
    const underThreshold = usd <= company.rules.approvalThresholdUsd;
    if (active && underThreshold) {
      expect(r.violations).toEqual([]);
      expect(r.approved).toBe(true);
    } else {
      expect(r.approved).toBe(false);
      if (!active) expect(r.violations.join(" | ")).toContain("no hay acuerdo vigente");
      if (!underThreshold) expect(r.violations.join(" | ")).toContain("supera el umbral de aprobación");
    }
  });

  it("los proveedores que el dataset espera poder pagar se aprueban y los demás no", () => {
    const approved = cases
      .filter(({ vendor, agreement }) => {
        const spec = perfectInvoice(vendor, agreement);
        const input = makeInput(spec);
        const usd = Number(((spec.total ?? 0) * company.rules.fxToUsd[agreement.currency]).toFixed(2));
        const d = makeDecision(input, { vendorId: vendor.id, agreementId: agreement.id, agreementPeriod: "2026-10", amountUsd: usd });
        return guardPayment(input, makeCtx({ company }), d).approved;
      })
      .map(({ vendor }) => vendor.id)
      .sort();
    // Todos menos Northwind (USD 7.200, sobre el umbral) y los contratos terminados (Viejo Roble, Patio Jacaranda).
    expect(approved).toEqual(
      company.vendors
        .map((v) => v.id)
        .filter((id) => !["v-northwind", "v-roble", "v-jacaranda"].includes(id))
        .sort(),
    );
    expect(approved).toHaveLength(34);
  });
});
