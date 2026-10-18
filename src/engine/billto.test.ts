/**
 * ACU-1 · a quién va dirigida la factura. El acuerdo es entre el proveedor y NUESTRA empresa: una
 * factura dirigida a otra razón social o a otro id tributario no se paga aunque el monto, la cuenta y
 * el acuerdo cuadren (LOG-11 del equipo rojo). Sin destinatario (común en chats) no se penaliza.
 */
import { describe, expect, it } from "vitest";
import type { Company, EngineInput, InvoiceData } from "../core/schemas";
import { decide } from "./decide";
import { buyerIdentity } from "./facts";
import { acmeInvoice, BUYER, check, company, context, engineInput, extractionFrom, ROBLE } from "./test-fixtures";

const withBuyer = context({ buyer: BUYER });

function billed(name: string | null, taxId: string | null = null, over: Partial<InvoiceData> = {}): EngineInput {
  return engineInput(acmeInvoice({ billToName: name, billToTaxId: taxId, ...over }));
}

function acu1(input: EngineInput, ctx = withBuyer) {
  const d = decide(input, ctx);
  return { d, acu1: check(d, "ACU-1") };
}

describe("ACU-1 · destinatario que corresponde a la empresa", () => {
  it.each([
    ["el nombre registrado con su EIN", "Andes Labs Inc.", "93-4127765"],
    ["el nombre sin punto", "Andes Labs Inc", null],
    ["la forma societaria escrita completa", "Andes Labs Incorporated", null],
    ["el nombre con coma y el EIN", "Andes Labs, Inc.", "93-4127765"],
    ["el nombre en mayúsculas y con coma", "ANDES LABS, INC.", null],
    ["el alias de la ficha", "Andes Labs", null],
    ["el EIN con su etiqueta", "Andes Labs Inc.", "EIN 93-4127765"],
    ["el EIN sin guion", "Andes Labs Inc.", "934127765"],
    ["solo el EIN", null, "93-4127765"],
  ])("%s → corresponde y se paga", (_what, name, taxId) => {
    const { d, acu1: c } = acu1(billed(name, taxId));
    expect(c.status).toBe("pass");
    expect(c.explanation).toMatch(/La factura está dirigida a Andes Labs Inc\., nuestra empresa\.$/);
    expect(c.params.billToMatches).toBe(true);
    expect(d.outcome).toBe("PAGAR");
  });

  it("sin destinatario (común en correos y chats) no penaliza y la explicación no lo menciona", () => {
    for (const input of [engineInput(acmeInvoice()), billed(null, null), billed("N/A", "—")]) {
      const { d, acu1: c } = acu1(input);
      expect(c.status).toBe("pass");
      expect(c.explanation).not.toContain("dirigida");
      expect(c.params.billToMatches).toBeUndefined();
      expect(d.outcome).toBe("PAGAR");
    }
  });
});

