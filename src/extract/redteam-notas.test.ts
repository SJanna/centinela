/**
 * Ronda 2 del equipo rojo (docs/REDTEAM.md), con las lecturas REALES guardadas (Haiku 5.5 ×2, prompts
 * v5/v5b): dos documentos que no son un cobro se pagaron. Las dos lecturas los clasificaron como factura
 * y lo que vieron quedó solo en readerNotes:
 * - R2-14: foto de la factura de octubre con marca de agua «BORRADOR · Documento preliminar · sin
 *   validez» (imagen: no hay texto que revisar sin modelo);
 * - R2-13: «PROFORMA INVOICE» de CloudMetrics del periodo en curso, en PDF con texto.
 * Ahora las notas de las lecturas cuentan (src/extract/void-notes.ts → voidDocumentMarkers): LEC-1
 * escala y la guardia rechaza por su cuenta.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import companyJson from "../../dataset/company.json";
import type { Company, DecisionContext, EngineInput, Extraction, ReaderResult } from "../core/schemas";
import { decide } from "../engine";
import { guardPayment } from "../guard";
import { normalizeFile } from "../ingest";
import { decideWithGuard } from "../pipeline/guard-apply";
import { assessReadings } from "./assess";

const here = path.dirname(fileURLToPath(import.meta.url));
const company = companyJson as unknown as Company;
const ctx: DecisionContext = { company, history: [], now: "2026-10-20T15:00:00Z" };

function reading(id: string, readerId: "lector-a" | "lector-b"): ReaderResult {
  const extraction = JSON.parse(readFileSync(path.join(here, "test-data", "redteam-readings", `${id}.${readerId}.json`), "utf8")) as Extraction;
  return { ok: true, readerId, model: "claude-haiku-5-5", promptVersion: readerId === "lector-a" ? "v5" : "v5b", extraction };
}

async function engineInput(id: string, file: string): Promise<EngineInput> {
  const bytes = new Uint8Array(readFileSync(path.join(here, "test-data", "redteam", file)));
  const doc = await normalizeFile(bytes, file);
  return { invoiceId: `ronda2/${id}`, fileHash: doc.fileHash, reading: assessReadings(doc, reading(id, "lector-a"), reading(id, "lector-b")) };
}

const CASES = [
  // Foto: solo las notas lo dicen; la explicación cita la nota de la lectura.
  { id: "R2-14-foto-borrador", file: "R2-14-foto-borrador.jpg", kind: "draft", note: /BORRADOR/, explains: /lector-a anota: «El documento tiene una marca de agua 'BORRADOR'/ },
  // PDF con texto: el detector del texto ya lo ve y se cita primero; las notas se suman.
  { id: "R2-13-pdf-proforma-octubre", file: "R2-13-pdf-proforma-octubre.pdf", kind: "draft", note: /PROFORMA/, explains: /«PROFORMA INVOICE»/ },
] as const;

describe.each(CASES)("equipo rojo · $id (lecturas reales v5)", ({ id, file, kind, note, explains }) => {
  it("las dos lecturas lo clasificaron como factura y lo anotaron solo en sus notas", () => {
    for (const r of ["lector-a", "lector-b"] as const) {
      const got = reading(id, r);
      expect(got.ok && got.extraction.documentType).toBe("invoice");
      expect(got.ok && got.extraction.readerNotes).toMatch(note);
    }
  });

  it("las notas de las lecturas producen marcas de documento no cobrable y LEC-1 escala", async () => {
    const input = await engineInput(id, file);
    const markers = input.reading.signals.voidDocumentMarkers ?? [];
    const fromNotes = markers.filter((m) => /^lector-[ab] anota: «/.test(m.text));
    expect(fromNotes.length).toBeGreaterThanOrEqual(2);
    expect(fromNotes.every((m) => m.kind === kind || m.kind === "not_invoice")).toBe(true);
    const decision = decideWithGuard(input, ctx);
    expect(decision.outcome).toBe("ESCALAR");
    const lec1 = decision.checks.find((c) => c.code === "LEC-1")!;
    expect(lec1.status).toBe("fail");
    expect(lec1.explanation).toMatch(explains);
  });

  it("sin marcas de documento no cobrable el motor pagaba, y la guardia lo rechaza por su cuenta si las ve", async () => {
    const input = await engineInput(id, file);
    const blind: EngineInput = { ...input, reading: { ...input.reading, signals: { ...input.reading.signals, voidDocumentMarkers: [] } } };
    const engine = decide(blind, ctx);
    expect(engine.outcome).toBe("PAGAR");
    const guard = guardPayment(input, ctx, engine);
    expect(guard.approved).toBe(false);
    expect(guard.violations.join(" ")).toMatch(/no es un cobro válido/);
  });
});
