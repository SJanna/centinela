/**
 * Pruebas de revisión: bordes y garantías que las demás pruebas no cubrían.
 * - El total «ilegible» (blurTotal) no puede quedar legible en otra parte del documento.
 * - El texto oculto de H10 es realmente invisible (blanco, diminuto, sobre fondo blanco).
 * - Lo que hay en dataset/generated/ es lo que generan las specs actuales.
 * - Las specs no aceptan montos ni fechas que el documento no puede mostrar tal cual.
 * - Las notas del lector solo dicen lo que se ve en el documento.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { simpleParser } from "mailparser";
import { getDocumentProxy } from "unpdf";
import { beforeAll, describe, expect, it } from "vitest";
import { normalizeName, normalizeTaxId } from "../../src/core/normalize";
import type { ManifestEntry } from "../../src/core/ports";
import { toManifest, type GeneratedCase } from "./build";
import { readCompany } from "./cases";
import { amountInWords, currencyDecimals, formatNumber } from "./format";
import { textWidth, type TextOp } from "./layout";
import { buildEml } from "./render/email";
import { renderPng } from "./render/image";
import { datasetDir, isDocumentSpec, loadSpecs, parseSpec, TEMPLATES, type DocumentSpec } from "./spec";
import { renderTemplate } from "./templates";
import { generatedCases } from "./test-helpers";

const specs = loadSpecs();
const byId = new Map(specs.map((s) => [s.id, s]));
const doc = (id: string): DocumentSpec => {
  const s = byId.get(id);
  if (!s || !isDocumentSpec(s)) throw new Error(`${id} no es un documento completo`);
  return s;
};

let cases: GeneratedCase[];
beforeAll(async () => {
  cases = await generatedCases();
});

describe("total ilegible (blurTotal)", () => {
  /** Variantes de B17 con impuesto (total ≠ subtotal) para poder buscar el total en el texto. */
  const variants: Array<{ name: string; patch: Partial<DocumentSpec> }> = [
    {
      name: "USD con impuesto",
      patch: {
        subtotal: 1800,
        tax: { label: "IVA 19 %", amount: 342 },
        total: 2142,
      },
    },
    {
      name: "COP con impuesto",
      patch: {
        currency: "COP",
        locale: "es-CO",
        lines: [{ description: "Desarrollo backend", detail: null, quantity: 1, unit: null, unitPrice: 12000000, amount: 12000000 }],
        subtotal: 12000000,
        tax: { label: "IVA 19 %", amount: 2280000 },
        total: 14280000,
      },
    },
  ];

  for (const template of TEMPLATES) {
    for (const { name, patch } of variants) {
      it(`plantilla ${template} (${name}): ningún texto sin desenfocar deja leer el total`, () => {
        const spec = parseSpec({ ...doc("B17"), ...patch, template, blurTotal: true }) as DocumentSpec;
        const page = renderTemplate(spec, template).page();
        const texts = page.ops.filter((op): op is TextOp => op.kind === "text");
        expect(texts.some((t) => t.tags.includes("total")), "debe haber al menos un total desenfocado").toBe(true);
        const digits = formatNumber(spec.total, spec.locale, currencyDecimals(spec.currency));
        const words = amountInWords(spec.total, spec.currency);
        const leaks = texts
          .filter((t) => !t.tags.includes("total"))
          .filter((t) => t.text.includes(digits) || (words != null && t.text.includes(words)))
          .map((t) => t.text);
        expect(leaks).toEqual([]);
      });
    }
  }
});

