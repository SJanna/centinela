import { describe, expect, it } from "vitest";
import type { Agreement, Vendor } from "../core/schemas";
import { agreementPeriodOf, computeUsdAmount, matchVendor, normalizeInvoiceNumber, selectAgreement } from "./index";
import { ACME, BUFETE, NOPAL, ROBLE, RULES, acmeInvoice, bufeteInvoice } from "./test-fixtures";

const VENDORS = [ACME, NOPAL, BUFETE, ROBLE];

describe("matchVendor", () => {
  it("empareja por identificación tributaria normalizada aunque el nombre sea otro", () => {
    const m = matchVendor(acmeInvoice({ vendorName: "Otro nombre", vendorTaxId: "900123456-7" }), VENDORS);
    expect(m.vendor?.id).toBe("v-acme");
    expect(m.basis).toBe("tax_id");
  });

  it("empareja por nombre normalizado (tildes, mayúsculas, sufijo societario) si falta la identificación", () => {
    const m = matchVendor(acmeInvoice({ vendorName: "ACME DEV SAS", vendorTaxId: null }), VENDORS);
    expect(m.vendor?.id).toBe("v-acme");
    expect(m.basis).toBe("name");
  });

  it("empareja por alias", () => {
    expect(matchVendor(acmeInvoice({ vendorName: "Viejo Roble", vendorTaxId: null }), VENDORS).vendor?.id).toBe("v-roble");
  });

  it("no empareja si el nombre coincide pero la identificación es distinta", () => {
    const m = matchVendor(acmeInvoice({ vendorTaxId: "800.999.999-1" }), VENDORS);
    expect(m.vendor).toBeNull();
    expect(m.basis).toBe("tax_id_conflict");
    expect(m.reason).toContain("no es la registrada");
  });

  it("empareja por nombre si el proveedor registrado no tiene identificación", () => {
    const noTax: Vendor = { ...ACME, taxId: null };
    expect(matchVendor(acmeInvoice({ vendorTaxId: "123" }), [noTax]).vendor?.id).toBe("v-acme");
  });

  it("ambiguo si coinciden dos proveedores", () => {
    const twin: Vendor = { ...ACME, id: "v-acme-2", taxId: null };
    const m = matchVendor(acmeInvoice({ vendorTaxId: null }), [ACME, twin]);
    expect(m.vendor).toBeNull();
    expect(m.basis).toBe("ambiguous");
  });

  it("sin coincidencia y sin identidad", () => {
    expect(matchVendor(acmeInvoice({ vendorName: "Quantum Freelance LLC", vendorTaxId: null }), VENDORS).basis).toBe("none");
    expect(matchVendor(acmeInvoice({ vendorName: null, vendorTaxId: null }), VENDORS).basis).toBe("no_identity");
  });
});

describe("selectAgreement", () => {
  const ag = (over: Partial<Agreement>): Agreement => ({ ...ACME.agreements[0], ...over });

  it("elige el vigente para la fecha de emisión (bordes incluidos)", () => {
    const v: Vendor = { ...BUFETE };
    expect(selectAgreement(v, bufeteInvoice({ issueDate: "2026-10-01" })).status).toBe("selected");
    expect(selectAgreement(v, bufeteInvoice({ issueDate: "2026-12-31" })).status).toBe("selected");
    const before = selectAgreement(v, bufeteInvoice({ issueDate: "2026-09-30" }));
    expect(before.status).toBe("none_valid");
    expect(before.closest?.id).toBe("a-bufete-cotizacion");
  });

  it("sin fecha de emisión → no_date", () => {
    expect(selectAgreement(ACME, acmeInvoice({ issueDate: null })).status).toBe("no_date");
    expect(selectAgreement(ACME, acmeInvoice({ issueDate: "05/10/2026" })).status).toBe("no_date");
  });

  it("prefiere el de la misma moneda y luego el primero", () => {
    const v: Vendor = {
      ...ACME,
      agreements: [ag({ id: "usd-1", currency: "USD" }), ag({ id: "cop-1" }), ag({ id: "cop-2" })],
    };
    expect(selectAgreement(v, acmeInvoice()).agreement?.id).toBe("cop-1");
    expect(selectAgreement(v, acmeInvoice({ currency: "EUR" })).agreement?.id).toBe("usd-1");
  });

  it("si ninguno está vigente, devuelve el último vencido como referencia", () => {
    const v: Vendor = {
      ...ACME,
      agreements: [
        ag({ id: "old", validFrom: "2025-01-01", validTo: "2025-06-30" }),
        ag({ id: "newer", validFrom: "2025-07-01", validTo: "2026-06-30" }),
      ],
    };
    const s = selectAgreement(v, acmeInvoice());
    expect(s.status).toBe("none_valid");
    expect(s.closest?.id).toBe("newer");
  });
});

describe("agreementPeriodOf", () => {
  it("mensual: periodo facturado, o mes de emisión; único: null", () => {
    expect(agreementPeriodOf(ACME.agreements[0], acmeInvoice({ servicePeriod: "2026-09" }))).toBe("2026-09");
    expect(agreementPeriodOf(ACME.agreements[0], acmeInvoice({ servicePeriod: null }))).toBe("2026-10");
    expect(agreementPeriodOf(ACME.agreements[0], acmeInvoice({ servicePeriod: "septiembre", issueDate: "2026-08-31" }))).toBe(
      "2026-08",
    );
    expect(agreementPeriodOf(ACME.agreements[0], acmeInvoice({ servicePeriod: null, issueDate: null }))).toBeNull();
    expect(agreementPeriodOf(BUFETE.agreements[0], bufeteInvoice({ servicePeriod: "2026-10" }))).toBeNull();
  });
});

describe("computeUsdAmount y normalizeInvoiceNumber", () => {
  it("convierte con la tasa fija en centavos", () => {
    const r = computeUsdAmount(acmeInvoice({ currency: "BRL", total: 9500 }), RULES);
    expect(r).toMatchObject({ ok: true, amountUsdCents: 180_500 });
  });
  it("no convierte monedas sin tasa ni claves heredadas del prototipo", () => {
    expect(computeUsdAmount(acmeInvoice({ currency: "XYZ" }), RULES)).toMatchObject({ ok: false, reason: "no_rate" });
    expect(computeUsdAmount(acmeInvoice({ currency: "constructor" }), RULES)).toMatchObject({ ok: false, reason: "no_rate" });
  });
  it("normaliza números de factura", () => {
    expect(normalizeInvoiceNumber(" fe-1001 ")).toBe("FE1001");
    expect(normalizeInvoiceNumber("Nº 12/á")).toBe("N12A");
    expect(normalizeInvoiceNumber(" - ")).toBeNull();
  });
});
