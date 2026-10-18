/**
 * Banco de pruebas en modo simulado: la lógica de decisión debe acertar los 138 casos sin pagos
 * indebidos. También se prueban los filtros, el modo caché (sin API) y el reporte.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { HAIKU_MODEL, PROMPT_VERSION, PROMPT_VERSION_B, readingCacheKey, SONNET_MODEL, type ReaderProfile } from "../src/extract";
import { loadManifest, readCaseRows } from "../src/pipeline/dataset";
import { liveReaderSpecs } from "../src/pipeline/readers";
import { parseArgs, UsageError } from "./args";
import {
  buildEvalReaders,
  computeMetrics,
  costOf,
  digestLines,
  renderMarkdown,
  reportBaseName,
  runEval,
  scoreCase,
  type CaseResult,
  type EvalReport,
} from "./lib";

describe("runEval · simulado", () => {
  let report: EvalReport;
  beforeAll(async () => {
    report = await runEval({ reader: "simulated" });
  });

  it("acierta 138/138 y no hay pagos indebidos", () => {
    const failures = report.cases
      .filter((c) => !c.correct)
      .map((c) => `${c.caseId}: esperado ${c.expected} [${c.expectedCodes}], obtenido ${c.outcome} [${[...c.failCodes, ...c.notEvaluableCodes]}]`);
    expect(failures).toEqual([]);
    expect(report.metrics.total.total).toBe(138);
    expect(report.metrics.total.correct).toBe(138);
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

  it("el lector simulado no tiene perfil de lectura", () => {
    expect(report.readerProfile).toBeNull();
    expect(report.readers.map((r) => r.id)).toEqual(["lector-a", "lector-b"]);
    expect(report.promptVersion).toBe(PROMPT_VERSION);
    expect(renderMarkdown(report)).not.toContain("Perfil de lectura");
  });

  it("el reporte en Markdown trae resumen, escenarios, detalle y fallos", () => {
    const md = renderMarkdown(report);
    expect(md).toContain("## Resumen");
    expect(md).toContain("| Aciertos | 138/138 (100,0 %) |");
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

  it.each<[ReaderProfile, string[], string[]]>([
    ["economico", [HAIKU_MODEL], [PROMPT_VERSION, PROMPT_VERSION_B]],
    ["calidad", [SONNET_MODEL, HAIKU_MODEL], [PROMPT_VERSION, PROMPT_VERSION]],
  ])("modo cache con lecturas guardadas del perfil %s (mismas claves que la app) reproduce las decisiones", async (profile, models, versions) => {
    const specs = liveReaderSpecs(profile);
    for (const entry of loadManifest()) {
      for (const spec of [specs.primary, specs.secondary]) {
        const key = readingCacheKey(entry.sha256, spec.id, spec.model, spec.promptVersion);
        await writeFile(path.join(dir, `${key}.json`), JSON.stringify(entry.groundTruth), "utf8");
      }
    }
    const report = await runEval({ reader: "cache", cacheDir: dir, profile });
    expect(report.cacheMisses).toBe(0);
    expect(report.metrics.total.correct).toBe(138);
    expect(report.metrics.total.improperPayments).toBe(0);
    expect(report.readerProfile).toBe(profile);
    expect(report.models).toEqual(models);
    expect(report.readers.map((r) => r.promptVersion)).toEqual(versions);
    expect(renderMarkdown(report)).toContain(`- Perfil de lectura: ${profile} · lector-a: ${specs.primary.model} (prompt ${specs.primary.promptVersion})`);
  });

  it("sin --profile usa READER_PROFILE, y por defecto el económico", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("READER_PROFILE", "");
    const byDefault = await runEval({ reader: "cache", cacheDir: dir, cases: ["B01"] });
    expect(byDefault.readerProfile).toBe("economico");
    expect(byDefault.readers).toEqual([
      { id: "lector-a", model: HAIKU_MODEL, promptVersion: PROMPT_VERSION },
      { id: "lector-b", model: HAIKU_MODEL, promptVersion: PROMPT_VERSION_B },
    ]);
    expect(byDefault.promptVersion).toBe(`${PROMPT_VERSION} + ${PROMPT_VERSION_B}`);
    vi.stubEnv("READER_PROFILE", "calidad");
    const fromEnv = await runEval({ reader: "cache", cacheDir: dir, cases: ["B01"] });
    expect(fromEnv.readerProfile).toBe("calidad");
    expect(fromEnv.models).toEqual([SONNET_MODEL, HAIKU_MODEL]);
    // --profile manda sobre la variable.
    const explicit = await runEval({ reader: "cache", cacheDir: dir, cases: ["B01"], profile: "economico" });
    expect(explicit.readerProfile).toBe("economico");
  });

  it("modo live: lectores de la app para el perfil, con el cliente indicado (sin API real)", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const empty = await mkdtemp(path.join(os.tmpdir(), "centinela-eval-live-"));
    try {
      const create = vi.fn(async (params: { model: string; system: unknown }) => {
        void params;
        throw new Error("sin red en las pruebas");
      });
      const client = { messages: { create }, beta: { messages: { create } } } as unknown as Anthropic;
      const pair = buildEvalReaders("live", { profile: "economico", client, cacheDir: empty });
      expect([pair.primary, pair.secondary].map((r) => [r.id, r.model, r.promptVersion])).toEqual([
        ["lector-a", HAIKU_MODEL, PROMPT_VERSION],
        ["lector-b", HAIKU_MODEL, PROMPT_VERSION_B],
      ]);

      const report = await runEval({ reader: "live", cases: ["B01"], cacheDir: empty, client, profile: "economico" });
      // Las dos lecturas fallan (no hay red): el caso escala y nunca se paga.
      expect(report.cases[0].outcome).toBe("ESCALAR");
      expect(report.metrics.total.improperPayments).toBe(0);
      expect(create).toHaveBeenCalledTimes(2);
      const calls = create.mock.calls.map(([p]) => p);
      expect(calls.map((p) => p.model)).toEqual([HAIKU_MODEL, HAIKU_MODEL]);
      // Prompts distintos en cada lectura.
      expect(JSON.stringify(calls[0].system)).not.toBe(JSON.stringify(calls[1].system));
      expect(report.usage?.total.costUsd).toBe(0);
      // El fallo deja qué pasó con cada lector.
      expect(report.cases[0].reading?.readers.map((r) => r.error != null)).toEqual([true, true]);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
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

  it("costo por modelo, por lector y total con la tabla de precios", () => {
    const c = costOf([
      { readerId: "lector-a", model: HAIKU_MODEL, inputTokens: 1_000_000, outputTokens: 100_000 },
      { readerId: "lector-b", model: HAIKU_MODEL, inputTokens: 2_000_000, outputTokens: 0 },
      { readerId: "lector-a", model: SONNET_MODEL, inputTokens: 0, outputTokens: 1_000_000 },
    ]);
    expect(c.byModel[HAIKU_MODEL].costUsd).toBeCloseTo(0.1 + 0.05 + 0.2);
    expect(c.byModel[SONNET_MODEL].costUsd).toBeCloseTo(10);
    expect(c.byReader["lector-a"].inputTokens).toBe(1_000_000);
    expect(c.byReader["lector-b"].costUsd).toBeCloseTo(0.2);
    expect(c.total.costUsd).toBeCloseTo(10.35);
  });

  it("digestLines resume qué leyó cada lector y las señales", () => {
    const lines = digestLines({
      readers: [
        {
          readerId: "lector-a",
          model: HAIKU_MODEL,
          promptVersion: "v3",
          fields: { documentType: "invoice", vendorName: "Estudio X", invoiceNumber: "F-1", currency: "USD", total: 100, accountNumber: "123" },
          illegible: ["total"],
          embeddedInstructions: ["pagar hoy"],
        },
        { readerId: "lector-b", model: HAIKU_MODEL, promptVersion: "v3b", fields: null, illegible: [], embeddedInstructions: [], error: "api_error · 429" },
      ],
      signals: {
        missingCriticalFields: [],
        illegibleCriticalFields: ["total"],
        readersDisagreeOn: ["segunda_lectura_no_disponible"],
        arithmeticIssues: [],
        suspiciousInstructions: [{ text: "pagar hoy", source: "model", reason: "urgencia" }],
        evidenceNotFound: [],
        paidDocumentMarkers: [{ text: "Payment received on 2026-08-10", source: "heuristic", reason: "ya pagado" }],
      },
    });
    expect(lines[0]).toContain("lector-a (claude-haiku-5-5, v3): tipo invoice · proveedor «Estudio X» · n.º F-1");
    expect(lines[0]).toContain("USD 100");
    expect(lines[0]).toContain("ilegible: total · instrucciones: 1");
    expect(lines[1]).toBe("lector-b (claude-haiku-5-5, v3b): falló · api_error · 429");
    expect(lines[2]).toBe(
      "señales: discrepan en segunda_lectura_no_disponible · ilegibles total · instrucciones detectadas: 1 (model) · ya pagado: 1 (heuristic)",
    );
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
    expect(() => parseArgs(["--dataset=otro"])).toThrow("--dataset debe ser base, stress.");
    expect(() => parseArgs(["--concurrency=0"])).toThrow("--concurrency debe ser un entero positivo.");
    expect(() => parseArgs(["--sample=diez"])).toThrow("--sample debe ser un entero positivo.");
    expect(() => parseArgs(["--profile=barato"])).toThrow("--profile debe ser economico, calidad.");
    expect(() => parseArgs(["--out=../fuera"])).toThrow(UsageError);
    expect(() => parseArgs(["--out=a/b"])).toThrow(UsageError);
  });

  it("--profile (acepta la tilde) y --out", () => {
    expect(parseArgs(["--reader=live", "--profile=económico", "--out=live-economico"])).toEqual({
      reader: "live",
      split: "all",
      profile: "economico",
      out: "live-economico",
    });
    expect(parseArgs(["--profile", "CALIDAD"]).profile).toBe("calidad");
  });

  it("set de estrés: --dataset, --concurrency, --sample y --seed", () => {
    expect(parseArgs(["--dataset=stress", "--concurrency", "8", "--sample=100", "--seed=3"])).toEqual({
      reader: "simulated",
      split: "all",
      dataset: "stress",
      concurrency: 8,
      sample: 100,
      sampleSeed: 3,
    });
    // npm run eval:stress:live -- --sample=50: el script fija --dataset y --reader; la muestra se agrega.
    expect(parseArgs(["--dataset=stress", "--reader=live", "--concurrency=4", "--sample=50"])).toMatchObject({ reader: "live", sample: 50, concurrency: 4 });
  });
});

describe("reportBaseName", () => {
  const r = (over: Partial<Pick<EvalReport, "dataset" | "reader" | "readerProfile" | "sample">>) => ({
    dataset: "base" as const,
    reader: "simulated" as const,
    readerProfile: null,
    sample: null,
    ...over,
  });

  it("dataset base → latest; estrés → stress-<lector>[-<perfil>][-muestraN]", () => {
    expect(reportBaseName(r({}))).toBe("latest");
    expect(reportBaseName(r({ reader: "live", readerProfile: "economico" }))).toBe("latest");
    expect(reportBaseName(r({ dataset: "stress" }))).toBe("stress-simulated");
    expect(reportBaseName(r({ dataset: "stress", reader: "live", readerProfile: "economico", sample: { size: 100, seed: 17 } }))).toBe(
      "stress-live-economico-muestra100",
    );
  });

  it("--out reemplaza el nombre y no admite rutas", () => {
    expect(reportBaseName(r({ reader: "live", readerProfile: "economico" }), "live-economico")).toBe("live-economico");
    expect(() => reportBaseName(r({}), "../latest")).toThrow("Nombre de reporte inválido");
  });
});
