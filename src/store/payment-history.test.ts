/**
 * LIM-2 (límite del mes) y FON-1 (fondo) entre instancias: la base solo inserta un PAGAR si el
 * registro tiene los mismos pagos que el historial con que se decidió. Dos procesos que deciden sobre
 * el mismo historial y registran dos PAGAR distintos: el segundo se rechaza.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DbHandle } from "./db";
import { isPaymentHistoryChangedError, PaymentHistoryChangedError, isDuplicatePaymentError } from "./payment-keys";
import { createRepo, type Repo } from "./repo";
import { makeCompany, makeRecord, makeVendor, openFakeNeonDb, openMemoryDb, openTwoInstances } from "./test-helpers";

const COMPANY = makeCompany({ vendors: [makeVendor("v-uno"), makeVendor("v-dos")] });

/** Un PAGAR de un proveedor y número de factura propios (no chocan las claves de pago). */
function payment(id: string, vendorId: string, invoiceNumber: string) {
  return makeRecord({ id, decidedAt: "2026-10-17T10:00:00Z", vendorId, invoiceNumber, fileHash: `hash-${id}` });
}

describe.each([
  ["PGlite", openMemoryDb],
  ["Neon HTTP (simulado)", openFakeNeonDb],
] as const)("appendDecision con paymentsSeen sobre %s", (_label, open) => {
  let handle: DbHandle;
  let repo: Repo;

  beforeEach(async () => {
    handle = await open();
    repo = createRepo(handle);
    await repo.saveCompany(COMPANY);
  });
  afterEach(async () => {
    await handle.close();
  });

  it("inserta el PAGAR si el registro tiene los mismos pagos que vio", async () => {
    await repo.appendDecision(payment("d1", "v-uno", "F-1"), { paymentsSeen: 0 });
    await repo.appendDecision(payment("d2", "v-dos", "F-2"), { paymentsSeen: 1 });
    expect((await repo.exportDecisions()).map((r) => r.id)).toEqual(["d1", "d2"]);
  });

  it("rechaza el PAGAR si entretanto se registró otro pago, y no guarda nada", async () => {
    await repo.appendDecision(payment("d1", "v-uno", "F-1"), { paymentsSeen: 0 });
    const err = await repo.appendDecision(payment("d2", "v-dos", "F-2"), { paymentsSeen: 0 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PaymentHistoryChangedError);
    expect(isPaymentHistoryChangedError(err)).toBe(true);
    expect(err).toMatchObject({ decisionId: "d2", paymentsSeen: 0, paymentsNow: 1 });
    expect((await repo.exportDecisions()).map((r) => r.id)).toEqual(["d1"]);
  });

  it("si el pago que entró es equivalente (misma clave), lo dice como pago doble", async () => {
    await repo.appendDecision(payment("d1", "v-uno", "F-1"), { paymentsSeen: 0 });
    const err = await repo.appendDecision({ ...payment("d2", "v-uno", "F-1"), fileHash: "hash-d1" }, { paymentsSeen: 0 }).catch((e: unknown) => e);
    expect(isDuplicatePaymentError(err)).toBe(true);
    expect(err).toMatchObject({ kind: "file", decisionId: "d2" });
  });

  it("FRENAR y ESCALAR no dependen de los pagos vistos", async () => {
    await repo.appendDecision(payment("d1", "v-uno", "F-1"), { paymentsSeen: 0 });
    const held = makeRecord({ id: "d2", decidedAt: "2026-10-17T10:00:00Z", outcome: "ESCALAR", checks: { "PRV-1": "fail" } });
    await repo.appendDecision(held, { paymentsSeen: 0 });
    expect((await repo.exportDecisions()).map((r) => r.id)).toEqual(["d1", "d2"]);
  });

  it("paymentsSeen inválido es un error de programación", async () => {
    await expect(repo.appendDecision(payment("d1", "v-uno", "F-1"), { paymentsSeen: -1 })).rejects.toThrow(/paymentsSeen/);
    await expect(repo.appendDecision(payment("d1", "v-uno", "F-1"), { paymentsSeen: 1.5 })).rejects.toThrow(/paymentsSeen/);
    expect(await repo.exportDecisions()).toEqual([]);
  });

  it("sin paymentsSeen se inserta como antes", async () => {
    await repo.appendDecision(payment("d1", "v-uno", "F-1"));
    await repo.appendDecision(payment("d2", "v-dos", "F-2"));
    expect(await repo.exportDecisions()).toHaveLength(2);
  });
});

describe("dos instancias sobre la misma base", () => {
  let two: Awaited<ReturnType<typeof openTwoInstances>>;
  beforeEach(async () => {
    two = await openTwoInstances();
    await createRepo(two.a).saveCompany(COMPANY);
  });
  afterEach(async () => {
    await two.close();
  });

  it("las dos deciden sobre un historial sin pagos y registran a la vez: entra uno solo", async () => {
    const a = createRepo(two.a);
    const b = createRepo(two.b);
    const results = await Promise.allSettled([
      a.appendDecision(payment("dA", "v-uno", "F-1"), { paymentsSeen: 0 }),
      b.appendDecision(payment("dB", "v-dos", "F-2"), { paymentsSeen: 0 }),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(isPaymentHistoryChangedError(rejected[0].reason)).toBe(true);
    expect(await a.exportDecisions()).toHaveLength(1);
  });
});