describe("texto oculto (H10)", () => {
  const spec = doc("H10");
  const hidden = spec.hiddenText!;

  it("se dibuja en blanco y de 1 pt", () => {
    const page = renderTemplate(spec, spec.template!).page();
    const ops = page.ops.filter((op): op is TextOp => op.kind === "text" && op.text.includes(hidden));
    expect(ops).toHaveLength(1);
    expect(ops[0].color.toUpperCase()).toBe("#FFFFFF");
    expect(ops[0].size).toBeLessThanOrEqual(1.5);
  });

  it("no se ve: la zona donde está queda blanca al dibujar la página", async () => {
    const page = renderTemplate(spec, spec.template!).page();
    const op = page.ops.find((o): o is TextOp => o.kind === "text" && o.text === hidden)!;
    const scale = 4;
    const png = await renderPng(page, scale);
    const w = textWidth(op.text, op.font, op.size);
    const left = Math.floor(op.x * scale) - 2;
    const top = Math.floor((op.y - op.size) * scale) - 2;
    const width = Math.ceil(w * scale) + 4;
    const height = Math.ceil(op.size * 1.4 * scale) + 4;
    const raw = await sharp(png).extract({ left, top, width, height }).removeAlpha().raw().toBuffer();
    expect(Math.min(...raw)).toBeGreaterThanOrEqual(250);
  });

  it("en el PDF generado el texto está en la capa de texto con tamaño diminuto", async () => {
    const h10 = cases.find((c) => c.caseId === "H10")!;
    const pdf = await getDocumentProxy(new Uint8Array(h10.bytes));
    const content = await (await pdf.getPage(1)).getTextContent();
    const items = content.items.filter((i): i is (typeof content.items)[number] & { str: string; transform: number[] } => "str" in i && i.str.includes("SYSTEM"));
    expect(items).toHaveLength(1);
    expect(Math.hypot(items[0].transform[0], items[0].transform[1])).toBeLessThanOrEqual(1.5);
  });
});

describe("dataset/generated/ está al día con las specs", () => {
  const outDir = path.join(datasetDir(), "generated");
  const isImage = (mediaType: string) => mediaType.startsWith("image/");

  it("el manifiesto en disco coincide con lo que generan las specs (lecturas, archivos y huellas)", () => {
    const onDisk = JSON.parse(fs.readFileSync(path.join(outDir, "manifest.json"), "utf8")) as ManifestEntry[];
    const fresh = toManifest(cases);
    expect(onDisk.map((e) => e.caseId)).toEqual(fresh.map((e) => e.caseId));
    for (const [i, entry] of onDisk.entries()) {
      const expected = fresh[i];
      expect(entry.file, entry.caseId).toBe(expected.file);
      expect(entry.mediaType, entry.caseId).toBe(expected.mediaType);
      expect(entry.groundTruth, entry.caseId).toEqual(expected.groundTruth);
      // Las imágenes dependen de las fuentes del sistema (librsvg): solo se comparan en la misma máquina.
      if (!isImage(entry.mediaType)) expect(entry.sha256, `${entry.caseId}: regenera con npm run dataset:generate`).toBe(expected.sha256);
    }
  });

  it("si dos casos comparten huella (B07 = B02), comparten también la lectura: el lector simulado busca por huella", () => {
    const byHash = new Map<string, GeneratedCase[]>();
    for (const c of cases) byHash.set(c.sha256, [...(byHash.get(c.sha256) ?? []), c]);
    for (const group of byHash.values()) {
      for (const c of group.slice(1)) expect(c.groundTruth, `${c.caseId} vs ${group[0].caseId}`).toEqual(group[0].groundTruth);
    }
  });

  it("cada archivo en disco tiene la huella que dice el manifiesto y no sobran archivos", () => {
    const onDisk = JSON.parse(fs.readFileSync(path.join(outDir, "manifest.json"), "utf8")) as ManifestEntry[];
    for (const entry of onDisk) {
      const bytes = fs.readFileSync(path.join(outDir, entry.file));
      expect(crypto.createHash("sha256").update(bytes).digest("hex"), entry.caseId).toBe(entry.sha256);
    }
    const files = fs.readdirSync(outDir).filter((f) => !f.startsWith(".")).sort();
    expect(files).toEqual([...onDisk.map((e) => e.file), "manifest.json"].sort());
  });
});

