/**
 * Banco de pruebas sobre el set de estrés (dataset/stress). Los archivos no se versionan: estas
 * pruebas corren solo si ya se generaron con npm run stress:generate.
 */
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadEvalDataset, STRESS_GENERATED } from "./datasets";
import { runEval, type EvalReport } from "./lib";
import { buildStressSummary, renderStressMarkdown, stressJson } from "./stress-report";

const generated = existsSync(path.join(process.cwd(), STRESS_GENERATED, "manifest.json"));

describe.skipIf(!generated)("banco de pruebas · set de estrés (muestra, simulado)", () => {
  let report: EvalReport;
  beforeAll(async () => {
    report = await runEval({ reader: "simulated", dataset: "stress", sample: 150, sampleSeed: 5, concurrency: 6 });
  }, 120_000);

  it("con lectura perfecta acierta todo y no paga nada indebido", () => {
    const failures = report.cases.filter((c) => !c.correct).map((c) => `${c.caseId}: esperado ${c.expected} [${c.expectedCodes}], obtenido ${c.outcome} [${[...c.failCodes, ...c.notEvaluableCodes]}]`);
    expect(failures).toEqual([]);
    expect(report.cases).toHaveLength(150);
    expect(report.metrics.total.improperPayments).toBe(0);
    expect(report.sample).toEqual({ size: 150, seed: 5 });
    expect(report.contextCases.length).toBeGreaterThan(0);
    expect(report.dataset).toBe("stress");
  });

  it("el orden del reporte no depende del paralelismo", async () => {
    const serial = await runEval({ reader: "simulated", dataset: "stress", sample: 150, sampleSeed: 5, concurrency: 1 });
    expect(serial.cases.map((c) => [c.caseId, c.outcome])).toEqual(report.cases.map((c) => [c.caseId, c.outcome]));
  }, 120_000);

  it("la muestra cubre muchas trampas y formatos", () => {
    const traps = new Set(report.cases.map((c) => c.extras?.trampa.split("+")[0]));
    const formats = new Set(report.cases.map((c) => c.formato));
    expect(traps.size).toBeGreaterThan(20);
    expect(formats.size).toBe(5);
  });

  it("el reporte trae intervalos, matriz de confusión y grupos por trampa, formato, idioma y dificultad", () => {
    const s = buildStressSummary(report);
    expect(s.total.improperPayments.k).toBe(0);
    expect(s.total.improperPayments.high).toBeGreaterThan(0);
    expect(Object.keys(s.byLanguage).sort()).toEqual(["en", "es", "pt"]);
    expect(Object.keys(s.byDifficulty).sort()).toEqual(["alta", "baja", "media"]);
    // Uno como mínimo por trampa y el resto en proporción: las legítimas siguen siendo ~40 % de la muestra.
    expect(s.byTrap.ninguna.metrics.total).toBeGreaterThan(45);
    const md = renderStressMarkdown(report, s);
    for (const h of ["## Resumen", "## Matriz de confusión", "## Por trampa", "## Por formato", "## Por idioma", "## Por dificultad", "## Fallos por tipo"]) expect(md).toContain(h);
    expect(md).toMatch(/\| Pagos indebidos \(sobre las que no se debían pagar\) \| 0\/\d+ · 0,0 % \[0,0–\d+,\d\] \|/);
    const json = JSON.parse(stressJson(report, s)) as { stress: unknown; cases: Array<{ summary: string }> };
    expect(json.stress).toBeTruthy();
    expect(json.cases.every((c) => c.summary === "")).toBe(true);
  });
});

describe.skipIf(!generated)("banco de pruebas · set de estrés (modo caché sin lecturas)", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "centinela-stress-"));
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  });

  it("no llama a la API, arma el historial con la lectura simulada y nunca paga", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const report = await runEval({ reader: "cache", dataset: "stress", sample: 40, cacheDir: dir, concurrency: 4 });
    expect(report.cases).toHaveLength(40);
    expect(report.cacheMisses).toBe(80);
    expect(report.cases.every((c) => c.outcome !== "PAGAR")).toBe(true);
    expect(report.metrics.total.improperPayments).toBe(0);
  }, 120_000);
});

describe.skipIf(!generated)("conjunto de estrés", () => {
  it("se carga con 2000 casos, 40 escenarios y su manifiesto", () => {
    const ds = loadEvalDataset("stress");
    expect(ds.rows).toHaveLength(2000);
    expect(ds.scenarios).toHaveLength(40);
    expect(ds.manifest).toHaveLength(2000);
    expect(ds.extras.get("S0001")).toBeTruthy();
    expect(ds.filePath(ds.manifest[0])).toContain(path.join("dataset", "stress", "generated"));
  });
});
