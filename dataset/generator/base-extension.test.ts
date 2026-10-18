/**
 * Extensión del escenario base (B24 en adelante, dataset/generator/base-extension.ts):
 * - lo inventado para los proveedores nuevos (ids tributarios, cuentas, ABA) NO pasa el dígito de control
 *   de su formato, para no fabricar por accidente el número de una empresa o una cuenta real;
 * - los proveedores nuevos no coinciden con los del set de estrés (si ya se generó);
 * - la mezcla del escenario base completo es la pedida: ~70 % se paga, ~10 % se frena, ~20 % escala.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeName, normalizeTaxId } from "../../src/core/normalize";
import {
  accountPassesCheck,
  isValidAba,
  isValidCnpj,
  isValidCuit,
  isValidItauAccount,
  isValidRfc,
  isValidRuc,
  nitCheckDigit,
  rutCheckDigit,
} from "../stress/checksums";
import { STRESS_VENDOR_IDS } from "../stress/vendors";
import { buildExtension } from "./base-extension";
import { readCases, readCompany } from "./cases";
import { isDocumentSpec } from "./spec";

const company = readCompany();
const added = company.vendors.filter((v) => !STRESS_VENDOR_IDS.includes(v.id));
const { specs } = buildExtension(company);

/** Prefijos de EIN que el IRS no asigna (ninguna empresa real los tiene). */
const UNASSIGNED_EIN_PREFIXES = ["07", "08", "09", "17", "18", "19", "28", "29", "49", "69", "70", "78", "79", "89", "96", "97"];

