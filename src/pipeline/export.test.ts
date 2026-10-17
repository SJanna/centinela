import { parse } from "csv-parse/sync";
import { describe, expect, it } from "vitest";
import { makeRecord } from "../store/test-helpers";
import { CSV_COLUMNS, csvCell, decisionsToCsv, decisionsToJson } from "./export";
import { IDEMPOTENCY_NAMESPACE, uuidv5 } from "./idempotency";

describe("csvCell", () => {
  it("escapa comas, comillas y saltos de línea", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('di "hola"')).toBe('"di ""hola"""');
    expect(csvCell("l1\nl2")).toBe('"l1\nl2"');
    expect(csvCell("simple")).toBe("simple");
  });

  it("neutraliza fórmulas en textos, no en números", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell(-5)).toBe("-5");
  });

  it("valores vacíos y booleanos", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(true)).toBe("sí");
    expect(csvCell(false)).toBe("no");
    expect(csvCell(Number.NaN)).toBe("");
  });
});

describe("decisionsToCsv", () => {
  it("UTF-8 con BOM, separador coma, CRLF y columnas en español", () => {
    const csv = decisionsToCsv([
      makeRecord({ id: "dec_1", decidedAt: "2026-10-20T15:00:00Z", filename: "factura, octubre.pdf", total: 1234.5 }),
      makeRecord({
        id: "dec_2",
        decidedAt: "2026-10-20T15:01:00Z",
        outcome: "ESCALAR",
        checks: { "LEC-4": "fail", "PRV-2": "not_evaluable" },
        suspicious: true,
      }),
    ]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("\r\n");
    const rows = parse(csv, { bom: true, columns: true }) as Record<string, string>[];
    expect(Object.keys(rows[0])).toEqual([...CSV_COLUMNS]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id_decision: "dec_1", archivo: "factura, octubre.pdf", decision: "PAGAR", total: "1234.5", texto_sospechoso: "no" });
    expect(rows[1]).toMatchObject({
      id_decision: "dec_2",
      decision: "ESCALAR",
      comprobaciones_no_superadas: "LEC-4 PRV-2",
      texto_sospechoso: "sí",
      accion_para_una_persona: "Revisar",
    });
  });

  it("el modo de lectura sale en español (es texto para personas, no el identificador interno)", () => {
    const csv = decisionsToCsv([
      makeRecord({ id: "dec_1", decidedAt: "2026-10-20T15:00:00Z", readingMode: "simulated" }),
      makeRecord({ id: "dec_2", decidedAt: "2026-10-20T15:01:00Z", readingMode: "live" }),
      makeRecord({ id: "dec_3", decidedAt: "2026-10-20T15:02:00Z", readingMode: "cache" }),
    ]);
    const rows = parse(csv, { bom: true, columns: true }) as Record<string, string>[];
    expect(rows.map((r) => r.modo_lectura)).toEqual(["simulada", "en vivo", "caché"]);
  });

  it("sin decisiones: solo la cabecera", () => {
    expect(decisionsToCsv([])).toBe(`﻿${CSV_COLUMNS.join(",")}\r\n`);
  });

  it("clave_idempotencia: la misma para la misma factura en cualquier decisión, vacía sin proveedor o sin número", () => {
    const csv = decisionsToCsv([
      makeRecord({ id: "dec_1", decidedAt: "2026-10-20T15:00:00Z", invoiceNumber: "F-001" }),
      makeRecord({ id: "dec_2", decidedAt: "2026-10-20T15:01:00Z", invoiceNumber: "F-1", outcome: "FRENAR", checks: { "DUP-2": "fail" } }),
      makeRecord({ id: "dec_3", decidedAt: "2026-10-20T15:02:00Z", vendorId: null, outcome: "ESCALAR" }),
      makeRecord({ id: "dec_4", decidedAt: "2026-10-20T15:03:00Z", invoiceNumber: null, outcome: "ESCALAR" }),
    ]);
    const rows = parse(csv, { bom: true, columns: true }) as Record<string, string>[];
    const expected = uuidv5("v-uno|F1", IDEMPOTENCY_NAMESPACE);
    expect(rows.map((r) => r.clave_idempotencia)).toEqual([expected, expected, "", ""]);
    expect(CSV_COLUMNS.indexOf("clave_idempotencia")).toBe(CSV_COLUMNS.indexOf("numero_factura") + 1);
  });
});

describe("decisionsToJson", () => {
  it("cada registro sale tal cual, con su clave de idempotencia al lado (calculada, no guardada)", () => {
    const records = [
      makeRecord({ id: "dec_1", decidedAt: "2026-10-20T15:00:00Z", invoiceNumber: "F-001" }),
      makeRecord({ id: "dec_2", decidedAt: "2026-10-20T15:01:00Z", vendorId: null, outcome: "ESCALAR" }),
    ];
    const before = structuredClone(records);
    const out = JSON.parse(decisionsToJson(records)) as Record<string, unknown>[];
    expect(records).toEqual(before);
    expect(out).toHaveLength(2);
    const { idempotency: first, ...rest } = out[0];
    expect(rest).toEqual(JSON.parse(JSON.stringify(records[0])));
    expect(first).toEqual({ key: uuidv5("v-uno|F1", IDEMPOTENCY_NAMESPACE), invoiceKey: "v-uno|F1", reason: null });
    expect(out[1].idempotency).toEqual({ key: null, invoiceKey: null, reason: "Sin clave: no se identificó al proveedor en la ficha." });
  });

  it("sin decisiones: lista vacía", () => {
    expect(JSON.parse(decisionsToJson([]))).toEqual([]);
  });
});
