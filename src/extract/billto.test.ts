/**
 * Destinatario de la factura en la lectura (sin modelo): viaja en el formato de cable sin tipos unión,
 * se normaliza en los datos, cuenta como desacuerdo entre lecturas solo si las dos lo traen y su cita
 * se comprueba contra el texto del documento.
 */
import { describe, expect, it } from "vitest";
import { legalFormsAfter, splitLegalForm, stripTaxIdLabel } from "../core/normalize";
import type { Extraction } from "../core/schemas";
import { extractionOutputFormat } from "./anthropic-reader";
import { assessReadings, BILL_TO_DISAGREEMENT, billToDisagrees, compareReadings, findEvidenceNotFound, toInvoiceData } from "./assess";
import { field, makeDoc, makeExtraction, okResult, SAMPLE_INVOICE_TEXT } from "./test-utils";
import { extractionToWire, wireToExtraction, WireExtractionSchema } from "./wire";

const TEXT_WITH_CLIENT = `${SAMPLE_INVOICE_TEXT}\nFacturar a: Andes Labs Inc. — EIN 93-4127765`;

function billTo(name: string | null, taxId: string | null = null, evidence?: string): Pick<Extraction, "billToName" | "billToTaxId"> {
  return { billToName: field(name, evidence ?? name), billToTaxId: field(taxId) };
}

describe("formato de cable · destinatario", () => {
  it("billToName y billToTaxId son campos de cable como los demás (found/value/evidence/legible), sin tipos unión", () => {
    type Node = { type?: unknown; $ref?: string; properties?: Record<string, Node>; required?: string[] };
    const schema = extractionOutputFormat().schema as Node & { $defs?: Record<string, Node> };
    const resolve = (n: Node | undefined): Node | undefined => (n?.$ref ? schema.$defs?.[n.$ref.replace("#/$defs/", "")] : n);
    expect(schema.required).toEqual(expect.arrayContaining(["billToName", "billToTaxId"]));
    for (const key of ["billToName", "billToTaxId"]) {
      const p = resolve(schema.properties?.[key]);
      expect(p, key).toEqual(resolve(schema.properties?.vendorName));
      expect(p?.type, key).toBe("object");
      expect(Object.keys(p?.properties ?? {}).sort(), key).toEqual(["evidence", "found", "legible", "value"]);
      expect(JSON.stringify(p), key).not.toMatch(/anyOf|oneOf|null/);
    }
  });

  it("ida y vuelta, y found=false → dato ausente", () => {
    const e = makeExtraction(billTo("Andes Labs Inc.", "93-4127765", "Facturar a: Andes Labs Inc."));
    const back = wireToExtraction(WireExtractionSchema.parse(extractionToWire(e)));
    expect(back.ok && back.extraction.billToName).toEqual({ value: "Andes Labs Inc.", evidence: "Facturar a: Andes Labs Inc.", legible: true });
    expect(back.ok && back.extraction.billToTaxId).toEqual({ value: "93-4127765", evidence: "93-4127765", legible: true });

    const w = extractionToWire(e);
    w.billToName = { found: false, value: "Otra Empresa S.A.S.", evidence: "", legible: true };
    const r = wireToExtraction(w);
    expect(r.ok && r.extraction.billToName).toEqual({ value: null, evidence: null, legible: true });
  });

  it("una lectura guardada sin el destinatario (v4) se convierte al cable como ausente", () => {
    const old = makeExtraction();
    delete (old as Partial<Extraction>).billToName;
    delete (old as Partial<Extraction>).billToTaxId;
    expect(extractionToWire(old).billToName).toEqual({ found: false, value: "", evidence: "", legible: true });
  });
});