/** Dígito verificador del RUT uruguayo (módulo 11 sobre los 11 primeros dígitos). */
function uyRutCheckDigit(body: string): number {
  const weights = [4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const sum = [...body].reduce((s, d, i) => s + Number(d) * weights[i], 0);
  return (11 - (sum % 11)) % 11;
}

/** ¿El id tributario pasa el control de su país? (true sería un id posiblemente real). */
function taxIdPasses(country: string, taxId: string): boolean {
  const d = taxId.replace(/\D/g, "");
  switch (country) {
    case "US":
      return !UNASSIGNED_EIN_PREFIXES.includes(d.slice(0, 2));
    case "CO":
      return nitCheckDigit(d.slice(0, -1)) === Number(d.slice(-1));
    case "MX":
      return isValidRfc(taxId);
    case "AR":
      return isValidCuit(taxId);
    case "CL":
      return rutCheckDigit(taxId.replace(/[^0-9Kk]/g, "").slice(0, -1)) === taxId.slice(-1).toUpperCase();
    case "PE":
      return isValidRuc(taxId);
    case "BR":
      return isValidCnpj(taxId);
    case "UY":
      return uyRutCheckDigit(d.slice(0, 11)) === Number(d.slice(11));
    default:
      throw new Error(`País sin control: ${country}`);
  }
}

describe("extensión del escenario base · proveedores nuevos", () => {
  it("company.json tiene 26 proveedores nuevos además de los 11 del set de estrés", () => {
    expect(STRESS_VENDOR_IDS).toHaveLength(11);
    expect(added).toHaveLength(26);
    expect(company.rules).toMatchObject({ approvalThresholdUsd: 5000, periodLimitUsd: 150000, initialFundUsd: 250000, amountTolerancePct: 1 });
  });

  it("sus ids tributarios no pasan el dígito de control (EIN: prefijo que el IRS no asigna)", () => {
    for (const v of added) expect(taxIdPasses(v.country, v.taxId ?? ""), `${v.id} ${v.taxId}`).toBe(false);
  });

  it("sus cuentas y códigos ABA no pasan el dígito de control (CLABE, CBU, Itaú, ABA…)", () => {
    for (const v of added) {
      const { accountNumber, routingOrSwift } = v.account;
      expect(accountPassesCheck(accountNumber), `${v.id} ${accountNumber}`).toBe(false);
      if (/^\d{4}-\d{5}-\d$/.test(accountNumber)) expect(isValidItauAccount(accountNumber), `${v.id} Itaú`).toBe(false);
      if (routingOrSwift && /^\d{9}$/.test(routingOrSwift)) expect(isValidAba(routingOrSwift), `${v.id} ABA ${routingOrSwift}`).toBe(false);
      // Bancos ficticios fuera de EE. UU.: SWIFT con «QX», que no existe.
      if (v.country !== "US") expect(routingOrSwift?.slice(0, 2), v.id).toBe("QX");
    }
  });

  it("las partes y cuentas que no están en la ficha (impostor B86, cuenta nueva de B48, Brisa Robotics en B91) tampoco", () => {
    const docs = new Map(specs.filter(isDocumentSpec).map((s) => [s.id, s]));
    const b86 = docs.get("B86")!;
    expect(taxIdPasses("US", b86.vendor.taxId!)).toBe(false);
    expect(accountPassesCheck(b86.payment!.accountNumber)).toBe(false);
    expect(isValidAba(b86.payment!.routingOrSwift!)).toBe(false);
    const b48 = docs.get("B48")!;
    expect(accountPassesCheck(b48.payment!.accountNumber)).toBe(false);
    expect(isValidItauAccount(b48.payment!.accountNumber)).toBe(false);
    expect(taxIdPasses("US", docs.get("B91")!.customer.taxId!)).toBe(false);
  });

  const stressSpecs = path.join(process.cwd(), "dataset", "stress", "generated", "specs.json");
  it.skipIf(!existsSync(stressSpecs))("no coinciden con ningún proveedor, id tributario ni cuenta del set de estrés", () => {
    const raw = readFileSync(stressSpecs, "utf8");
    const stress = JSON.parse(raw) as Array<{ vendor?: { name: string; taxId: string | null }; payment?: { accountNumber: string } | null }>;
    const names = new Set(stress.flatMap((s) => (s.vendor ? [normalizeName(s.vendor.name)] : [])));
    const taxIds = new Set(stress.flatMap((s) => (s.vendor?.taxId ? [normalizeTaxId(s.vendor.taxId)] : [])));
    const accounts = new Set(stress.flatMap((s) => (s.payment ? [s.payment.accountNumber.replace(/\W/g, "")] : [])));
    for (const v of added) {
      for (const n of [v.name, ...v.aliases]) expect(names.has(normalizeName(n)), `${v.id} «${n}»`).toBe(false);
      expect(taxIds.has(normalizeTaxId(v.taxId)), `${v.id} ${v.taxId}`).toBe(false);
      expect(accounts.has(v.account.accountNumber.replace(/\W/g, "")), `${v.id} ${v.account.accountNumber}`).toBe(false);
      expect(raw.includes(v.account.bankName), `${v.id} ${v.account.bankName}`).toBe(false);
    }
  });
});

describe("extensión del escenario base · mezcla", () => {
  it("el escenario base tiene 120 facturas: ~70 % PAGAR, ~10 % FRENAR, ~20 % ESCALAR", () => {
    const base = readCases().filter((r) => r.escenario === "base");
    const count = (o: string) => base.filter((r) => r.decision_esperada === o).length;
    expect(base).toHaveLength(120);
    expect([count("PAGAR"), count("FRENAR"), count("ESCALAR")]).toEqual([82, 12, 26]);
  });

  it("cada trampa nueva lleva un solo código esperado (el que falla seguro) y cada duplicado frena", () => {
    for (const r of readCases().filter((x) => specs.some((s) => s.id === x.id))) {
      if (r.decision_esperada === "PAGAR") expect(r.codigos_esperados, r.id).toEqual([]);
      else expect(r.codigos_esperados, r.id).toHaveLength(1);
      if (r.decision_esperada === "FRENAR") expect(r.codigos_esperados[0], r.id).toMatch(/^DUP-/);
    }
  });
});
