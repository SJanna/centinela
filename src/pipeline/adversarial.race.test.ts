/**
 * Revisión adversarial · concurrencia: muchas facturas a la vez en el mismo proceso (como varias
 * subidas simultáneas a POST /api/invoices). Ni el mismo archivo se paga dos veces ni un grupo de
 * facturas distintas supera juntas el límite del mes o el fondo. Base en memoria y lectura simulada.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { DecisionRecord } from "../core/schemas";
import { toCents } from "../core/normalize";
import { exportDecisions, resetDbForTests, saveRules } from "../store";
import { loadDatasetCompany } from "./dataset";
import { readSample, resetDemo } from "./demo";
import { processInvoice } from "./process";

process.env.PGLITE_DIR = "memory";

const NOW = "2026-10-20T15:00:00Z";
/** Casos del dataset que, solos y con el historial vacío, se pagan (proveedores distintos). */
const PAYABLE = ["B01", "B02", "B03", "B04", "B05", "B15", "B19", "B20", "B21"];

async function upload(caseId: string): Promise<DecisionRecord> {
  const sample = await readSample(caseId);
  if (!sample) throw new Error(`No hay archivo de ejemplo para ${caseId}`);
  return processInvoice({ bytes: sample.bytes, filename: sample.filename, mediaType: sample.mediaType }, { now: NOW, mode: "simulated" });
}

const paidCents = (records: DecisionRecord[]) =>
  records.filter((r) => r.decision.outcome === "PAGAR").reduce((sum, r) => sum + toCents(r.decision.amountUsd ?? 0), 0);

beforeEach(async () => {
  await resetDbForTests();
  await resetDemo();
});

afterAll(async () => {
  await resetDbForTests();
});

describe("concurrencia · subidas simultáneas", () => {
  it("el mismo archivo 8 veces a la vez: un solo PAGAR, el resto FRENAR por DUP-1", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => upload("B02")));
    expect(results.filter((r) => r.decision.outcome === "PAGAR")).toHaveLength(1);
    expect(results.filter((r) => r.decision.outcome === "FRENAR")).toHaveLength(7);
    const stored = await exportDecisions();
    expect(stored).toHaveLength(8);
    expect(stored.filter((r) => r.decision.outcome === "PAGAR")).toHaveLength(1);
  });

  it("facturas distintas que juntas pasan el límite del mes: lo pagado no supera el límite", async () => {
    const rules = { ...loadDatasetCompany().rules, periodLimitUsd: 6000 };
    await saveRules(rules);
    const results = await Promise.all(PAYABLE.map(upload));
    const stored = await exportDecisions();
    expect(paidCents(stored)).toBeLessThanOrEqual(toCents(6000));
    expect(results.some((r) => r.decision.outcome === "ESCALAR" && r.decision.checks.some((c) => c.code === "LIM-2" && c.status === "fail"))).toBe(true);
  });

  it("facturas distintas que juntas pasan el fondo: lo pagado no supera el fondo", async () => {
    const rules = { ...loadDatasetCompany().rules, initialFundUsd: 4000 };
    await saveRules(rules);
    const results = await Promise.all(PAYABLE.map(upload));
    const stored = await exportDecisions();
    expect(paidCents(stored)).toBeLessThanOrEqual(toCents(4000));
    expect(results.some((r) => r.decision.outcome === "FRENAR" && r.decision.checks.some((c) => c.code === "FON-1" && c.status === "fail"))).toBe(true);
  });
});
