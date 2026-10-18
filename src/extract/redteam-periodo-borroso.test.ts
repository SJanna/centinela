/**
 * Errores honestos (redteam/attacks/honestos): periodo borroso en una foto, de punta a punta y sin API.
 *
 * HON-T4: Camila reenvía el 3 de noviembre la factura de octubre con otro número (CRD-1101); el único
 * lugar que dice el mes es «Periodo: 10/2026», borroso en la foto. Octubre ya se pagó (CRD-1045). Con
 * Claude real (economico, v6/v6b, 18 de octubre) las dos lecturas marcan el periodo como ilegible
 * (legible = false) y lo anotan («El campo de periodo está borroso»); lector-a lo deja vacío y lector-b
 * adivina «2026-10». Escalaba solo porque las dos lecturas imputaban meses distintos (LEC-2): si las dos
 * lo dejaban vacío, el motor tomaba el mes de la emisión (noviembre), lo veía libre y pagaba octubre dos
 * veces. Ninguna regla miraba que el periodo estuviera marcado ilegible.
 *
 * Con el perfil calidad (Sonnet 5.5 + Haiku 5.5, v6) las DOS lecturas dejaron el periodo vacío
 * (marcado ilegible): sin la regla de abajo se pagaba (dos modelos distintos, el mismo error).
 *
 * HON-T5: CloudMetrics, otra factura de octubre con número nuevo y el periodo borroso; octubre ya pagado.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import companyJson from "../../dataset/company.json";
import type { Company, DecisionContext, EngineInput, Extraction, HistoryEntry, NormalizedDoc, ReaderResult } from "../core/schemas";
import { decide } from "../engine";
import { guardPayment } from "../guard";
import { normalizeFile } from "../ingest";
import { decideWithGuard } from "../pipeline/guard-apply";
import { assessReadings } from "./assess";

const here = path.dirname(fileURLToPath(import.meta.url));
const company = companyJson as unknown as Company;

const CAMILA_OCT: HistoryEntry = {
  invoiceId: "B01",
  fileHash: "previa-CRD-1045",
  outcome: "PAGAR",
  vendorId: "v-camila",
  invoiceNumber: "CRD-1045",
  agreementId: "a-camila-mensual",
  agreementPeriod: "2026-10",
  amountUsd: 3000,
  decidedAt: "2026-10-05T15:00:00Z",
};
const CLOUD_OCT: HistoryEntry = {
  invoiceId: "B02",
  fileHash: "previa-CM-2026-1010",
  outcome: "PAGAR",
  vendorId: "v-cloudmetrics",
  invoiceNumber: "CM-2026-1010",
  agreementId: "a-cloudmetrics-saas",
  agreementPeriod: "2026-10",
  amountUsd: 1200,
  decidedAt: "2026-10-06T15:00:00Z",
};
/** El historial y la fecha de los ataque.json de HON-T4 y HON-T5. */
const T4_CTX: DecisionContext = { company, history: [CAMILA_OCT], now: "2026-11-08T15:00:00Z" };
const T5_CTX: DecisionContext = { company, history: [CLOUD_OCT], now: "2026-11-02T15:00:00Z" };

const T4_FILE = "HON-T4-foto-octubre-reenviada-periodo-borroso.jpg";
const T5_FILE = "HON-T5-foto-duplicado-numero-nuevo-periodo-borroso.jpg";
const ACTION = "Pedir al proveedor una copia legible y confirmar qué mes cobra antes de pagar.";

function extraction(id: "HON-T4" | "HON-T5", readerId: "lector-a" | "lector-b"): Extraction {
  return JSON.parse(readFileSync(path.join(here, "test-data", "redteam-readings", `${id}.${readerId}.json`), "utf8")) as Extraction;
}

async function photo(file: string): Promise<NormalizedDoc> {
  return normalizeFile(new Uint8Array(readFileSync(path.join(here, "test-data", "redteam", file))), "factura.jpg");
}

function input(doc: NormalizedDoc, a: Extraction, b: Extraction): EngineInput {
  const ra: ReaderResult = { ok: true, readerId: "lector-a", model: "claude-haiku-5-5", promptVersion: "v6", extraction: a };
  const rb: ReaderResult = { ok: true, readerId: "lector-b", model: "claude-haiku-5-5", promptVersion: "v6b", extraction: b };
  return { invoiceId: "honestos/periodo-borroso", fileHash: doc.fileHash, reading: assessReadings(doc, ra, rb) };
}

