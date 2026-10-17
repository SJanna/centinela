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

  it("empareja si solo una identificación trae el dígito de verificación separado", () => {
    expect(matchVendor(acmeInvoice({ vendorName: "Otro nombre", vendorTaxId: "900.123.456" }), VENDORS).basis).toBe("tax_id");
    expect(matchVendor(acmeInvoice({ vendorName: "Otro nombre", vendorTaxId: "900 123 456 - 7" }), VENDORS).basis).toBe("tax_id");
  });

  it("no empareja si las dos traen dígito de verificación y difieren", () => {
    const m = matchVendor(acmeInvoice({ vendorTaxId: "900.123.456-8" }), VENDORS);
    expect(m.basis).toBe("tax_id_conflict");
  });

  it("empareja por nombre normalizado (tildes, mayúsculas, sufijo societario) si falta la identificación", () => {
    const m = matchVendor(acmeInvoice({ vendorName: "ACME DEV SAS", vendorTaxId: null }), VENDORS);
    expect(m.vendor?.id).toBe("v-acme");
    expect(m.basis).toBe("name");
  });

  it("por nombre solo ignora la forma societaria AL FINAL (no en medio, ni «ME», ni pegada con punto)", () => {
    for (const vendorName of ["Acme SA Dev", "Acme Dev ME", "Acme Dev.SAS"]) {
      expect(matchVendor(acmeInvoice({ vendorName, vendorTaxId: null }), VENDORS).vendor, vendorName).toBeNull();
    }
    for (const vendorName of ["Acme Dev S.A.S.", "ACME DEV S A S", "Acme Dev, S.A.S", "Acme Dev SA", "Acme Dev"]) {
      expect(matchVendor(acmeInvoice({ vendorName, vendorTaxId: null }), VENDORS).vendor?.id, vendorName).toBe("v-acme");
    }
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

  it("sin fecha de emisión usa el día de now; sin now válido → no_date", () => {
    const s = selectAgreement(ACME, acmeInvoice({ issueDate: null }), "2026-10-20T15:00:00Z");
    expect(s).toMatchObject({ status: "selected", referenceDate: "2026-10-20", referenceSource: "now", billedPeriod: "2026-10" });
    expect(selectAgreement(ACME, acmeInvoice({ issueDate: null })).status).toBe("no_date");
    expect(selectAgreement(ACME, acmeInvoice({ issueDate: "  " }), "no es fecha").status).toBe("no_date");
  });

  it("fecha de emisión presente pero inválida → invalid_date (no se usa now)", () => {
    for (const issueDate of ["05/10/2026", "2026-02-29", "2026-10-05T00:00:00Z"]) {
      expect(selectAgreement(ACME, acmeInvoice({ issueDate }), "2026-10-20T15:00:00Z").status, issueDate).toBe("invalid_date");
    }
  });

  it("el periodo facturado debe caer dentro de la vigencia (period_outside / invalid_period)", () => {
    const out = selectAgreement(BUFETE, bufeteInvoice({ servicePeriod: "2026-09" }));
    expect(out).toMatchObject({ status: "period_outside", agreement: null, billedPeriod: "2026-09" });
    expect(out.closest?.id).toBe("a-bufete-cotizacion");
    expect(selectAgreement(BUFETE, bufeteInvoice({ servicePeriod: "sept." })).status).toBe("invalid_period");
    expect(selectAgreement(BUFETE, bufeteInvoice({ servicePeriod: "2026-12" })).status).toBe("selected");
  });

  it("entre varios vigentes elige uno que cubra el periodo", () => {
    const v: Vendor = {
      ...ACME,
      agreements: [ag({ id: "nuevo", validFrom: "2026-10-01" }), ag({ id: "viejo", validFrom: "2026-01-01", validTo: "2026-12-31" })],
    };
    expect(selectAgreement(v, acmeInvoice({ issueDate: "2026-10-05", servicePeriod: "2026-09" })).agreement?.id).toBe("viejo");
    expect(selectAgreement(v, acmeInvoice({ issueDate: "2026-10-05", servicePeriod: "2026-10" })).agreement?.id).toBe("nuevo");
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
  it("mensual: periodo facturado, o mes de emisión, o mes de now; único: null", () => {
    expect(agreementPeriodOf(ACME.agreements[0], acmeInvoice({ servicePeriod: "2026-09" }))).toBe("2026-09");
    expect(agreementPeriodOf(ACME.agreements[0], acmeInvoice({ servicePeriod: "2026-09-15" }))).toBe("2026-09");
    expect(agreementPeriodOf(ACME.agreements[0], acmeInvoice({ servicePeriod: null }))).toBe("2026-10");
    // Un periodo escrito que no es un mes válido no se reemplaza por el mes de emisión.
    expect(agreementPeriodOf(ACME.agreements[0], acmeInvoice({ servicePeriod: "septiembre", issueDate: "2026-08-31" }))).toBeNull();
    expect(agreementPeriodOf(ACME.agreements[0], acmeInvoice({ servicePeriod: null, issueDate: null }))).toBeNull();
    expect(agreementPeriodOf(ACME.agreements[0], acmeInvoice({ servicePeriod: null, issueDate: null }), "2026-11-02T08:00:00Z")).toBe(
      "2026-11",
    );
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
  it("normaliza números de factura (sin ceros a la izquierda en cada tramo)", () => {
    expect(normalizeInvoiceNumber(" fe-1001 ")).toBe("FE1001");
    expect(normalizeInvoiceNumber("Nº 12/á")).toBe("N12A");
    expect(normalizeInvoiceNumber(" - ")).toBeNull();
    expect(normalizeInvoiceNumber("FE-0012")).toBe("FE12");
    expect(normalizeInvoiceNumber("fe 12")).toBe("FE12");
    expect(normalizeInvoiceNumber("FE0012")).toBe("FE12");
    expect(normalizeInvoiceNumber("F-0-01")).toBe("F01");
    expect(normalizeInvoiceNumber("000")).toBe("0");
  });
});
