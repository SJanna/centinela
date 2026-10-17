import { describe, expect, it } from "vitest";
import { normalizeName } from "../../src/core/normalize";
import { readCases, readCompany } from "./cases";
import { documentOf, isCopySpec, isDocumentSpec, isPhotoOfSpec, loadSpecs, parseSpec } from "./spec";

const specs = loadSpecs();
const rows = readCases();
const company = readCompany();
const byId = new Map(specs.map((s) => [s.id, s]));

describe("specs del dataset", () => {
  it("hay exactamente una spec por cada fila de casos.csv", () => {
    expect(rows).toHaveLength(41);
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

  it("solo B07 es copia (de B02) y solo H03 es foto de otro caso (de H01)", () => {
    const copies = specs.filter(isCopySpec).map((s) => [s.id, s.copyOf]);
    const photos = specs.filter(isPhotoOfSpec).map((s) => [s.id, s.photoOf]);
    expect(copies).toEqual([["B07", "B02"]]);
    expect(photos).toEqual([["H03", "H01"]]);
  });

  it("todas las fechas de emisión son de octubre de 2026 y anteriores al 2026-10-20", () => {
    for (const spec of specs.filter(isDocumentSpec)) {
      expect(spec.issueDate >= "2026-10-01" && spec.issueDate < "2026-10-20", spec.id).toBe(true);
      expect(spec.servicePeriod, spec.id).toBe("2026-10");
      if (spec.dueDate) expect(spec.dueDate >= spec.issueDate, spec.id).toBe(true);
      expect(spec.customer.name, spec.id).toBe(company.name);
    }
  });

  it("los números de factura son únicos salvo B08 = B02 (y su copia B07) y H03 = H01", () => {
    const groups = new Map<string, string[]>();
    for (const spec of specs) {
      const n = documentOf(spec, byId).invoiceNumber.toUpperCase().replace(/[^A-Z0-9]/g, "");
      groups.set(n, [...(groups.get(n) ?? []), spec.id]);
    }
    const repeated = [...groups.values()].filter((ids) => ids.length > 1).map((ids) => ids.sort());
    expect(repeated.sort()).toEqual([
      ["B02", "B07", "B08"],
      ["H01", "H03"],
    ]);
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

  it("los proveedores no registrados (B09, H06) no se parecen a ninguno de la ficha", () => {
    const known = company.vendors.flatMap((v) => [v.name, ...v.aliases]).map(normalizeName);
    for (const id of ["B09", "H06"]) {
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
