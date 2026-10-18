/**
 * Guardia · destinatario de la factura. Con su propia lógica (no usa el motor ni src/core/normalize):
 * si alguna lectura dice a quién va dirigida la factura y no es la empresa compradora, no aprueba el pago.
 */
import { describe, expect, it } from "vitest";
import type { Company, EngineInput, Extraction } from "../core/schemas";
import { guardPayment } from "./index";
import { guardBillToTaxId, sameTaxId } from "./normalize";
import { camilaDecision, camilaOctober, COMPANY, makeCtx, makeDecision, makeInput } from "./test-fixtures";

const BUYER: NonNullable<Company["buyer"]> = { legalNames: ["Andes Labs Inc."], aliases: ["Andes Labs"], taxIds: ["93-4127765"] };
const ctx = makeCtx({ company: { ...COMPANY, buyer: BUYER } });

type Field = NonNullable<Extraction["billToName"]>;
const f = (value: string | null, legible = true): Field => ({ value, evidence: value, legible });

/** La factura de Camila de octubre (que la guardia aprueba) con el destinatario en las lecturas indicadas. */
function billed(name: string | null, taxId: string | null, opts: { only?: "principal" | "secundario"; legible?: boolean } = {}): EngineInput {
  const input = makeInput(camilaOctober());
  const r = input.reading;
  const add = (x: typeof r.primary, who: "principal" | "secundario") =>
    x.ok && (opts.only == null || opts.only === who)
      ? { ...x, extraction: { ...x.extraction, billToName: f(name, opts.legible ?? true), billToTaxId: f(taxId, opts.legible ?? true) } }
      : x;
  const primary = add(r.primary, "principal");
  return {
    ...input,
    reading: {
      ...r,
      primary,
      secondary: r.secondary ? add(r.secondary, "secundario") : null,
      data: opts.only === "secundario" ? r.data : { ...r.data!, billToName: name, billToTaxId: taxId },
    },
  };
}

function guard(input: EngineInput, context = ctx) {
  return guardPayment(input, context, makeDecision(input, camilaDecision));
}

describe("guardia · destinatario que corresponde a la empresa", () => {
  it.each([
    ["sin destinatario (no penaliza)", null, null],
    ["el nombre registrado con su EIN", "Andes Labs Inc.", "93-4127765"],
    ["el nombre con la forma escrita completa", "Andes Labs Incorporated", null],
    ["el nombre en mayúsculas, con coma", "ANDES LABS, INC.", "934127765"],
    ["el alias", "Andes Labs", null],
    ["el EIN con etiqueta", "Andes Labs Inc.", "EIN: 93-4127765"],
    ["solo el EIN", null, "93-4127765"],
    ["rellenos en vez de vacío", "N/A", "—"],
  ])("%s → aprueba", (_what, name, taxId) => {
    expect(guard(billed(name, taxId))).toEqual({ approved: true, violations: [] });
  });
});

describe("guardia · destinatario que NO corresponde a la empresa", () => {
  it("otro nombre y otro NIT (LOG-11)", () => {
    expect(guard(billed("Pampa Labs Colombia S.A.S.", "NIT 901.888.123-4"))).toEqual({
      approved: false,
      violations: [
        "la factura está dirigida a «Pampa Labs Colombia S.A.S.», no a Andes Labs Inc.",
        "la factura está dirigida al id tributario NIT 901.888.123-4, que no es el de Andes Labs Inc.",
      ],
    });
  });

  it("el mismo nombre con otro EIN", () => {
    expect(guard(billed("Andes Labs Inc.", "93-4127756"))).toEqual({
      approved: false,
      violations: ["la factura está dirigida al id tributario 93-4127756, que no es el de Andes Labs Inc."],
    });
  });

  it("un nombre parecido («Andes Labs Colombia S.A.S.»)", () => {
    expect(guard(billed("Andes Labs Colombia S.A.S.", null)).violations).toEqual([
      "la factura está dirigida a «Andes Labs Colombia S.A.S.», no a Andes Labs Inc.",
    ]);
  });

  it("basta con que lo diga la segunda lectura", () => {
    const r = guard(billed("Pampa Labs Colombia S.A.S.", null, { only: "secundario" }));
    expect(r.approved).toBe(false);
    expect(r.violations).toEqual(["la factura está dirigida a «Pampa Labs Colombia S.A.S.», no a Andes Labs Inc."]);
  });

  it("un destinatario marcado como ilegible no se aprueba", () => {
    expect(guard(billed("Andes Labs Inc.", null, { legible: false })).violations).toEqual([
      "no se lee con claridad a quién va dirigida la factura",
    ]);
  });

  it("un id tributario con caracteres raros no se aprueba", () => {
    expect(guard(billed("Andes Labs Inc.", "93-4127765​")).violations).toEqual([
      "el id tributario del destinatario no es válido (93-4127765​)",
    ]);
  });
});

describe("guardia · empresa sin bloque «buyer» (la que guarda la base hoy)", () => {
  const plain = makeCtx();

  it("compara con el nombre de la empresa", () => {
    expect(guard(billed("Andes Labs Inc", "93-0000000"), plain).approved).toBe(true);
    expect(guard(billed("Andes Labs LLC", null), plain).approved).toBe(false);
    expect(guard(billed("Pampa Labs Colombia S.A.S.", null), plain).violations).toEqual([
      "la factura está dirigida a «Pampa Labs Colombia S.A.S.», no a Andes Labs Inc.",
    ]);
  });

  it("solo un id tributario, sin ids registrados con qué compararlo: no aprueba", () => {
    expect(guard(billed(null, "93-4127765"), plain).violations).toEqual([
      "la factura está dirigida al id tributario 93-4127765 y la ficha de la empresa no tiene ids tributarios con qué compararlo",
    ]);
  });
});

