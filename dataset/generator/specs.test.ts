import { describe, expect, it } from "vitest";
import { normalizeName } from "../../src/core/normalize";
import { readCases, readCompany } from "./cases";
import { buildExtension, isExtensionId, specJson } from "./base-extension";
import { documentOf, isCopySpec, isDocumentSpec, isPhotoOfSpec, loadSpecs, parseSpec } from "./spec";

const specs = loadSpecs();
const rows = readCases();
const company = readCompany();
const byId = new Map(specs.map((s) => [s.id, s]));

describe("specs del dataset", () => {
  it("hay exactamente una spec por cada fila de casos.csv", () => {
    expect(rows).toHaveLength(138);
    expect(specs.map((s) => s.id).sort()).toEqual(rows.map((r) => r.id).sort());
  });

  it("formato, proveedor y descripción coinciden con casos.csv", () => {
    for (const row of rows) {
      const spec = byId.get(row.id)!;
      expect(spec.format, row.id).toBe(row.formato);
      expect(spec.vendorId ?? "", row.id).toBe(row.proveedor);
      expect(spec.about, row.id).toBe(row.descripcion);
    }
  });

  it("copias exactas: B07 (de B02), B79 (de B78) y B120 (de B01); fotos de otro caso: H03 (de H01), B97 (de B98) y B115 (de B114)", () => {
    const copies = specs.filter(isCopySpec).map((s) => [s.id, s.copyOf]).sort();
    const photos = specs.filter(isPhotoOfSpec).map((s) => [s.id, s.photoOf]).sort();
    expect(copies).toEqual([["B07", "B02"], ["B120", "B01"], ["B79", "B78"]]);
    expect(photos).toEqual([["B115", "B114"], ["B97", "B98"], ["H03", "H01"]]);
  });

  it("B01–B23 y los demás escenarios: fechas de emisión de octubre de 2026, anteriores al 2026-10-20", () => {
    for (const spec of specs.filter(isDocumentSpec).filter((s) => !isExtensionId(s.id))) {
      expect(spec.issueDate >= "2026-10-01" && spec.issueDate < "2026-10-20", spec.id).toBe(true);
      expect(spec.servicePeriod, spec.id).toBe("2026-10");
      if (spec.dueDate) expect(spec.dueDate >= spec.issueDate, spec.id).toBe(true);
      expect(spec.customer.name, spec.id).toBe(company.name);
    }
  });

  it("B24 en adelante: emitidas entre julio y el 16 de octubre de 2026, con el periodo escrito y del mes de emisión o anterior", () => {
    const ext = specs.filter(isDocumentSpec).filter((s) => isExtensionId(s.id));
    expect(ext.length).toBeGreaterThan(80);
    for (const spec of ext) {
      // La pantalla decide con el reloj de la máquina: ninguna fecha pasa del día de las existentes.
      expect(spec.issueDate >= "2026-07-01" && spec.issueDate <= "2026-10-16", spec.id).toBe(true);
      if (spec.dueDate) expect(spec.dueDate >= spec.issueDate, spec.id).toBe(true);
      const vendor = company.vendors.find((v) => v.id === spec.vendorId);
      const once = vendor?.agreements[0].frequency === "once";
      if (once) continue;
      expect(spec.servicePeriod, spec.id).not.toBeNull();
      // Un mes facturado posterior al de emisión solo en la proforma (B88), emitida antes del mes.
      if (spec.id !== "B88") expect(spec.servicePeriod! <= spec.issueDate.slice(0, 7), spec.id).toBe(true);
    }
  });

  it("las specs de B24 en adelante son las que arma dataset/generator/base-extension.ts (npm run dataset:extend)", () => {
    const { specs: built, rows: builtRows } = buildExtension(company);
    for (const s of built) expect(specJson(byId.get(s.id)!), s.id).toBe(specJson(s));
    expect(rows.filter((r) => isExtensionId(r.id)).map((r) => [r.id, r.formato, r.proveedor, r.descripcion, r.decision_esperada, r.codigos_esperados.join(";")])).toEqual(
      builtRows.map((r) => [r.id, r.formato, r.proveedor, r.descripcion, r.decision_esperada, r.codigos_esperados.join(";")]),
    );
    // En casos.csv van justo después de B23, en orden.
    const ids = rows.map((r) => r.id);
    expect(ids.slice(ids.indexOf("B23") + 1, ids.indexOf("B23") + 1 + built.length)).toEqual(built.map((s) => s.id));
  });

  it("los números de factura son únicos salvo los duplicados a propósito", () => {
    const groups = new Map<string, string[]>();
    for (const spec of specs) {
      const n = documentOf(spec, byId).invoiceNumber.toUpperCase().replace(/[^A-Z0-9]/g, "");
      groups.set(n, [...(groups.get(n) ?? []), spec.id]);
    }
    const repeated = [...groups.values()].filter((ids) => ids.length > 1).map((ids) => ids.sort());
    expect(repeated.sort()).toEqual(
      [
        ["B02", "B07", "B08"],
        ["H01", "H03"],
        // Copia exacta de B01 (B120).
        ["B01", "B120"],
        // Copia exacta de B78 (B79).
        ["B78", "B79"],
        // FV-2026-1010 (B89) escrito «FV 2026/1010» en un recordatorio (B90).
        ["B89", "B90"],
        // Foto muy borrosa (B97) del mismo documento que B98.
        ["B97", "B98"],
        // El CFDI AJ-0412 en PDF (B101) y en el cuerpo de un correo (B102).
        ["B101", "B102"],
        // El chat con «$ 3.200» (B107) y la factura E en PDF con el mismo número (B108).
        ["B107", "B108"],
        // Foto impresa de B114.
        ["B114", "B115"],
      ].sort(),
    );
  });

  it("los proveedores registrados se llaman como en la ficha (nombre o alias)", () => {
    for (const spec of specs.filter(isDocumentSpec)) {
      if (!spec.vendorId) continue;
      const vendor = company.vendors.find((v) => v.id === spec.vendorId);
      expect(vendor, spec.id).toBeDefined();
      const names = [vendor!.name, ...vendor!.aliases].map(normalizeName);
      expect(names, spec.id).toContain(normalizeName(spec.vendor.name));
      expect(spec.vendor.taxId, spec.id).toBe(vendor!.taxId);
    }
  });

  it("los proveedores no registrados (B09, H06, el impostor B86) no se llaman como ninguno de la ficha", () => {
    const known = company.vendors.flatMap((v) => [v.name, ...v.aliases]).map(normalizeName);
    for (const id of ["B09", "H06", "B86"]) {
      const spec = byId.get(id)!;
      expect(isDocumentSpec(spec) && spec.vendorId).toBe(null);
      if (isDocumentSpec(spec)) expect(known).not.toContain(normalizeName(spec.vendor.name));
    }
  });

  it("la aritmética de cada spec cuadra, salvo B18 (error a propósito)", () => {
    for (const spec of specs.filter(isDocumentSpec)) {
      const lines = spec.lines.reduce((s, l) => s + Math.round(l.amount * 100), 0);
      for (const l of spec.lines) {
        if (l.quantity != null && l.unitPrice != null) expect(Math.round(l.quantity * l.unitPrice * 100), `${spec.id} línea`).toBe(Math.round(l.amount * 100));
      }
      const tax = Math.round((spec.tax?.amount ?? 0) * 100);
      const sub = spec.subtotal == null ? lines : Math.round(spec.subtotal * 100);
      if (spec.subtotal != null) expect(sub, `${spec.id} subtotal`).toBe(lines);
      const ok = sub + tax === Math.round(spec.total * 100);
      expect(ok, `${spec.id} total`).toBe(spec.id !== "B18");
    }
  });

  it("parseSpec rechaza combinaciones incoherentes", () => {
    const b01 = byId.get("B01")!;
    expect(() => parseSpec({ ...b01, format: "jpg" })).toThrow(/photo/);
    expect(() => parseSpec({ ...b01, hiddenText: "x", format: "png" })).toThrow(/hiddenText/);
    expect(() => parseSpec({ ...b01, extra: 1 })).toThrow();
  });
});
