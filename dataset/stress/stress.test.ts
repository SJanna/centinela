/**
 * Set de estrés: el plan es determinista, cubre las trampas pedidas, las etiquetas salen de la
 * receta y son coherentes con la regla del catálogo, y lo inventado no imita datos reales.
 * (La evaluación completa contra el motor está en eval/stress.test.ts y corre si el set está generado.)
 */
import { beforeAll, describe, expect, it } from "vitest";
import { CHECK_BY_CODE } from "../../src/core/checks";
import { normalizeName, normalizeTaxId } from "../../src/core/normalize";
import { parseStressCases } from "../../eval/datasets";
import { readCompany } from "../generator/cases";
import { documentText, squash } from "../generator/test-helpers";
import { matchVendor } from "../generator/oracle";
import { isCopySpec, isDocumentSpec, isPhotoOfSpec, TEMPLATES } from "../generator/spec";
import { intrinsicCodes, NO_TRAP, TRAP_IDS } from "./catalog";
import { accountPassesCheck, isValidAba, isValidCbu, isValidClabe, isValidCnpj, isValidCuit, isValidItauAccount, isValidRfc, isValidRuc, nitCheckDigit, rutCheckDigit } from "./checksums";
import { Rng } from "./rng";
import { fakeBankAccount, fakeTaxId, oneDigitChanged } from "./vendors";
import { Ledger, invoiceNumberKey, usdCentsOf } from "./ledger";
import { casesCsv, renderPlan, validatePlan } from "./output";
import { planStress, type StressPlan } from "./plan";

const company = readCompany();
let plan: StressPlan;

beforeAll(() => {
  plan = planStress(company);
});