describe("ACU-1 · destinatario que NO corresponde a la empresa", () => {
  it("otro nombre: escala con la explicación concreta (LOG-11)", () => {
    const { d, acu1: c } = acu1(billed("Pampa Labs Colombia S.A.S.", "901.888.123-4"));
    expect(d.outcome).toBe("ESCALAR");
    expect(c.status).toBe("fail");
    expect(c.explanation).toBe("La factura está dirigida a Pampa Labs Colombia S.A.S. (901.888.123-4), no a Andes Labs Inc.");
    expect(c.params).toMatchObject({ billToMatches: false, billToStatus: "other_company", agreementId: "a-acme-mensual" });
    expect(d.checks.filter((x) => x.status !== "pass").map((x) => x.code)).toEqual(["ACU-1"]);
    expect(d.summary).toBe("Se escala a una persona: no cumple «Acuerdo vigente».");
    expect(d.humanAction).toBe(
      "Confirmar con el proveedor a qué empresa corresponde la factura: si es de otra empresa, no se paga; si es de Andes Labs Inc., pedir que la emita a su nombre (razón social e id tributario de Andes Labs Inc.).",
    );
  });

  it("muestra la etiqueta del id tal como la cita la lectura («NIT 901.888.123-4»)", () => {
    const input = billed("Pampa Labs Colombia S.A.S.", "901.888.123-4");
    const e = extractionFrom(input.reading.data!);
    e.billToTaxId = { value: "901.888.123-4", evidence: "NIT: 901.888.123-4", legible: true };
    const r = { ...input.reading, primary: { ...input.reading.primary, extraction: e } as typeof input.reading.primary };
    expect(acu1({ ...input, reading: r }).acu1.explanation).toBe(
      "La factura está dirigida a Pampa Labs Colombia S.A.S. (NIT 901.888.123-4), no a Andes Labs Inc.",
    );
  });

  it("un nombre parecido no basta («Andes Labs Colombia S.A.S.»)", () => {
    const { d, acu1: c } = acu1(billed("Andes Labs Colombia S.A.S."));
    expect(d.outcome).toBe("ESCALAR");
    expect(c.explanation).toBe("La factura está dirigida a Andes Labs Colombia S.A.S., no a Andes Labs Inc.");
  });

  it("el mismo nombre con otro EIN no corresponde", () => {
    const { d, acu1: c } = acu1(billed("Andes Labs Inc.", "93-4127756"));
    expect(d.outcome).toBe("ESCALAR");
    expect(c.status).toBe("fail");
    expect(c.explanation).toBe(
      "La factura está dirigida a Andes Labs Inc. (93-4127756), pero ese id tributario no es el de Andes Labs Inc. (93-4127765): puede ser otra empresa con el mismo nombre.",
    );
  });

  it("solo un id tributario que no es el de la empresa tampoco", () => {
    const { d, acu1: c } = acu1(billed(null, "901.888.123-4"));
    expect(d.outcome).toBe("ESCALAR");
    expect(c.explanation).toBe("La factura está dirigida a la empresa con id tributario 901.888.123-4, no a Andes Labs Inc.");
  });

  it("basta con que la segunda lectura diga otra empresa", () => {
    const input = engineInput(acmeInvoice());
    const second = { ...extractionFrom(acmeInvoice()), billToName: { value: "Pampa Labs Colombia S.A.S.", evidence: "Cliente Pampa Labs Colombia S.A.S.", legible: true } };
    const reading = { ...input.reading, secondary: { ok: true as const, readerId: "secondary", model: "test-2", promptVersion: "t1", extraction: second } };
    const { d, acu1: c } = acu1({ ...input, reading });
    expect(d.outcome).toBe("ESCALAR");
    expect(c.explanation).toBe("Según la segunda lectura, la factura está dirigida a Pampa Labs Colombia S.A.S., no a Andes Labs Inc.");
  });

  it("un destinatario que la lectura marca como ilegible no se da por bueno (sin evaluar → escala)", () => {
    const input = billed("Andes Labs Inc.");
    const e = extractionFrom(input.reading.data!);
    e.billToName = { value: "Andes Labs Inc.", evidence: "Andes L?bs", legible: false };
    const r = { ...input.reading, primary: { ...input.reading.primary, extraction: e } as typeof input.reading.primary };
    const { d, acu1: c } = acu1({ ...input, reading: r });
    expect(c.status).toBe("not_evaluable");
    expect(c.explanation).toBe("No se lee con claridad a quién va dirigida la factura («Andes Labs Inc.»); no se puede confirmar que sea Andes Labs Inc.");
    expect(d.outcome).toBe("ESCALAR");
  });

  it("si además el acuerdo no está vigente, dice las dos cosas", () => {
    const roble: InvoiceData = acmeInvoice({
      vendorName: "Imprenta Viejo Roble S.A.",
      vendorTaxId: "900.111.000-5",
      currency: "USD",
      subtotal: 900,
      total: 900,
      lineItems: [{ description: "Impresos", quantity: 1, unitPrice: null, amount: 900 }],
      accountNumber: "023100998811",
      bankName: "Banco de Occidente",
      routingOrSwift: "OCCICOBC",
      billToName: "Pampa Labs Colombia S.A.S.",
      billToTaxId: null,
    });
    const { acu1: c } = acu1(engineInput(roble), context({ buyer: BUYER, vendors: [ROBLE] }));
    expect(c.status).toBe("fail");
    expect(c.explanation).toMatch(/^La factura está dirigida a Pampa Labs Colombia S\.A\.S\., no a Andes Labs Inc\. Imprenta Viejo Roble S\.A\. no tiene un acuerdo vigente/);
  });

  it("con un proveedor no registrado también lo dice (no queda como consecuencia de PRV-1)", () => {
    const { d, acu1: c } = acu1(billed("Pampa Labs Colombia S.A.S.", null, { vendorName: "Otro Proveedor S.A.S.", vendorTaxId: "900.999.999-9" }));
    expect(check(d, "PRV-1").status).toBe("fail");
    expect(c.status).toBe("fail");
    expect(d.summary).toContain("«Acuerdo vigente»");
  });
});

