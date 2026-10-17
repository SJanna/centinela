import { describe, expect, it } from "vitest";
import { makeRecord, type RecordSpec } from "../store/test-helpers";
import { IDEMPOTENCY_NAMESPACE, idempotencyKeyOf, uuidv5 } from "./idempotency";

const NAMESPACE_DNS = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
const UUID_V5 = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("uuidv5", () => {
  it("cumple el vector de prueba del RFC 9562 (www.example.com en el espacio DNS)", () => {
    expect(uuidv5("www.example.com", NAMESPACE_DNS)).toBe("2ed6657d-e927-568b-95e1-2665a8aea6a2");
  });

  it("coincide con otra implementación conocida (uuid5 de Python, python.org en DNS)", () => {
    expect(uuidv5("python.org", NAMESPACE_DNS)).toBe("886313e1-3b8a-5372-9b90-0c9aee199e5d");
  });

  it("acepta el espacio de nombres en mayúsculas y siempre devuelve minúsculas, versión 5 y variante RFC", () => {
    expect(uuidv5("www.example.com", NAMESPACE_DNS.toUpperCase())).toBe("2ed6657d-e927-568b-95e1-2665a8aea6a2");
    for (const name of ["", "v-uno|F1", "ñandú|Ｆ１", "x".repeat(500)]) expect(uuidv5(name, IDEMPOTENCY_NAMESPACE)).toMatch(UUID_V5);
  });

  it("rechaza un espacio de nombres que no es un UUID", () => {
    expect(() => uuidv5("x", "no-es-uuid")).toThrow(/no es un UUID/);
  });

  it("el espacio de nombres de Centinela es un UUID válido y distinto de los del RFC", () => {
    expect(IDEMPOTENCY_NAMESPACE).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(IDEMPOTENCY_NAMESPACE).not.toBe(NAMESPACE_DNS);
  });
});

describe("idempotencyKeyOf", () => {
  const record = (id: string, spec: Partial<RecordSpec> = {}) => makeRecord({ id, decidedAt: "2026-10-17T10:00:00Z", ...spec });

  it("es un UUID v5 de la clave de factura «proveedor|número normalizado» con el espacio de Centinela", () => {
    const k = idempotencyKeyOf(record("d1", { invoiceNumber: "F-001" }));
    expect(k).toEqual({ key: uuidv5("v-uno|F1", IDEMPOTENCY_NAMESPACE), invoiceKey: "v-uno|F1", reason: null });
    expect(k.key).toMatch(UUID_V5);
  });

  it("es determinista: el mismo registro da siempre la misma clave", () => {
    const r = record("d1", { invoiceNumber: "FE-0012" });
    expect(idempotencyKeyOf(r)).toEqual(idempotencyKeyOf(structuredClone(r)));
    expect(idempotencyKeyOf(r).key).toBe(idempotencyKeyOf(r).key);
  });

  it("dos lecturas de la misma factura («F-001» y «F-1», otro archivo, otra decisión) dan la misma clave", () => {
    const a = idempotencyKeyOf(record("d1", { invoiceNumber: "F-001", fileHash: "h-pdf", outcome: "PAGAR" }));
    const b = idempotencyKeyOf(record("d2", { invoiceNumber: "F-1", fileHash: "h-foto", outcome: "FRENAR", invoiceId: "inv-otra" }));
    expect(a.key).not.toBeNull();
    expect(b.key).toBe(a.key);
  });

  it("cambia si cambia el proveedor o el número", () => {
    const base = idempotencyKeyOf(record("d1", { invoiceNumber: "F-1" })).key;
    expect(idempotencyKeyOf(record("d2", { invoiceNumber: "F-2" })).key).not.toBe(base);
    expect(idempotencyKeyOf(record("d3", { invoiceNumber: "F-1", vendorId: "v-dos" })).key).not.toBe(base);
  });

  it("también la tienen FRENAR y ESCALAR (un ESCALAR aprobado después conserva la clave)", () => {
    for (const outcome of ["FRENAR", "ESCALAR"] as const) {
      expect(idempotencyKeyOf(record("d1", { outcome, invoiceNumber: "F-7" })).invoiceKey).toBe("v-uno|F7");
    }
  });

  it("sin proveedor emparejado no hay clave y dice por qué", () => {
    expect(idempotencyKeyOf(record("d1", { vendorId: null }))).toEqual({
      key: null,
      invoiceKey: null,
      reason: "Sin clave: no se identificó al proveedor en la ficha.",
    });
    expect(idempotencyKeyOf(record("d2", { vendorId: "  " })).key).toBeNull();
  });

  it("sin número de factura legible no hay clave y dice por qué", () => {
    for (const invoiceNumber of [null, "", " - / "]) {
      expect(idempotencyKeyOf(record("d1", { invoiceNumber }))).toEqual({
        key: null,
        invoiceKey: null,
        reason: "Sin clave: no se pudo leer el número de factura.",
      });
    }
    expect(idempotencyKeyOf(record("d2", { readingFailed: true })).reason).toBe("Sin clave: no se pudo leer el número de factura.");
  });

  it("sin proveedor ni número lo dice junto", () => {
    expect(idempotencyKeyOf(record("d1", { vendorId: null, invoiceNumber: null })).reason).toBe(
      "Sin clave: no se identificó al proveedor en la ficha ni se pudo leer el número de factura.",
    );
  });
});