describe("datos y comparación de lecturas · destinatario", () => {
  it("los datos llevan el destinatario sin rellenos («N/A» = ausente)", () => {
    expect(toInvoiceData(makeExtraction(billTo(" Andes Labs Inc. ", "EIN 93-4127765")))).toMatchObject({ billToName: "Andes Labs Inc.", billToTaxId: "EIN 93-4127765" });
    expect(toInvoiceData(makeExtraction(billTo("N/A", "—")))).toMatchObject({ billToName: null, billToTaxId: null });
    // Un nombre en otro alfabeto no es un relleno: para el destinatario, «ausente» es lo que deja pagar.
    for (const name of ["ООО Пампа Лабс", "北京潘帕实验室有限公司", "Πάμπα Λαμπς ΑΕ", "Ｐａｍｐａ Ｌａｂｓ"]) {
      expect(toInvoiceData(makeExtraction(billTo(name, "٩٠١٨٨٨١٢٣")))).toMatchObject({ billToName: name, billToTaxId: "٩٠١٨٨٨١٢٣" });
    }
    expect(billToDisagrees(makeExtraction(billTo("ООО Пампа Лабс")), makeExtraction(billTo("Andes Labs Inc.")))).toBe(true);
    expect(billToDisagrees(makeExtraction(billTo("ООО Пампа Лабс")), makeExtraction(billTo("ООО  ПАМПА ЛАБС")))).toBe(false);
    const old = makeExtraction();
    delete (old as Partial<Extraction>).billToName;
    expect(toInvoiceData(old).billToName).toBeNull();
  });

  it("LEC-2: desacuerdo solo si las dos lecturas traen destinatario y no coinciden", () => {
    const a = makeExtraction(billTo("Andes Labs Inc.", "93-4127765"));
    expect(billToDisagrees(a, makeExtraction(billTo("ANDES LABS, INC.", "EIN 93-4127765")))).toBe(false);
    // Sin forma societaria no contradice a la que la trae; otra forma societaria sí (otra razón social).
    expect(billToDisagrees(a, makeExtraction(billTo("Andes Labs")))).toBe(false);
    expect(billToDisagrees(a, makeExtraction(billTo("ANDES LABS, LLC", "EIN 93-4127765")))).toBe(true);
    expect(billToDisagrees(a, makeExtraction(billTo(null)))).toBe(false);
    expect(billToDisagrees(a, makeExtraction())).toBe(false);
    expect(billToDisagrees(a, makeExtraction(billTo("Pampa Labs Colombia S.A.S.")))).toBe(true);
    expect(billToDisagrees(a, makeExtraction(billTo(null, "93-4127756")))).toBe(true);
    expect(compareReadings(okResult(a), okResult(makeExtraction(billTo("Pampa Labs Colombia S.A.S."))))).toEqual([BILL_TO_DISAGREEMENT]);
    expect(compareReadings(okResult(a), okResult(makeExtraction()))).toEqual([]);
  });
});

describe("cita del destinatario contra el texto", () => {
  const doc = makeDoc({ plainText: TEXT_WITH_CLIENT });

  it("si el texto lo dice (aunque sin la forma societaria o sin la etiqueta del id), está respaldado", () => {
    expect(findEvidenceNotFound(doc, makeExtraction(billTo("Andes Labs Inc.", "93-4127765")))).toEqual([]);
    expect(findEvidenceNotFound(doc, makeExtraction(billTo("ANDES LABS", "EIN 93-4127765")))).toEqual([]);
  });

  it("la forma societaria leída tiene que ser la del texto: «Andes Labs Inc.» no está respaldado si el texto dice «Andes Labs S.A.S.»", () => {
    expect(findEvidenceNotFound(doc, makeExtraction(billTo("ANDES LABS LLC", "EIN 93-4127765")))).toEqual(["billToName"]);
    const sas = makeDoc({ plainText: `${SAMPLE_INVOICE_TEXT}\nCliente: Andes Labs S.A.S.` });
    expect(findEvidenceNotFound(sas, makeExtraction(billTo("Andes Labs Inc.")))).toEqual(["billToName"]);
    expect(findEvidenceNotFound(sas, makeExtraction(billTo("Andes Labs Inc.", null, "Cliente: Andes Labs S.A.S.")))).toEqual(["billToName"]);
    expect(findEvidenceNotFound(sas, makeExtraction(billTo("Andes Labs S.A.S.")))).toEqual([]);
    // El texto sin forma societaria y la lectura con la de la empresa: el lector la agregó, se acepta.
    const plain = makeDoc({ plainText: `${SAMPLE_INVOICE_TEXT}\nSeñores: ANDES LABS` });
    expect(findEvidenceNotFound(plain, makeExtraction(billTo("Andes Labs Inc.")))).toEqual([]);
  });

  it("un destinatario en otro alfabeto que sí está en el texto está respaldado", () => {
    const ru = makeDoc({ plainText: `${SAMPLE_INVOICE_TEXT}\nКлиент: ООО Пампа Лабс` });
    expect(findEvidenceNotFound(ru, makeExtraction(billTo("ООО Пампа Лабс")))).toEqual([]);
    expect(findEvidenceNotFound(makeDoc(), makeExtraction(billTo("ООО Пампа Лабс")))).toEqual(["billToName"]);
  });

  it("si una lectura dice un destinatario que no está en el texto, no se le cree", () => {
    const e = makeExtraction(billTo("Andes Labs Inc.", "93-4127765"));
    expect(findEvidenceNotFound(makeDoc(), e)).toEqual(["billToName", "billToTaxId"]);
    const s = assessReadings(makeDoc(), okResult(e), okResult(e)).signals;
    expect(s.evidenceNotFound).toEqual(["billToName", "billToTaxId"]);
  });

  it("sin destinatario no hay nada que comprobar; en una imagen no se comprueba", () => {
    expect(findEvidenceNotFound(makeDoc(), makeExtraction())).toEqual([]);
    const image = makeDoc({ kind: "image", plainText: null, parts: [{ type: "image", mediaType: "image/png", base64: "UE5H" }] });
    expect(findEvidenceNotFound(image, makeExtraction(billTo("Andes Labs Inc.")))).toEqual([]);
  });
});