function notPassing(i: EngineInput, ctx: DecisionContext): string[] {
  return decideWithGuard(i, ctx).checks.filter((c) => c.status !== "pass").map((c) => c.code);
}

/** La lectura con el periodo vacío y marcado ilegible (lector-a de HON-T4), como si la leyeran las dos. */
function bothBlank(): [Extraction, Extraction] {
  const a = extraction("HON-T4", "lector-a");
  return [a, structuredClone(a)];
}

/** Sin la marca de ilegible ni la nota: lo que el motor veía igual antes (el periodo vacío, nada más). */
function withoutDoubt(e: Extraction): Extraction {
  return { ...e, servicePeriod: { value: null, evidence: null, legible: true }, readerNotes: "Documento sin marcas de pagado, anulado ni borrador." };
}

describe("HON-T4 · periodo borroso de un mes ya pagado", () => {
  it("con las dos lecturas reales: no se paga, y DUP-3 ya no depende del desacuerdo", async () => {
    const doc = await photo(T4_FILE);
    const i = input(doc, extraction("HON-T4", "lector-a"), extraction("HON-T4", "lector-b"));
    const d = decideWithGuard(i, T4_CTX);
    expect(d.outcome).toBe("ESCALAR");
    expect(notPassing(i, T4_CTX)).toEqual(["LEC-2", "DUP-3"]);
  });

  it("con las lecturas reales del perfil calidad (Sonnet + Haiku, que dejaron las dos el periodo vacío): antes pagaba, ahora escala por DUP-3", async () => {
    const doc = await photo(T4_FILE);
    const read = (readerId: "lector-a" | "lector-b") =>
      JSON.parse(readFileSync(path.join(here, "test-data", "redteam-readings", `HON-T4.calidad.${readerId}.json`), "utf8")) as Extraction;
    const [a, b] = [read("lector-a"), read("lector-b")];
    expect([a.servicePeriod.value, b.servicePeriod.value]).toEqual([null, null]);
    const i = input(doc, a, b);
    const d = decideWithGuard(i, T4_CTX);
    expect(d.outcome).toBe("ESCALAR");
    expect(notPassing(i, T4_CTX)).toEqual(["DUP-3"]);
    expect(d.checks.find((c) => c.code === "DUP-3")!.explanation).toContain("una de las lecturas lo marca como ilegible («PERIODO 10/2026»)");
    // Lo que veían el motor y la guardia antes (sin la marca ni la nota): pagaba octubre otra vez.
    const before = decideWithGuard(input(doc, withoutDoubt(a), withoutDoubt(b)), T4_CTX);
    expect(before.outcome).toBe("PAGAR");
    expect(before.agreementPeriod).toBe("2026-11");
    // Y la guardia sola, ante ese PAGAR, no lo aprueba.
    expect(guardPayment(i, T4_CTX, decide(input(doc, withoutDoubt(a), withoutDoubt(b)), T4_CTX)).approved).toBe(false);
  });

  it("si las dos lecturas dejan el periodo vacío y lo marcan ilegible: escala por DUP-3 (antes pagaba octubre dos veces)", async () => {
    const doc = await photo(T4_FILE);
    const i = input(doc, ...bothBlank());
    const d = decideWithGuard(i, T4_CTX);
    expect(d.outcome).toBe("ESCALAR");
    expect(d.guardOverride).toBe(false);
    expect(notPassing(i, T4_CTX)).toEqual(["DUP-3"]);
    const dup3 = d.checks.find((c) => c.code === "DUP-3")!;
    expect(dup3.status).toBe("not_evaluable");
    expect(dup3.explanation).toBe(
      "El periodo de la factura no se lee con claridad: una de las lecturas lo marca como ilegible («PERIODO 10/2026 (borroso)»). No se sabe qué mes cobra: imputarla a noviembre de 2026 sin confirmarlo podría pagar dos veces un mes (del acuerdo «Desarrollo backend, tarifa fija mensual» ya se pagó octubre de 2026, factura B01).",
    );
    expect(d.humanAction).toContain(ACTION);
    expect(d.summary).toContain("no se sabe qué mes cobra la factura");
  });

  it("el mismo caso: si el motor se equivocara y dijera PAGAR, la guardia lo rechaza sola", async () => {
    const doc = await photo(T4_FILE);
    const [a, b] = bothBlank();
    const enginePaid = decide(input(doc, withoutDoubt(a), withoutDoubt(b)), T4_CTX);
    expect(enginePaid.outcome).toBe("PAGAR");
    const g = guardPayment(input(doc, a, b), T4_CTX, enginePaid);
    expect(g.approved).toBe(false);
    expect(g.violations).toContain(
      "el periodo de la factura no se lee con claridad (una lectura lo marca como ilegible: «PERIODO 10/2026 (borroso)»): no se sabe qué mes cobra",
    );
  });

  it("basta la nota de una lectura («El campo de periodo está borroso»), aunque no lo marque ilegible", async () => {
    const doc = await photo(T4_FILE);
    const [a, b] = bothBlank();
    const noted = { ...withoutDoubt(a), readerNotes: "El campo de periodo está borroso; no se pudo leer con certeza el mes/año." };
    const i = input(doc, noted, withoutDoubt(b));
    expect(i.reading.signals.servicePeriodDoubts).toEqual([
      { readerId: "lector-a", source: "note", text: "El campo de periodo está borroso" },
    ]);
    expect(decideWithGuard(i, T4_CTX).outcome).toBe("ESCALAR");
    expect(notPassing(i, T4_CTX)).toEqual(["DUP-3"]);
    const enginePaid = decide(input(doc, withoutDoubt(a), withoutDoubt(b)), T4_CTX);
    const g = guardPayment(i, T4_CTX, enginePaid);
    expect(g.approved).toBe(false);
    expect(g.violations.some((x) => x.startsWith("el periodo de la factura no se lee con claridad (una lectura anota que está borroso"))).toBe(true);
  });

  it.each([
    "El periodo se lee con claridad; no hay partes borrosas.",
    "Periodo no indicado en el documento.",
    "Sin partes borrosas en el periodo ni en el total.",
    "El periodo cubierto es octubre de 2026.",
    "La foto tiene un reflejo sobre el encabezado; el periodo y el total son legibles.",
  ])("una nota que no duda del periodo no cuenta: «%s»", async (note) => {
    const doc = await photo(T4_FILE);
    const [a, b] = bothBlank();
    const i = input(doc, { ...withoutDoubt(a), readerNotes: note }, withoutDoubt(b));
    expect(i.reading.signals.servicePeriodDoubts).toEqual([]);
  });
});