describe("plan del set de estrés", () => {
  it("2000 facturas S0001…S2000 en 40 escenarios de 40–60, y es determinista", () => {
    expect(plan.cases).toHaveLength(2000);
    expect(plan.cases.map((c) => c.spec.id)).toEqual(Array.from({ length: 2000 }, (_, i) => `S${String(i + 1).padStart(4, "0")}`));
    expect(plan.scenarios).toHaveLength(40);
    for (const sc of plan.scenarios) {
      const n = plan.cases.filter((c) => c.row.escenario === sc.id).length;
      expect(n, sc.id).toBeGreaterThanOrEqual(40);
      expect(n, sc.id).toBeLessThanOrEqual(60);
      expect(["2026-10", "2026-11"]).toContain(sc.now.slice(0, 7));
    }
    const again = planStress(company);
    expect(JSON.stringify(again.cases.map((c) => [c.spec, c.row]))).toBe(JSON.stringify(plan.cases.map((c) => [c.spec, c.row])));
  });

  it("todas las specs son válidas para el generador y sus referencias van antes, en el mismo escenario", () => {
    expect(() => validatePlan(plan)).not.toThrow();
  });

  it("~45 % legítimas y ~55 % trampas; cada trampa del catálogo aparece", () => {
    const legit = plan.cases.filter((c) => c.traps.length === 0).length;
    expect(legit / 2000).toBeGreaterThan(0.4);
    expect(legit / 2000).toBeLessThan(0.5);
    const counts = new Map<string, number>();
    for (const c of plan.cases) for (const t of c.traps) counts.set(t, (counts.get(t) ?? 0) + 1);
    for (const t of TRAP_IDS) expect(counts.get(t) ?? 0, t).toBeGreaterThanOrEqual(8);
    expect(plan.cases.filter((c) => c.traps.length >= 2).length).toBeGreaterThan(50);
  });

  it("cubre formatos, plantillas, idiomas, dificultades y escenarios con reglas distintas", () => {
    const rows = plan.cases.map((c) => c.row);
    expect(new Set(rows.map((r) => r.formato))).toEqual(new Set(["pdf", "png", "jpg", "eml", "txt"]));
    expect(new Set(rows.map((r) => r.idioma))).toEqual(new Set(["es", "pt", "en"]));
    expect(new Set(rows.map((r) => r.dificultad))).toEqual(new Set(["baja", "media", "alta"]));
    const legitTemplates = new Set(plan.cases.filter((c) => c.traps.length === 0 && c.spec.format === "pdf" && isDocumentSpec(c.spec)).map((c) => (isDocumentSpec(c.spec) ? c.spec.template : null)));
    for (const t of TEMPLATES.filter((x) => x !== "portal")) expect(legitTemplates.has(t), t).toBe(true);
    const presentations = new Set(rows.map((r) => r.plantilla));
    for (const p of ["correo_cuerpo", "chat", "portal"]) expect(presentations.has(p), p).toBe(true);
    expect([...presentations].some((p) => p.startsWith("correo+adjunto_"))).toBe(true);
    expect(new Set(plan.scenarios.map((s) => s.kind))).toEqual(new Set(["volumen", "limite_bajo", "fondo_bajo", "reglas_base", "tolerancia_0", "tolerancia_2", "umbral_bajo"]));
    const photos = plan.cases.flatMap((c) => (isDocumentSpec(c.spec) && c.spec.photo ? [c.spec.photo] : []));
    expect(Math.min(...photos.map((p) => p.angle))).toBeLessThan(-4);
    expect(Math.max(...photos.map((p) => p.angle))).toBeGreaterThan(4);
    expect(new Set(photos.map((p) => p.surface))).toEqual(new Set(["desk", "wood", "fabric"]));
  });

  it("etiquetas: legítimas → PAGAR sin códigos; trampas → sus códigos y la regla del catálogo", () => {
    for (const c of plan.cases) {
      const { row } = c;
      if (c.traps.length === 0) {
        expect(row.trampa, row.id).toBe(NO_TRAP);
        expect(row.decision_esperada, row.id).toBe("PAGAR");
        expect(row.codigos_esperados, row.id).toEqual([]);
        continue;
      }
      expect(row.decision_esperada, row.id).not.toBe("PAGAR");
      for (const code of intrinsicCodes(c.traps)) expect(row.codigos_esperados, `${row.id} ${row.trampa}`).toContain(code);
      const frenar = row.codigos_esperados.some((code) => CHECK_BY_CODE[code].outcomeIfFail === "FRENAR");
      expect(row.decision_esperada, row.id).toBe(frenar ? "FRENAR" : "ESCALAR");
    }
  });

  it("los duplicados apuntan a una factura anterior del mismo escenario y repiten su número", () => {
    const byId = new Map(plan.cases.map((c) => [c.spec.id, c]));
    for (const c of plan.cases) {
      const s = c.spec;
      if (isCopySpec(s)) expect(c.row.codigos_esperados, s.id).toContain("DUP-1");
      if (isPhotoOfSpec(s)) {
        const src = byId.get(s.photoOf)!;
        expect(src.row.decision_esperada, s.id).toBe("PAGAR");
        expect(c.row.codigos_esperados, s.id).toContain("DUP-2");
      }
      if (c.traps.includes("duplicado_numero") && c.content && !isCopySpec(s)) {
        const paid = plan.cases.filter((x) => x.row.escenario === c.row.escenario && x.row.decision_esperada === "PAGAR" && x.content?.vendorId === c.content?.vendorId);
        expect(paid.some((x) => invoiceNumberKey(x.content!.invoiceNumber) === invoiceNumberKey(c.content!.invoiceNumber)), s.id).toBe(true);
      }
    }
  });

  it("los impostores no coinciden con la ficha por nombre ni por id tributario (salvo «mismo nombre, otro id»)", () => {
    for (const c of plan.cases.filter((x) => x.traps.includes("proveedor_parecido") && x.content)) {
      const party = c.content!.party;
      const registered = company.vendors.find((v) => v.name === party.name);
      if (registered) {
        expect(normalizeTaxId(party.taxId), c.spec.id).not.toBe(normalizeTaxId(registered.taxId));
        continue;
      }
      const gt = {
        vendorName: { value: party.name, evidence: null, legible: true },
        vendorTaxId: { value: party.taxId, evidence: null, legible: true },
      } as Parameters<typeof matchVendor>[1];
      expect(matchVendor(company, gt), `${c.spec.id} «${party.name}»`).toBeNull();
    }
  });

  it("los textos de la plantilla que nombran la moneda dicen la de la factura (otra moneda no se contradice)", () => {
    const codes = ["USD", "COP", "MXN", "BRL", "PEN", "ARS", "CLP", "EUR", "GBP"];
    let checked = 0;
    for (const c of plan.cases) {
      if (!isDocumentSpec(c.spec)) continue;
      const s = c.spec;
      for (const key of ["currencyText", "paymentSubtitle"]) {
        const text = s.templateData[key];
        if (!text) continue;
        const named = codes.filter((code) => text.includes(code));
        if (key === "currencyText") expect(named, `${s.id} ${key} «${text}» (${s.currency})`).toEqual([s.currency]);
        else for (const code of named) expect(code, `${s.id} ${key} «${text}» (${s.currency})`).toBe(s.currency);
        if (c.traps.includes("otra_moneda")) checked++;
      }
    }
    expect(checked).toBeGreaterThan(5);
  });

  it("los homoglifos solo van donde el archivo trae el texto (correo sin adjunto, chat): en una imagen se ven idénticos al nombre registrado", () => {
    const cyrillic = /[Ѐ-ӿ]/;
    const withHomoglyph = plan.cases.filter((c) => c.content && cyrillic.test(c.content.party.name));
    expect(withHomoglyph.length).toBeGreaterThan(5);
    for (const c of withHomoglyph) {
      const s = c.spec;
      const textual = s.format === "txt" || (s.format === "eml" && isDocumentSpec(s) && s.attachment == null);
      expect(textual, `${s.id} ${s.format} «${c.content!.party.name}»`).toBe(true);
    }
  });

  it("lo inventado no pasa dígitos de control (CLABE, CBU, ABA, NIT, CUIT, RUT, CNPJ, RUC)", () => {
    const registeredAccounts = new Set(company.vendors.map((v) => v.account.accountNumber.replace(/\D/g, "")));
    const registeredRouting = new Set(company.vendors.map((v) => v.account.routingOrSwift));
    const registeredTax = new Set(company.vendors.map((v) => normalizeTaxId(v.taxId)));
    let checked = 0;
    for (const c of plan.cases) {
      if (!c.content) continue;
      const pay = c.content.payment;
      if (pay && !registeredAccounts.has(pay.accountNumber.replace(/\D/g, ""))) {
        expect(accountPassesCheck(pay.accountNumber), `${c.spec.id} ${pay.accountNumber}`).toBe(false);
        // Agência-conta-dígito con la forma de Itaú (la de la ficha de Testa Qualidade).
        if (/^\d{4}-\d{5}-\d$/.test(pay.accountNumber)) expect(isValidItauAccount(pay.accountNumber), `${c.spec.id} Itaú ${pay.accountNumber}`).toBe(false);
        checked++;
      }
      if (pay?.routingOrSwift && /^\d{9}$/.test(pay.routingOrSwift) && !registeredRouting.has(pay.routingOrSwift)) {
        expect(isValidAba(pay.routingOrSwift), `${c.spec.id} ABA ${pay.routingOrSwift}`).toBe(false);
      }
      const tax = c.content.party.taxId;
      if (tax && !registeredTax.has(normalizeTaxId(tax)) && c.content.vendorId == null) {
        const d = tax.replace(/\D/g, "");
        const label = c.content.party.taxIdLabel;
        if (label === "CUIT") expect(isValidCuit(tax), tax).toBe(false);
        if (label === "CNPJ") expect(isValidCnpj(tax), tax).toBe(false);
        if (label === "RUC") expect(isValidRuc(tax), tax).toBe(false);
        if (label === "NIT") expect(nitCheckDigit(d.slice(0, -1)), tax).not.toBe(Number(d.slice(-1)));
        if (label === "RUT") expect(rutCheckDigit(tax.replace(/[^0-9Kk]/g, "").slice(0, -1)), tax).not.toBe(tax.slice(-1).toUpperCase());
        if (label === "RFC") expect(isValidRfc(tax), tax).toBe(false);
      }
    }
    expect(checked).toBeGreaterThan(200);
  });

  it("«otra_empresa»: 20 facturas en varios formatos, dirigidas a otra empresa, por lo demás impecables → ESCALAR [ACU-1]", () => {
    const cases = plan.cases.filter((c) => c.traps.includes("otra_empresa"));
    expect(cases).toHaveLength(20);
    const buyer = new Set([company.name, ...(company.buyer?.legalNames ?? []), ...(company.buyer?.aliases ?? [])].map((n) => normalizeName(n)));
    const buyerTax = new Set((company.buyer?.taxIds ?? []).map((t) => normalizeTaxId(t)));
    for (const c of cases) {
      const s = c.spec;
      expect(isDocumentSpec(s), s.id).toBe(true);
      if (!isDocumentSpec(s)) continue;
      expect(c.traps, s.id).toEqual(["otra_empresa"]);
      expect(c.row.decision_esperada, s.id).toBe("ESCALAR");
      expect(c.row.codigos_esperados, s.id).toEqual(["ACU-1"]);
      // Proveedor registrado, su cuenta registrada y el monto pactado.
      const v = company.vendors.find((x) => x.id === s.vendorId)!;
      expect(v, s.id).toBeDefined();
      expect(s.vendor.name, s.id).toBe(v.name);
      expect(s.payment?.accountNumber.replace(/\W/g, ""), s.id).toBe(v.account.accountNumber.replace(/\W/g, ""));
      if (v.agreements[0].kind !== "hourly") expect(s.total, s.id).toBe(v.agreements[0].amount);
      // Dirigida a otra empresa: otro nombre, u otro id tributario con el mismo nombre.
      const sameName = buyer.has(normalizeName(s.customer.name));
      expect(!sameName || !buyerTax.has(normalizeTaxId(s.customer.taxId)), s.id).toBe(true);
      if (sameName) expect(s.template === "portal" || s.attachment?.template === "portal", `${s.id}: el id debe verse`).toBe(false);
    }
    // Varios formatos donde se ve el destinatario.
    expect(new Set(cases.map((c) => c.row.plantilla.replace(/^correo\+adjunto_.*/, "correo+adjunto")))).toEqual(
      new Set(["saas", "latam", "correo+adjunto", "correo_cuerpo", "chat"]),
    );
    expect(new Set(cases.map((c) => c.row.formato))).toEqual(new Set(["pdf", "png", "jpg", "eml", "txt"]));
    // Lo inventado no pasa el dígito de control (NIT, RUT, RFC); el EIN no tiene.
    for (const c of cases) {
      const cu = (c.spec as { customer: { taxIdLabel: string | null; taxId: string | null } }).customer;
      const tax = cu.taxId ?? "";
      const d = tax.replace(/\D/g, "");
      if (cu.taxIdLabel === "NIT") expect(nitCheckDigit(d.slice(0, -1)), tax).not.toBe(Number(d.slice(-1)));
      if (cu.taxIdLabel === "RUT") expect(rutCheckDigit(tax.replace(/[^0-9Kk]/g, "").slice(0, -1)), tax).not.toBe(tax.slice(-1).toUpperCase());
      if (cu.taxIdLabel === "RFC") expect(isValidRfc(tax), tax).toBe(false);
    }
    // Las demás facturas siguen dirigidas a Andes Labs Inc.
    for (const c of plan.cases) {
      if (c.traps.includes("otra_empresa") || !isDocumentSpec(c.spec)) continue;
      expect(c.spec.customer.name, c.spec.id).toBe("Andes Labs Inc.");
      expect(c.spec.customer.taxId, c.spec.id).toBe("93-4127765");
    }
  });

  it("casos.csv se lee con el lector del banco de pruebas y conserva las etiquetas", () => {
    const { rows, extras } = parseStressCases(casesCsv(plan.cases.map((c) => c.row)));
    expect(rows).toHaveLength(2000);
    rows.forEach((r, i) => {
      const src = plan.cases[i].row;
      expect(r).toEqual({ id: src.id, split: src.split, escenario: src.escenario, formato: src.formato, proveedor: src.proveedor, descripcion: src.descripcion, decision_esperada: src.decision_esperada, codigos_esperados: src.codigos_esperados });
      expect(extras.get(r.id)).toEqual({ trampa: src.trampa, dificultad: src.dificultad, idioma: src.idioma, plantilla: src.plantilla });
    });
  });

  it("genera archivos para todos los tipos (documentos, fotos de otro caso y copias exactas)", async () => {
    const small = planStress(company, { total: 100, seed: 3 });
    const specs = validatePlan(small);
    const generated = await renderPlan(specs);
    expect(generated.size).toBe(100);
    for (const s of specs.filter(isCopySpec)) expect(generated.get(s.id)!.sha256).toBe(generated.get(s.copyOf)!.sha256);
    const hashes = specs.filter((s) => !isCopySpec(s)).map((s) => generated.get(s.id)!.sha256);
    expect(new Set(hashes).size).toBe(hashes.length);
    // La lectura «perfecta» cita texto que de verdad está en el archivo (PDF, correo con o sin adjunto, chat).
    let quotes = 0;
    for (const g of generated.values()) {
      if (g.mediaType.startsWith("image/")) continue;
      const text = squash(await documentText(g));
      const gt = g.groundTruth;
      const fields = [gt.vendorName, gt.vendorTaxId, gt.billToName, gt.billToTaxId, gt.invoiceNumber, gt.issueDate, gt.dueDate, gt.servicePeriod, gt.currency, gt.subtotal, gt.tax, gt.total, ...Object.values(gt.payment)];
      for (const f of fields) {
        if (f?.evidence == null) continue;
        quotes++;
        expect(text, `${g.caseId}: «${f.evidence}»`).toContain(squash(f.evidence));
      }
      for (const ins of gt.embeddedInstructions) expect(text, `${g.caseId}: instrucción`).toContain(squash(ins.text));
    }
    expect(quotes).toBeGreaterThan(500);
  });
});