describe("stripTaxIdLabel", () => {
  it("quita la etiqueta inicial y deja el resto tal cual", () => {
    expect(stripTaxIdLabel("EIN 93-4127765")).toBe("93-4127765");
    expect(stripTaxIdLabel(" NIT: 901.888.123-4 ")).toBe("901.888.123-4");
    expect(stripTaxIdLabel("Tax ID #93-4127765")).toBe("93-4127765");
    expect(stripTaxIdLabel("C.C. 1.020.304")).toBe("1.020.304");
    expect(stripTaxIdLabel("RFC ENO210415AB3")).toBe("ENO210415AB3");
    // Sin etiqueta, una etiqueta pegada al número o sin número después: igual.
    expect(stripTaxIdLabel("93-4127765")).toBe("93-4127765");
    expect(stripTaxIdLabel("ENO210415AB3")).toBe("ENO210415AB3");
    expect(stripTaxIdLabel("NIT")).toBe("NIT");
  });
});

describe("splitLegalForm y legalFormsAfter (razón social con su forma societaria)", () => {
  it("separa el nombre de la forma societaria final, canónica", () => {
    expect(splitLegalForm("Andes Labs Inc.")).toEqual({ base: "andes labs", form: "inc" });
    expect(splitLegalForm("ANDES LABS, INC")).toEqual({ base: "andes labs", form: "inc" });
    expect(splitLegalForm("Andes Labs Incorporated")).toEqual({ base: "andes labs", form: "inc" });
    expect(splitLegalForm("Andes Labs")).toEqual({ base: "andes labs", form: "" });
    expect(splitLegalForm("Andes Labs S.A.S.")).toEqual({ base: "andes labs", form: "sas" });
    expect(splitLegalForm("Grupo Nopalli S.A. de C.V.")).toEqual({ base: "grupo nopalli", form: "sadecv" });
    expect(splitLegalForm("Andes Labs GmbH")).toEqual({ base: "andes labs", form: "gmbh" });
    expect(splitLegalForm("ООО Пампа Лабс")).toBeNull();
    expect(splitLegalForm("Inc.")).toEqual({ base: "inc", form: "" });
  });

  it("lee la forma que sigue a cada aparición del nombre en un texto", () => {
    expect(legalFormsAfter("Cliente: Andes Labs S.A.S. — NIT 901", "andes labs")).toEqual(["sas"]);
    expect(legalFormsAfter("Bill to: Andes Labs, Inc., 548 Market St", "andes labs")).toEqual(["inc"]);
    expect(legalFormsAfter("Señores ANDES LABS\nNIT 93-4127765", "andes labs")).toEqual([""]);
    expect(legalFormsAfter("Andes Labs Inc. / Andes Labs Ltda.", "andes labs")).toEqual(["inc", "ltda"]);
    expect(legalFormsAfter("Pampa Labs S.A.S.", "andes labs")).toEqual([]);
    expect(legalFormsAfter(null, "andes labs")).toEqual([]);
  });
});
