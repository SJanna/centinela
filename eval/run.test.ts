/**
 * Banco de pruebas en modo simulado: la lógica de decisión debe acertar los 41 casos sin pagos
 * indebidos. También se prueban los filtros, el modo caché (sin API) y el reporte.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PRIMARY_MODEL, PROMPT_VERSION, readingCacheKey, SECONDARY_MODEL } from "../src/extract";
import { loadManifest, readCaseRows } from "../src/pipeline/dataset";
import { PRIMARY_READER_ID, SECONDARY_READER_ID } from "../src/pipeline/reader-ids";
import { parseArgs, UsageError } from "./args";
import { computeMetrics, renderMarkdown, runEval, scoreCase, type CaseResult, type EvalReport } from "./lib";

describe("runEval · simulado", () => {
  let report: EvalReport;
  beforeAll(async () => {
    report = await runEval({ reader: "simulated" });
  });

  it("acierta 41/41 y no hay pagos indebidos", () => {
    const failures = report.cases
      .filter((c) => !c.correct)
      .map((c) => `${c.caseId}: esperado ${c.expected} [${c.expectedCodes}], obtenido ${c.outcome} [${[...c.failCodes, ...c.notEvaluableCodes]}]`);
    expect(failures).toEqual([]);
    expect(report.metrics.total.total).toBe(41);
    expect(report.metrics.total.correct).toBe(41);
    expect(report.metrics.total.improperPayments).toBe(0);
  });

  it("métricas por split y por escenario", () => {
    expect(Object.keys(report.metrics.bySplit).sort()).toEqual(["holdout", "train"]);
    expect(Object.keys(report.metrics.byScenario)).toEqual(["base", "cierre_mes", "fondo_bajo", "reservado"]);
    const eligible = readCaseRows().filter((r) => r.decision_esperada !== "ESCALAR").length;
    expect(report.metrics.total.autonomy).toEqual({ resolved: eligible, eligible, rate: 1 });
    expect(report.metrics.total.overEscalations).toBe(0);
    expect(report.metrics.total.overFreezes).toBe(0);
    expect(report.usage).toBeNull();
    expect(report.contextCases).toEqual([]);
  });

  it("el reporte en Markdown trae resumen, escenarios, detalle y fallos", () => {
    const md = renderMarkdown(report);
    expect(md).toContain("## Resumen");
    expect(md).toContain("| Aciertos | 41/41 (100,0 %) |");
    expect(md).toContain("| Pagos indebidos | 0 |");
    expect(md).toContain("## Por escenario");
    expect(md).toContain("| B07 | base | train | FRENAR | FRENAR | DUP-1 |");
    expect(md).toContain("## Fallos\n\nNinguno.");
  });
});

describe("runEval · filtros", () => {
  it("--case procesa los casos anteriores del escenario como historial", async () => {
    const report = await runEval({ reader: "simulated", cases: ["B07"] });
    expect(report.cases.map((c) => c.caseId)).toEqual(["B07"]);
    expect(report.contextCases).toEqual(["B01", "B02", "B03", "B04", "B05", "B06"]);
    expect(report.cases[0]).toMatchObject({ outcome: "FRENAR", correct: true });
    expect(report.cases[0].failCodes).toContain("DUP-1");
  });

  it("--split=holdout solo evalúa el holdout", async () => {
    const report = await runEval({ reader: "simulated", split: "holdout" });
    expect(report.cases.every((c) => c.split === "holdout")).toBe(true);
    expect(report.cases).toHaveLength(readCaseRows().filter((r) => r.split === "holdout").length);
  });

  it("un caso desconocido es un error claro", async () => {
    await expect(runEval({ reader: "simulated", cases: ["Z99"] })).rejects.toThrow("Caso(s) desconocido(s) en casos.csv: Z99.");
  });
});

describe("runEval · caché y live", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "centinela-eval-"));
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  });

  it("modo cache sin lecturas guardadas: no llama a la API, escala y nunca paga", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const report = await runEval({ reader: "cache", cacheDir: dir, split: "train" });
    expect(report.cacheMisses).toBeGreaterThan(0);
    expect(report.metrics.total.improperPayments).toBe(0);
    expect(report.cases.every((c) => c.outcome !== "PAGAR")).toBe(true);
    expect(report.cases.find((c) => c.caseId === "B01")?.readerErrors[0]).toMatch(/^lector-a: unavailable · No hay lectura guardada/);
  });

  it("modo cache con lecturas guardadas (mismas claves que la app) reproduce las decisiones", async () => {
    for (const entry of loadManifest()) {
      for (const [id, model] of [
        [PRIMARY_READER_ID, PRIMARY_MODEL],
        [SECONDARY_READER_ID, SECONDARY_MODEL],
      ]) {
        const key = readingCacheKey(entry.sha256, id, model, PROMPT_VERSION);
        await writeFile(path.join(dir, `${key}.json`), JSON.stringify(entry.groundTruth), "utf8");
      }
    }
    const report = await runEval({ reader: "cache", cacheDir: dir });
    expect(report.cacheMisses).toBe(0);
    expect(report.metrics.total.correct).toBe(41);
    expect(report.metrics.total.improperPayments).toBe(0);
  });

  it("modo live sin ANTHROPIC_API_KEY aborta con un mensaje claro", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    await expect(runEval({ reader: "live" })).rejects.toThrow(/^Falta ANTHROPIC_API_KEY/);
  });
});

describe("métricas", () => {
  const row = (decision_esperada: "PAGAR" | "FRENAR" | "ESCALAR", codes: string[] = []) => ({
    id: "X",
    split: "train" as const,
    escenario: "base",
    formato: "pdf" as const,
    proveedor: "",
    descripcion: "",
    decision_esperada,
    codigos_esperados: codes as never[],
  });

  it("scoreCase", () => {
    expect(scoreCase(row("FRENAR", ["DUP-1"]), "FRENAR", ["DUP-1"], [])).toMatchObject({ correct: true, missingCodes: [] });
    expect(scoreCase(row("ESCALAR", ["LEC-1"]), "ESCALAR", [], ["LEC-1"])).toMatchObject({ correct: true });
    expect(scoreCase(row("ESCALAR", ["LEC-4"]), "ESCALAR", ["LEC-1"], [])).toMatchObject({ correct: false, missingCodes: ["LEC-4"] });
    expect(scoreCase(row("ESCALAR"), "PAGAR", [], [])).toMatchObject({ improperPayment: true, correct: false });
    expect(scoreCase(row("PAGAR"), "ESCALAR", [], [])).toMatchObject({ overEscalation: true });
    expect(scoreCase(row("ESCALAR"), "FRENAR", [], [])).toMatchObject({ overFreeze: true, overEscalation: false });
  });

  it("autonomía = PAGAR/FRENAR esperados resueltos correctamente / PAGAR/FRENAR esperados", () => {
    const mk = (expected: CaseResult["expected"], outcome: CaseResult["outcome"], correct: boolean) =>
      ({ expected, outcome, correct, improperPayment: false, overEscalation: false, overFreeze: false }) as CaseResult;
    const m = computeMetrics([mk("PAGAR", "PAGAR", true), mk("FRENAR", "ESCALAR", false), mk("ESCALAR", "ESCALAR", true), mk("PAGAR", "FRENAR", false)]);
    expect(m.autonomy).toEqual({ resolved: 1, eligible: 3, rate: 1 / 3 });
    expect(m.correct).toBe(2);
    expect(m.accuracy).toBe(0.5);
  });
});

describe("parseArgs", () => {
  it("formas --x=v y --x v, casos separados por coma o repetidos", () => {
    expect(parseArgs([])).toEqual({ reader: "simulated", split: "all" });
    expect(parseArgs(["--reader=cache", "--split", "holdout", "--case=h01,H03", "--case", "h01"])).toEqual({
      reader: "cache",
      split: "holdout",
      cases: ["H01", "H03"],
    });
    // npm run eval -- --reader=live: el último valor manda.
    expect(parseArgs(["--reader=simulated", "--reader=live"]).reader).toBe("live");
  });

  it("errores de uso", () => {
    expect(() => parseArgs(["--reader=otro"])).toThrow(UsageError);
    expect(() => parseArgs(["--nada"])).toThrow("Opción desconocida: --nada");
    expect(() => parseArgs(["--case"])).toThrow("Falta el valor de --case.");
  });
});