describe("libro del escenario y dígitos de control", () => {
  it("normaliza el número de factura como dice ARCHITECTURE.md", () => {
    expect(invoiceNumberKey("FE-0012")).toBe("FE12");
    expect(invoiceNumberKey("fe 12")).toBe("FE12");
    expect(invoiceNumberKey("0003-00000871")).toBe("3871");
    expect(invoiceNumberKey("CRD-03101")).toBe(invoiceNumberKey("CRD 3101"));
  });

  it("monto en USD con la tasa fija y redondeo al centavo", () => {
    const rules = company.rules;
    expect(usdCentsOf(12000000, "COP", rules)).toBe(300000);
    expect(usdCentsOf(90918, "MXN", rules)).toBe(500049);
    expect(usdCentsOf(100, "GBP", rules)).toBeNull();
  });

  it("aplica duplicados, umbral, límite y fondo con la regla del catálogo", () => {
    const ledger = new Ledger({ ...company.rules, periodLimitUsd: 5000, initialFundUsd: 4000 });
    const facts = { vendorId: "v-x", agreementId: "a-x", period: "2026-10", numberKey: "F1", fileKey: "S1", usdCents: 300000, intrinsic: [] };
    expect(ledger.label(facts)).toEqual({ outcome: "PAGAR", codes: [], added: [] });
    ledger.commit(facts, "PAGAR");
    expect(ledger.label({ ...facts, fileKey: "S2", numberKey: "F2", period: "2026-09", usdCents: 150000 }).codes).toEqual(["FON-1"]);
    expect(ledger.label({ ...facts, fileKey: "S2", numberKey: "F2", period: "2026-09", usdCents: 100000 }).outcome).toBe("PAGAR");
    expect(ledger.label({ ...facts, fileKey: "S1", usdCents: 50000 })).toMatchObject({ outcome: "FRENAR", codes: ["DUP-1", "DUP-2", "DUP-3"] });
    expect(ledger.label({ ...facts, fileKey: "S3", numberKey: "F3", period: "2026-08", usdCents: 600000, intrinsic: ["PRV-2"] })).toMatchObject({
      outcome: "FRENAR",
      codes: ["PRV-2", "LIM-1", "LIM-2", "FON-1"],
    });
  });

  it("los validadores reconocen números correctos", () => {
    expect(isValidClabe("032180000118359719")).toBe(true);
    expect(isValidClabe("032180000118359718")).toBe(false);
    expect(isValidCbu("2850590940090418135201")).toBe(true);
    expect(isValidCbu("2850590940090418135202")).toBe(false);
    expect(isValidAba("011000015")).toBe(true);
    expect(isValidAba("011000016")).toBe(false);
    expect(isValidCuit("20-12345678-6")).toBe(true);
    expect(rutCheckDigit("12345678")).toBe("5");
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
    expect(nitCheckDigit("800197268")).toBe(4);
    // Itaú: dígito de la agência + conta (pesos 2,1,2,1…, suma de dígitos, módulo 10).
    expect(isValidItauAccount("6223-63531-6")).toBe(true);
    expect(isValidItauAccount("0341-45678-9")).toBe(false);
    expect(accountPassesCheck("6223-63531-6")).toBe(true);
    // RFC (SAT): «SAT970701NN3» es el del propio SAT.
    expect(isValidRfc("SAT970701NN3")).toBe(true);
    expect(isValidRfc("SAT970701NN4")).toBe(false);
    expect(isValidRfc("ENO210415AB3")).toBe(false);
  });

  it("las cuentas e ids inventados para cualquier semilla tampoco pasan el dígito de control", () => {
    for (let seed = 1; seed <= 400; seed++) {
      const rng = new Rng(seed);
      expect(isValidRfc(fakeTaxId("MX", rng)), `RFC semilla ${seed}`).toBe(false);
      const acc = fakeBankAccount("BR", "Prueba Ltda", rng);
      expect(isValidItauAccount(acc.accountNumber), `Itaú semilla ${seed} ${acc.accountNumber}`).toBe(false);
      const changed = oneDigitChanged("0341-45678-9", rng).account;
      expect(isValidItauAccount(changed), `Itaú un dígito semilla ${seed} ${changed}`).toBe(false);
    }
  });
});
