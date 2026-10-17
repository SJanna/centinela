/**
 * Recorrido completo con base en memoria (PGLITE_DIR=memory) y lectores simulados.
 */
import { createHash } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { NormalizedDoc, Reader, ReaderResult } from "../core/schemas";
import { IngestError } from "../ingest";
import { createSimulatedReader } from "../extract";
import { exportDecisions, getCompany, listDecisions, resetDbForTests, saveRules } from "../store";
import { companyForScenario, loadDatasetCompany, loadManifest, readCaseRows, readScenarios } from "./dataset";
import { listSamples, readSample, resetDemo } from "./demo";
import { processInvoice, withProcessingLock } from "./process";
import type { ReaderPair } from "./readers";

process.env.PGLITE_DIR = "memory";

const NOW = "2026-10-20T15:00:00Z";

async function sampleInput(caseId: string) {
  const sample = await readSample(caseId);
  if (!sample) throw new Error(`No hay archivo de ejemplo para ${caseId}`);
  return { bytes: sample.bytes, filename: sample.filename, mediaType: sample.mediaType };
}

beforeEach(async () => {
  await resetDbForTests();
  await resetDemo();
});

afterAll(async () => {
  await resetDbForTests();
});

describe("processInvoice · escenario base", () => {
  it("procesa en orden los casos «base» y da las decisiones de casos.csv", async () => {
    const rows = readCaseRows().filter((r) => r.escenario === "base");
    expect(rows.length).toBeGreaterThan(0);
    const mismatches: string[] = [];
    for (const row of rows) {
      const record = await processInvoice(await sampleInput(row.id), { now: NOW, mode: "simulated" });
      const notPassing = record.decision.checks.filter((c) => c.status !== "pass").map((c) => c.code);
      const missing = row.codigos_esperados.filter((code) => !notPassing.includes(code));
      if (record.decision.outcome !== row.decision_esperada || missing.length > 0) {
        mismatches.push(
          `${row.id}: esperado ${row.decision_esperada} [${row.codigos_esperados.join(",")}], ` +
            `obtenido ${record.decision.outcome} [${notPassing.join(",")}]`,
        );
      }
      // Invariantes del registro.
      expect(record.id).toMatch(/^dec_[0-9a-f]{16}$/);
      expect(record.decidedAt).toBe(NOW);
      expect(record.readingMode).toBe("simulated");
      expect(record.decision.checks).toHaveLength(15);
      if (record.decision.outcome === "PAGAR") {
        expect(record.decision.guard).toEqual({ approved: true, violations: [] });
        expect(record.decision.guardOverride).toBe(false);
      }
    }
    expect(mismatches).toEqual([]);

    const listed = await listDecisions();
    expect(listed).toHaveLength(rows.length);
    const exported = await exportDecisions();
    expect(exported.map((r) => r.filename)).toEqual(rows.map((r) => listSamples().find((s) => s.caseId === r.id)!.filename));
  });

  it("todos los escenarios, con el historial guardado en la base: LIM-2 y FON-1 también se cumplen", async () => {
    // El escenario «base» no ejercita el límite del mes ni el fondo: aquí el historial (montos en USD
    // y fechas) sale de la base, como en la aplicación, y las reglas de cada escenario se guardan.
    const mismatches: string[] = [];
    for (const scenario of readScenarios()) {
      await resetDemo();
      await saveRules(companyForScenario(loadDatasetCompany(), scenario).rules);
      for (const row of readCaseRows().filter((r) => r.escenario === scenario.id)) {
        const record = await processInvoice(await sampleInput(row.id), { now: scenario.now, mode: "simulated" });
        const notPassing = record.decision.checks.filter((c) => c.status !== "pass").map((c) => c.code);
        const missing = row.codigos_esperados.filter((code) => !notPassing.includes(code));
        if (record.decision.outcome !== row.decision_esperada || missing.length > 0) {
          mismatches.push(`${scenario.id}/${row.id}: esperado ${row.decision_esperada}, obtenido ${record.decision.outcome} [${notPassing}]`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("guarda la copia de la empresa, las versiones y el archivo", async () => {
    const record = await processInvoice(await sampleInput("B02"), { now: NOW, mode: "simulated" });
    expect(record.companySnapshot).toEqual(await getCompany());
    expect(record.versions.app).toMatch(/^\d+\.\d+\.\d+/);
    expect(record.versions.promptVersion).toBeTruthy();
    expect(record.versions.models).toEqual(["simulado"]);
    expect(record.invoiceId).toMatch(/^inv_/);
    const entry = loadManifest().find((e) => e.caseId === "B02")!;
    expect(record.fileHash).toBe(entry.sha256);
  });

  it("usa la fecha actual con Z si no se pasa now", async () => {
    const record = await processInvoice(await sampleInput("B02"), { mode: "simulated" });
    expect(record.decidedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("un archivo fuera del manifiesto escala por LEC-1 en modo simulado", async () => {
    const bytes = new TextEncoder().encode("Factura 77 de Proveedor X por USD 100, pagar a la cuenta 123");
    const record = await processInvoice({ bytes, filename: "otra.txt" }, { now: NOW, mode: "simulated" });
    expect(record.decision.outcome).toBe("ESCALAR");
    expect(record.decision.checks.find((c) => c.code === "LEC-1")?.status).not.toBe("pass");
  });
});

describe("processInvoice · errores de entrada", () => {
  it("propaga IngestError en español y no registra nada", async () => {
    const promise = processInvoice({ bytes: new Uint8Array(0), filename: "vacia.pdf" }, { now: NOW, mode: "simulated" });
    await expect(promise).rejects.toBeInstanceOf(IngestError);
    await expect(
      processInvoice({ bytes: new Uint8Array(0), filename: "vacia.pdf" }, { now: NOW, mode: "simulated" }),
    ).rejects.toThrow("El archivo «vacia.pdf» está vacío.");
    expect(await listDecisions()).toEqual([]);
  });

  it("un error no bloquea las facturas siguientes", async () => {
    await expect(processInvoice({ bytes: new Uint8Array(0), filename: "x.pdf" }, { mode: "simulated" })).rejects.toThrow();
    const record = await processInvoice(await sampleInput("B02"), { now: NOW, mode: "simulated" });
    expect(record.decision.outcome).toBe("PAGAR");
  });
});

describe("candado de procesamiento", () => {
  /** Lectores simulados que tardan y cuentan cuántas lecturas hay en curso a la vez. */
  function slowReaders(delayMs: number) {
    const manifest = loadManifest();
    const stats = { active: 0, maxActive: 0, calls: 0 };
    const wrap = (inner: Reader): Reader => ({
      ...inner,
      async read(doc: NormalizedDoc): Promise<ReaderResult> {
        stats.active++;
        stats.calls++;
        stats.maxActive = Math.max(stats.maxActive, stats.active);
        try {
          await new Promise((r) => setTimeout(r, delayMs));
          return await inner.read(doc);
        } finally {
          stats.active--;
        }
      },
    });
    // El candado cubre una factura entera: con un solo lector, nunca debería haber 2 lecturas a la vez.
    const primary = wrap(createSimulatedReader({ id: "lector-a", manifest }));
    const secondary: Reader = createSimulatedReader({ id: "lector-b", manifest });
    const readers: ReaderPair = { primary, secondary };
    return { readers, stats };
  }

  it("serializa llamadas concurrentes: el mismo archivo dos veces → PAGAR y luego FRENAR por DUP-1", async () => {
    const { readers, stats } = slowReaders(30);
    const input = await sampleInput("B02");
    const [a, b, c] = await Promise.all([
      processInvoice(input, { now: NOW, mode: "simulated", readers }),
      processInvoice(input, { now: NOW, mode: "simulated", readers }),
      processInvoice(await sampleInput("B01"), { now: NOW, mode: "simulated", readers }),
    ]);
    expect(stats.calls).toBe(3);
    expect(stats.maxActive).toBe(1);
    expect(a.decision.outcome).toBe("PAGAR");
    expect(b.decision.outcome).toBe("FRENAR");
    expect(b.decision.checks.find((x) => x.code === "DUP-1")?.status).toBe("fail");
    expect(c.decision.outcome).toBe("PAGAR");
    // El orden del registro es el orden de llegada.
    const exported = await exportDecisions();
    expect(exported.map((r) => r.id)).toEqual([a.id, b.id, c.id]);
  });

  it("withProcessingLock ejecuta en orden y sigue tras un error", async () => {
    const order: string[] = [];
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const results = await Promise.allSettled([
      withProcessingLock(async () => {
        await sleep(20);
        order.push("1");
        return 1;
      }),
      withProcessingLock(async () => {
        order.push("2");
        throw new Error("falla");
      }),
      withProcessingLock(async () => {
        order.push("3");
        return 3;
      }),
    ]);
    expect(order).toEqual(["1", "2", "3"]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
  });
});

describe("modo de lectura del registro", () => {
  it("en live, dos lecturas de caché (sin consumo) quedan como «cache»; con consumo, «live»", async () => {
    const manifest = loadManifest();
    const sim = createSimulatedReader({ id: "lector-a", manifest });
    const withUsage = (usage: boolean): Reader => ({
      ...sim,
      model: "claude-sonnet-5-5",
      async read(doc) {
        const r = await sim.read(doc);
        if (!r.ok) return r;
        return usage ? { ...r, model: "claude-sonnet-5-5", usage: { inputTokens: 10, outputTokens: 5 } } : { ...r, model: "claude-sonnet-5-5" };
      },
    });
    const cached = await processInvoice(await sampleInput("B02"), {
      now: NOW,
      mode: "live",
      readers: { primary: withUsage(false), secondary: withUsage(false) },
    });
    expect(cached.readingMode).toBe("cache");
    expect(cached.versions.models).toEqual(["claude-sonnet-5-5"]);
    const live = await processInvoice(await sampleInput("B01"), {
      now: NOW,
      mode: "live",
      readers: { primary: withUsage(true), secondary: withUsage(false) },
    });
    expect(live.readingMode).toBe("live");
  });
});

describe("muestras", () => {
  it("lista los casos con archivo y lee sus bytes", async () => {
    const samples = listSamples();
    expect(samples.length).toBe(readCaseRows().length);
    expect(samples[0]).toMatchObject({ caseId: "B01", filename: "B01.pdf", formato: "pdf", split: "train", escenario: "base" });
    const file = await readSample("B01");
    const entry = loadManifest().find((e) => e.caseId === "B01")!;
    expect(createHash("sha256").update(file!.bytes).digest("hex")).toBe(entry.sha256);
    expect(file!.mediaType).toBe("application/pdf");
  });

  it("no lee nada fuera del manifiesto", async () => {
    expect(await readSample("../company.json")).toBeNull();
    expect(await readSample("NOEXISTE")).toBeNull();
  });
});
