/**
 * Pago doble entre instancias: otra instancia registra un pago equivalente entre la lectura del
 * historial y la inserción de esta. El candado es por proceso, así que eso solo lo frena la base
 * (claves de pago con índice único). Base en memoria (PGLITE_DIR=memory) y lectores simulados.
 *
 * Para simular la carrera, `getHistory` se envuelve: después de leer el historial corre la «otra
 * instancia» (un processInvoice anidado, que el candado reentrante deja pasar) y devuelve el
 * historial ya viejo.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DecisionRecord, HistoryEntry } from "../core/schemas";
import { exportDecisions, getCompany, resetDbForTests, saveRules } from "../store";
import { readSample, resetDemo } from "./demo";
import { processInvoice } from "./process";

process.env.PGLITE_DIR = "memory";

const race = vi.hoisted(() => ({
  /** Corre una vez, justo después de la próxima lectura del historial. */
  afterNextHistoryRead: null as null | (() => Promise<void>),
  /** Si no es null, getHistory devuelve siempre esto (un historial que no se entera de nada). */
  frozenHistory: null as null | HistoryEntry[],
  reads: 0,
}));

vi.mock("../store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../store")>();
  return {
    ...actual,
    async getHistory(): Promise<HistoryEntry[]> {
      race.reads++;
      const history = race.frozenHistory ?? (await actual.getHistory());
      const hook = race.afterNextHistoryRead;
      if (hook) {
        race.afterNextHistoryRead = null;
        await hook();
      }
      return history;
    },
  };
});

const NOW = "2026-10-20T15:00:00Z";

async function sampleInput(caseId: string) {
  const sample = await readSample(caseId);
  if (!sample) throw new Error(`No hay archivo de ejemplo para ${caseId}`);
  return { bytes: sample.bytes, filename: sample.filename, mediaType: sample.mediaType };
}

/** Programa la otra instancia: procesa `caseId` en cuanto esta haya leído el historial. */
function otherInstanceProcesses(caseId: string): { result: () => DecisionRecord } {
  let other: DecisionRecord | undefined;
  race.afterNextHistoryRead = async () => {
    other = await processInvoice(await sampleInput(caseId), { now: NOW, mode: "simulated" });
  };
  return {
    result: () => {
      if (!other) throw new Error("la otra instancia no corrió");
      return other;
    },
  };
}

const statusOf = (record: DecisionRecord, code: string) => record.decision.checks.find((c) => c.code === code)?.status;

beforeEach(async () => {
  await resetDbForTests();
  await resetDemo();
  race.afterNextHistoryRead = null;
  race.frozenHistory = null;
  race.reads = 0;
});

afterEach(() => {
  race.afterNextHistoryRead = null;
  race.frozenHistory = null;
});

afterAll(async () => {
  await resetDbForTests();
});