describe("ACU-1 · empresa sin bloque «buyer» (la que guarda la base hoy)", () => {
  const plain = context();

  it("compara con el nombre de la empresa: otra empresa escala, la misma pasa", () => {
    expect(acu1(billed("Pampa Labs Colombia S.A.S.", "901.888.123-4"), plain).d.outcome).toBe("ESCALAR");
    expect(acu1(billed("Andes Labs Inc"), plain).d.outcome).toBe("PAGAR");
    expect(acu1(billed("Andes Labs"), plain).d.outcome).toBe("PAGAR");
    // Otra forma societaria es otra razón social, también sin bloque «buyer».
    expect(acu1(billed("Andes Labs LLC"), plain).d.outcome).toBe("ESCALAR");
  });

  it("sin ids registrados, el id del destinatario no se puede comparar: con el nombre correcto pasa, solo el id escala", () => {
    expect(acu1(billed("Andes Labs Inc.", "93-0000000"), plain).d.outcome).toBe("PAGAR");
    const { d, acu1: c } = acu1(billed(null, "93-4127765"), plain);
    expect(c.status).toBe("not_evaluable");
    expect(c.explanation).toBe("La factura está dirigida a la empresa con id tributario 93-4127765, pero la ficha de la empresa no tiene ids tributarios registrados con qué compararlo.");
    expect(d.outcome).toBe("ESCALAR");
  });

  it("identidad de la compradora: razones sociales, alias y nombre de la ficha; datos raros no rompen nada", () => {
    expect(buyerIdentity(company({ buyer: BUYER }))).toMatchObject({ displayName: "Andes Labs Inc.", taxIds: ["93-4127765"] });
    expect([...buyerIdentity(company({ buyer: BUYER })).nameKeys]).toEqual(["andes labs"]);
    const weird = { ...company(), name: "", buyer: { legalNames: [null, " "], taxIds: "x" } } as unknown as Company;
    expect(buyerIdentity(weird)).toEqual({ displayName: "la empresa", nameKeys: new Set(), forms: new Map(), taxIds: [] });
    // Formas registradas por nombre: la razón social («Inc.») y el alias sin forma.
    expect(buyerIdentity(company({ buyer: BUYER })).forms).toEqual(new Map([["andes labs", new Set(["inc", ""])]]));
    // Sin ningún nombre con qué comparar, un destinatario nunca corresponde: escala.
    expect(acu1(billed("Andes Labs Inc."), { ...plain, company: weird }).d.outcome).toBe("ESCALAR");
  });
});

// ───────────────────────── Revisión adversarial (18 oct) ─────────────────────────

type Field = { value: string | null; evidence: string | null; legible: boolean };
const NONE: Field = { value: null, evidence: null, legible: true };

/** Factura de Acme cuyas DOS lecturas traen el destinatario tal como se indica (valor, cita y legibilidad). */
function read(name: Field, taxId: Field = NONE): EngineInput {
  const data = acmeInvoice({ billToName: name.value, billToTaxId: taxId.value });
  const input = engineInput(data);
  const e = { ...extractionFrom(data), billToName: name, billToTaxId: taxId };
  const r = input.reading;
  return {
    ...input,
    reading: {
      ...r,
      primary: { ...r.primary, extraction: e } as typeof r.primary,
      secondary: { ...r.secondary, extraction: e } as typeof r.secondary,
    },
  };
}
const said = (value: string | null, evidence: string | null = value, legible = true): Field => ({ value, evidence, legible });

describe("ACU-1 · revisión adversarial: otra forma societaria es otra razón social", () => {
  it.each([
    ["S.A.S. (la filial colombiana)", "Andes Labs S.A.S.", null],
    ["LLC", "Andes Labs LLC", null],
    ["Ltda.", "Andes Labs Ltda.", null],
    ["S.A. de C.V.", "Andes Labs S.A. de C.V.", null],
    ["S.A.S. aunque traiga el EIN de la empresa", "Andes Labs S.A.S.", "93-4127765"],
  ])("%s → escala", (_what, name, taxId) => {
    const { d, acu1: c } = acu1(billed(name, taxId));
    expect(d.outcome).toBe("ESCALAR");
    expect(c.status).toBe("fail");
    expect(c.explanation).toBe(
      `La factura está dirigida a ${name}${taxId ? ` (${taxId})` : ""}, no a Andes Labs Inc.: tiene otra forma societaria y puede ser otra entidad (por ejemplo, una filial).`,
    );
    expect(c.params).toMatchObject({ billToMatches: false, billToStatus: "other_company" });
  });

  it("una lectura que omite la forma societaria no la esconde si su cita la trae", () => {
    const { d, acu1: c } = acu1(read(said("Andes Labs", "Cliente: Andes Labs S.A.S.")));
    expect(d.outcome).toBe("ESCALAR");
    expect(c.status).toBe("fail");
    expect(c.explanation).toBe(
      "La factura está dirigida a «Cliente: Andes Labs S.A.S.», no a Andes Labs Inc.: tiene otra forma societaria y puede ser otra entidad (por ejemplo, una filial).",
    );
  });
});