describe("guardBillToTaxId", () => {
  it("quita la etiqueta inicial solo si después queda un número", () => {
    const ein = guardBillToTaxId("93-4127765")!;
    for (const raw of ["EIN 93-4127765", "EIN: 93-4127765", "ein 93 4127765", "Tax ID: 93-4127765", "93.412.7765"]) {
      expect(sameTaxId(guardBillToTaxId(raw)!, ein), raw).toBe(true);
    }
    expect(guardBillToTaxId("NIT: 901.888.123-4")).toEqual({ full: "9018881234", base: "901888123" });
    expect(guardBillToTaxId("RUT")).toEqual({ full: "RUT", base: null });
    expect(guardBillToTaxId("93-4127765​")).toBeNull();
  });
});

// ───────────────────────── Revisión adversarial (18 oct) ─────────────────────────

/** La factura de Camila con las DOS lecturas trayendo el destinatario tal como se indica (valor, cita, legibilidad). */
function read(name: Field, taxId: Field = { value: null, evidence: null, legible: true }): EngineInput {
  const input = makeInput(camilaOctober());
  const r = input.reading;
  const add = (x: typeof r.primary) => (x.ok ? { ...x, extraction: { ...x.extraction, billToName: name, billToTaxId: taxId } } : x);
  return {
    ...input,
    reading: { ...r, primary: add(r.primary), secondary: r.secondary ? add(r.secondary) : null, data: { ...r.data!, billToName: name.value, billToTaxId: taxId.value } },
  };
}
const said = (value: string | null, evidence: string | null = value, legible = true): Field => ({ value, evidence, legible });

describe("guardia · revisión adversarial: rechaza por su cuenta", () => {
  it.each([
    ["otra forma societaria (S.A.S.)", "Andes Labs S.A.S.", null],
    ["otra forma societaria (LLC)", "Andes Labs LLC", null],
    ["otra forma societaria aunque traiga el EIN de la empresa", "Andes Labs S.A.S.", "93-4127765"],
    ["nombre en cirílico", "ООО Пампа Лабс", null],
    ["letras cirílicas que se ven latinas", "РАМРА", null],
    ["nombre en chino", "北京潘帕实验室有限公司", null],
    ["nombre en griego", "Πάμπα Λαμπς ΑΕ", null],
    ["letras de ancho completo", "Ｐａｍｐａ Ｌａｂｓ", null],
    ["id con dígitos de otro sistema", null, "٩٠١٨٨٨١٢٣"],
  ])("%s", (_what, name, taxId) => {
    expect(guard(billed(name, taxId)).approved).toBe(false);
  });

  it("una lectura que omite la forma societaria pero la cita (Andes Labs S.A.S.)", () => {
    expect(guard(read(said("Andes Labs", "Cliente: Andes Labs S.A.S."))).violations).toEqual([
      "la cita del destinatario («Cliente: Andes Labs S.A.S.») lo muestra con otra forma societaria: no es Andes Labs Inc.",
    ]);
  });

  it.each([
    ["Pampa Labs Colombia S.A.S. c/o Andes Labs Inc."],
    ["Andes Labs Inc. c/o Pampa Labs Colombia S.A.S."],
    ["Facturar a: Andes Labs Inc. por cuenta de Pampa Labs"],
    ["Bill to: Pampa Labs LLC, care of Andes Labs Inc."],
    ["Tomador: Pampa Labs Ltda. aos cuidados de Andes Labs Inc."],
  ])("un tercero junto al destinatario: «%s»", (evidence) => {
    const r = guard(read(said("Andes Labs Inc.", evidence)));
    expect(r.approved).toBe(false);
    expect(r.violations[0]).toBe(`la factura nombra a otra empresa junto al destinatario («${evidence}»)`);
  });

  it("la lectura dice que hay destinatario pero no se lee (sin valor ni cita)", () => {
    expect(guard(read(said(null, null, false))).violations).toEqual(["no se lee con claridad a quién va dirigida la factura"]);
  });

  it("los mismos rellenos que el motor cuentan como sin destinatario («Unknown», «No especificado»)", () => {
    expect(guard(billed("Unknown", "No especificado"))).toEqual({ approved: true, violations: [] });
  });
});

describe("guardia · revisión adversarial: falsos positivos (aprueba)", () => {
  it.each([
    ["Señores ANDES LABS INC.", said("ANDES LABS INC.", "Señores: ANDES LABS INC."), said("93-4127765", "NIT 93-4127765")],
    ["Bill to: Andes Labs, Inc. con dirección", said("Andes Labs, Inc.", "Bill to: Andes Labs, Inc., 548 Market St, San Francisco, CA"), said(null)],
    ["Tomador: Andes Labs Inc.", said("Andes Labs Inc.", "Tomador: Andes Labs Inc."), said("93-4127765", "EIN 93-4127765")],
    ["el alias con la cita completa", said("Andes Labs", "Facturar a: Andes Labs Inc."), said(null)],
    ["«a nombre de» no es un intermediario", said("Andes Labs Inc.", "Factura a nombre de Andes Labs Inc."), said(null)],
  ])("%s", (_what, name, taxId) => {
    expect(guard(read(name, taxId))).toEqual({ approved: true, violations: [] });
  });
});