describe("processInvoice · pago doble entre instancias", () => {
  it("el mismo archivo: la base rechaza el segundo PAGAR y al volver a decidir se frena por DUP-1", async () => {
    const other = otherInstanceProcesses("B02");
    const mine = await processInvoice(await sampleInput("B02"), { now: NOW, mode: "simulated" });

    expect(other.result().decision.outcome).toBe("PAGAR");
    expect(mine.decision.outcome).toBe("FRENAR");
    expect(statusOf(mine, "DUP-1")).toBe("fail");
    expect(mine.decision.summary).not.toMatch(/base de datos/);
    // Se leyó el historial tres veces: esta instancia, la otra y el reintento de esta.
    expect(race.reads).toBe(3);

    const exported = await exportDecisions();
    expect(exported.map((r) => r.id)).toEqual([other.result().id, mine.id]);
    expect(exported.filter((r) => r.decision.outcome === "PAGAR")).toHaveLength(1);
  });

  it("la misma factura en otro archivo (correo): se frena por DUP-2", async () => {
    const other = otherInstanceProcesses("B02");
    const mine = await processInvoice(await sampleInput("B08"), { now: NOW, mode: "simulated" });
    expect(other.result().decision.outcome).toBe("PAGAR");
    expect(mine.decision.outcome).toBe("FRENAR");
    expect(statusOf(mine, "DUP-2")).toBe("fail");
    expect((await exportDecisions()).filter((r) => r.decision.outcome === "PAGAR")).toHaveLength(1);
  });

  it("otra factura del mismo acuerdo y mes: se frena por DUP-3", async () => {
    const other = otherInstanceProcesses("B01");
    const mine = await processInvoice(await sampleInput("B06"), { now: NOW, mode: "simulated" });
    expect(other.result().decision.outcome).toBe("PAGAR");
    expect(mine.decision.outcome).toBe("FRENAR");
    expect(statusOf(mine, "DUP-3")).toBe("fail");
  });

  it("si la base vuelve a rechazar el pago, registra ESCALAR con la explicación", async () => {
    // Un historial que nunca se entera del otro pago: el motor dice PAGAR las dos veces.
    race.frozenHistory = [];
    const other = otherInstanceProcesses("B02");
    const mine = await processInvoice(await sampleInput("B02"), { now: NOW, mode: "simulated" });

    const otherInvoice = other.result().invoiceId;
    expect(mine.decision.outcome).toBe("ESCALAR");
    expect(mine.decision.guardOverride).toBe(false);
    expect(mine.decision.summary).toBe(
      `Se escala a una persona: la base de datos rechazó el pago porque ya hay otro registrado con el mismo archivo (factura ${otherInvoice}).`,
    );
    expect(mine.decision.humanAction).toMatch(new RegExp(`pago ya registrado \\(factura ${otherInvoice}\\)`));
    const dup1 = mine.decision.checks.find((c) => c.code === "DUP-1")!;
    expect(dup1.status).toBe("not_evaluable");
    expect(dup1.explanation).toMatch(/la base de datos encontró otro pago con el mismo archivo/);
    expect(mine.decision.checks.filter((c) => c.status !== "pass").map((c) => c.code)).toEqual(["DUP-1"]);

    const exported = await exportDecisions();
    expect(exported.map((r) => [r.id, r.decision.outcome])).toEqual([
      [other.result().id, "PAGAR"],
      [mine.id, "ESCALAR"],
    ]);
  });

  it("otra factura que entra mientras se decide y juntas pasan el límite del mes: la base rechaza el PAGAR y al volver a decidir se escala por LIM-2", async () => {
    // B01 (COP 12.000.000 ≈ USD 3.000) y B02 (USD 1.200): cada una cabe en USD 4.000, juntas no.
    const company = (await getCompany())!;
    await saveRules({ ...company.rules, periodLimitUsd: 4000 });
    const other = otherInstanceProcesses("B01");
    const mine = await processInvoice(await sampleInput("B02"), { now: NOW, mode: "simulated" });

    expect(other.result().decision.outcome).toBe("PAGAR");
    expect(mine.decision.outcome).toBe("ESCALAR");
    expect(statusOf(mine, "LIM-2")).toBe("fail");
    expect(race.reads).toBe(3);
    const paid = (await exportDecisions()).filter((r) => r.decision.outcome === "PAGAR");
    expect(paid.map((r) => r.id)).toEqual([other.result().id]);
  });

  it("otra factura que entra mientras se decide y juntas pasan el fondo: se frena por FON-1", async () => {
    const company = (await getCompany())!;
    await saveRules({ ...company.rules, initialFundUsd: 4000 });
    const other = otherInstanceProcesses("B01");
    const mine = await processInvoice(await sampleInput("B02"), { now: NOW, mode: "simulated" });

    expect(other.result().decision.outcome).toBe("PAGAR");
    expect(mine.decision.outcome).toBe("FRENAR");
    expect(statusOf(mine, "FON-1")).toBe("fail");
    expect((await exportDecisions()).filter((r) => r.decision.outcome === "PAGAR")).toHaveLength(1);
  });

  it("si entra otro pago y el historial nunca se entera, registra ESCALAR con LIM-2 y FON-1 sin evaluar", async () => {
    race.frozenHistory = [];
    const other = otherInstanceProcesses("B01");
    const mine = await processInvoice(await sampleInput("B02"), { now: NOW, mode: "simulated" });

    expect(other.result().decision.outcome).toBe("PAGAR");
    expect(mine.decision.outcome).toBe("ESCALAR");
    expect(mine.decision.guardOverride).toBe(false);
    expect(mine.decision.summary).toBe(
      "Se escala a una persona: mientras se decidía se registraron otros pagos y no se pudo confirmar el límite del mes ni el fondo.",
    );
    expect(mine.decision.checks.filter((c) => c.status !== "pass").map((c) => c.code)).toEqual(["LIM-2", "FON-1"]);
    expect(mine.decision.checks.find((c) => c.code === "LIM-2")!.explanation).toMatch(/pagos registrados mientras se decidía/);
    const exported = await exportDecisions();
    expect(exported.map((r) => [r.id, r.decision.outcome])).toEqual([
      [other.result().id, "PAGAR"],
      [mine.id, "ESCALAR"],
    ]);
  });

  it("dos facturas distintas sin carrera se pagan las dos (la condición no estorba)", async () => {
    const a = await processInvoice(await sampleInput("B01"), { now: NOW, mode: "simulated" });
    const b = await processInvoice(await sampleInput("B02"), { now: NOW, mode: "simulated" });
    expect([a.decision.outcome, b.decision.outcome]).toEqual(["PAGAR", "PAGAR"]);
    expect(race.reads).toBe(2);
  });

  it("sin carrera no hay reintento", async () => {
    const record = await processInvoice(await sampleInput("B02"), { now: NOW, mode: "simulated" });
    expect(record.decision.outcome).toBe("PAGAR");
    expect(race.reads).toBe(1);
  });
});