describe("ACU-1 · revisión adversarial: destinatario en otro alfabeto", () => {
  it.each([
    ["cirílico", "ООО Пампа Лабс"],
    ["letras cirílicas que se ven latinas («РАМРА»)", "РАМРА"],
    ["chino", "北京潘帕实验室有限公司"],
    ["griego", "Πάμπα Λαμπς ΑΕ"],
    ["ancho completo", "Ｐａｍｐａ Ｌａｂｓ"],
  ])("%s: no es «sin destinatario» → escala", (_what, name) => {
    const { d, acu1: c } = acu1(billed(name));
    expect(d.outcome).toBe("ESCALAR");
    expect(c.status).toBe("fail");
    expect(c.explanation).toBe(`La factura está dirigida a ${name}, no a Andes Labs Inc.`);
  });

  it("un id tributario escrito con dígitos de otro sistema tampoco es «sin destinatario»", () => {
    const { d, acu1: c } = acu1(billed(null, "٩٠١٨٨٨١٢٣"));
    expect(d.outcome).toBe("ESCALAR");
    expect(c.status).toBe("fail");
  });
});

describe("ACU-1 · revisión adversarial: intermediarios y destinatario ilegible", () => {
  it.each([
    ["otra empresa «c/o» la nuestra", said("Andes Labs Inc.", "Pampa Labs Colombia S.A.S. c/o Andes Labs Inc.")],
    ["la nuestra «c/o» otra empresa", said("Andes Labs Inc.", "Andes Labs Inc. c/o Pampa Labs Colombia S.A.S.")],
    ["«por cuenta de»", said("Andes Labs Inc.", "Facturar a: Andes Labs Inc. por cuenta de Pampa Labs")],
    ["«care of»", said("Andes Labs Inc.", "Bill to: Pampa Labs LLC, care of Andes Labs Inc.")],
    ["«aos cuidados de»", said("Andes Labs Inc.", "Tomador: Pampa Labs Ltda. aos cuidados de Andes Labs Inc.")],
  ])("%s: no se puede confirmar que sea la empresa → escala", (_what, name) => {
    const { d, acu1: c } = acu1(read(name));
    expect(d.outcome).toBe("ESCALAR");
    expect(c.status).toBe("not_evaluable");
    expect(c.explanation).toBe(
      `La factura nombra a otra empresa junto al destinatario («${name.evidence}»); no se puede confirmar que esté dirigida a Andes Labs Inc.`,
    );
  });

  it("la lectura dice que hay destinatario pero no se lee (sin valor ni cita) → escala", () => {
    const { d, acu1: c } = acu1(read(said(null, null, false)));
    expect(d.outcome).toBe("ESCALAR");
    expect(c.status).toBe("not_evaluable");
    expect(c.explanation).toBe("No se lee con claridad a quién va dirigida la factura; no se puede confirmar que sea Andes Labs Inc.");
  });
});

describe("ACU-1 · revisión adversarial: falsos positivos (se paga)", () => {
  it.each([
    ["cuenta de cobro «Señores ANDES LABS INC.»", said("ANDES LABS INC.", "Señores: ANDES LABS INC."), said("93-4127765", "NIT 93-4127765")],
    ["inglés «Bill to: Andes Labs, Inc.» con dirección", said("Andes Labs, Inc.", "Bill to: Andes Labs, Inc., 548 Market St, San Francisco, CA"), NONE],
    ["portugués «Tomador: Andes Labs Inc.»", said("Andes Labs Inc.", "Tomador: Andes Labs Inc."), said("93-4127765", "EIN 93-4127765")],
    ["el alias con la cita completa", said("Andes Labs", "Facturar a: Andes Labs Inc."), NONE],
    ["«a nombre de» no es un intermediario", said("Andes Labs Inc.", "Factura a nombre de Andes Labs Inc."), NONE],
    ["chat sin destinatario", NONE, NONE],
  ])("%s", (_what, name, taxId) => {
    const { d, acu1: c } = acu1(read(name, taxId));
    expect(c.status).toBe("pass");
    expect(d.outcome).toBe("PAGAR");
  });
});