describe("las specs solo aceptan lo que el documento puede mostrar tal cual", () => {
  const b01 = doc("B01");
  const b13 = doc("B13");

  it("rechaza montos con más decimales de los que se imprimen (COP sin centavos, el resto con 2)", () => {
    expect(() => parseSpec({ ...b01, subtotal: 12000000.4, total: 12000000.4, lines: [{ ...b01.lines[0], unitPrice: 12000000.4, amount: 12000000.4 }] })).toThrow(/decimales/);
    expect(() => parseSpec({ ...b01, lines: [{ ...b01.lines[0], amount: 12000000.5 }] })).toThrow(/decimales/);
    expect(() => parseSpec({ ...b13, total: 4125.005 })).toThrow(/decimales/);
    expect(() => parseSpec({ ...b13, lines: [{ ...b13.lines[0], quantity: 55.555 }] })).toThrow(/decimales/);
    expect(() => parseSpec({ ...b13, tax: { label: "IVA", amount: 0.001 } })).toThrow(/decimales/);
    // Lo representable sigue pasando.
    expect(() => parseSpec({ ...b13, lines: [{ ...b13.lines[0], quantity: 55.5, amount: 4162.5 }], subtotal: 4162.5, total: 4162.5 })).not.toThrow();
  });

  it("rechaza fechas que no existen en el calendario", () => {
    expect(() => parseSpec({ ...b01, issueDate: "2026-02-30" })).toThrow(/fecha/);
    expect(() => parseSpec({ ...b01, dueDate: "2026-13-01" })).toThrow(/fecha/);
    expect(() => parseSpec({ ...b01, servicePeriod: "2026-00" })).toThrow(/periodo/);
  });

  it("una copia o una foto debe ser del mismo proveedor que el documento original", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "centinela-specs-"));
    try {
      const b02 = doc("B02");
      fs.writeFileSync(path.join(dir, "B02.json"), JSON.stringify(b02));
      fs.writeFileSync(path.join(dir, "B07.json"), JSON.stringify({ id: "B07", about: "copia", vendorId: "v-camila", format: "pdf", copyOf: "B02" }));
      expect(() => loadSpecs(dir)).toThrow(/proveedor/);
      fs.writeFileSync(path.join(dir, "B07.json"), JSON.stringify({ id: "B07", about: "copia", vendorId: b02.vendorId, format: "pdf", copyOf: "B02" }));
      expect(() => loadSpecs(dir)).not.toThrow();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("bordes de formato", () => {
  it("el monto en letras no da «100/100» por redondeo de centavos", () => {
    expect(amountInWords(1.999, "USD")).toBe("DOS DÓLARES ESTADOUNIDENSES CON 00/100");
    expect(amountInWords(9499.996, "BRL")).toBe("NUEVE MIL QUINIENTOS REALES CON 00/100");
    expect(amountInWords(1218.5, "USD")).toBe("MIL DOSCIENTOS DIECIOCHO DÓLARES ESTADOUNIDENSES CON 50/100");
  });

  it("los remitentes con coma en el nombre entre comillas no se parten en dos direcciones", async () => {
    const eml = buildEml(
      {
        from: '"Restrepo, Camila" <camila@crdev.co>',
        to: '"Pérez, Ana" <ana@andeslabs.dev>, Pagos <pagos@andeslabs.dev>',
        cc: null,
        subject: "Prueba",
        date: "Wed, 07 Oct 2026 09:14:22 -0300",
        messageId: "<x@crdev.co>",
        body: ["Hola"],
      },
      null,
    );
    const mail = await simpleParser(eml);
    expect(mail.from?.value).toEqual([{ address: "camila@crdev.co", name: "Restrepo, Camila" }]);
    const to = Array.isArray(mail.to) ? mail.to.flatMap((a) => a.value) : (mail.to?.value ?? []);
    expect(to).toEqual([
      { address: "ana@andeslabs.dev", name: "Pérez, Ana" },
      { address: "pagos@andeslabs.dev", name: "Pagos" },
    ]);
    // Cabeceras en ASCII puro (RFC 5322): los nombres no ASCII van codificados.
    const head = eml.toString("utf8").split("\r\n\r\n")[0];
    expect(/^[\x20-\x7E\r\n\t]*$/.test(head)).toBe(true);
  });
});

describe("lectura perfecta: solo lo que dice el documento", () => {
  it("las notas del lector no usan datos de fuera del documento (ficha de proveedores, otros casos, historial)", () => {
    const outside = /ficha|registrad|sin registro|segunda factura|mismo número y contenido|que el PDF|\b[BHMF]\d{2}\b/i;
    const leaks = cases.filter((c) => outside.test(c.groundTruth.readerNotes)).map((c) => `${c.caseId}: ${c.groundTruth.readerNotes}`);
    expect(leaks).toEqual([]);
  });

  it("los proveedores no registrados tampoco coinciden por identificación tributaria", () => {
    const company = readCompany();
    const taxIds = company.vendors.map((v) => normalizeTaxId(v.taxId));
    const names = company.vendors.flatMap((v) => [v.name, ...v.aliases]).map(normalizeName);
    for (const id of ["B09", "H06"]) {
      const spec = doc(id);
      expect(taxIds, id).not.toContain(normalizeTaxId(spec.vendor.taxId));
      expect(names, id).not.toContain(normalizeName(spec.payment?.beneficiaryName));
    }
  });
});