describe("la guardia: una nota que habla de otra cosa del periodo no la hace rechazar", () => {
  it.each([
    "El monto de 'Cargos adicionales del periodo' está borroso.",
    "No hay partes borrosas en el periodo.",
    "Se marca no legible la fecha según el periodo borroso del encabezado anterior, que no aplica.",
  ])("«%s»", async (note) => {
    const doc = await photo(T4_FILE);
    const [a, b] = bothBlank();
    // Sin octubre en el historial: el motor paga (noviembre libre) y la guardia no tiene otra objeción.
    const ctx: DecisionContext = { ...T4_CTX, history: [] };
    const engine = decide(input(doc, withoutDoubt(a), withoutDoubt(b)), ctx);
    expect(engine.outcome).toBe("PAGAR");
    const g = guardPayment(input(doc, { ...withoutDoubt(a), readerNotes: note }, withoutDoubt(b)), ctx, engine);
    expect(g.violations.filter((x) => x.includes("periodo de la factura"))).toEqual([]);
  });
});

describe("HON-T5 · duplicado con número nuevo y periodo borroso", () => {
  it("con las dos lecturas reales: frena por DUP-3 (octubre ya pagado), como antes", async () => {
    const doc = await photo(T5_FILE);
    const i = input(doc, extraction("HON-T5", "lector-a"), extraction("HON-T5", "lector-b"));
    expect(decideWithGuard(i, T5_CTX).outcome).toBe("FRENAR");
  });

  it("emitida en noviembre y con el periodo vacío en las dos lecturas: escala (antes pagaba octubre dos veces)", async () => {
    const doc = await photo(T5_FILE);
    const b = extraction("HON-T5", "lector-b");
    const november = { ...b, issueDate: { value: "2026-11-02", evidence: "Invoice date Nov 2, 2026", legible: true } };
    const i = input(doc, november, structuredClone(november));
    expect(decideWithGuard(i, T5_CTX).outcome).toBe("ESCALAR");
    expect(notPassing(i, T5_CTX)).toEqual(["DUP-3"]);
    // Sin la marca de ilegible, el mismo documento pagaba.
    const before = input(doc, withoutDoubt(november), withoutDoubt(november));
    expect(decideWithGuard(before, T5_CTX).outcome).toBe("PAGAR");
  });
});
