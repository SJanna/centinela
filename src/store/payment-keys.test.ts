/**
 * Protección contra el pago doble entre instancias: claves de pago con índice único.
 *
 * El candado de src/pipeline es por proceso. Aquí se simula la carrera entre dos procesos que
 * decidieron sobre el mismo historial y registran a la vez dos PAGAR equivalentes.
 */
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DecisionRecord } from "../core/schemas";
import { ensureSchema, type DbHandle } from "./db";
import { DuplicatePaymentError, isDuplicatePaymentError, paymentKeysOf } from "./payment-keys";
import { createRepo, type Repo } from "./repo";
import { makeCompany, makeRecord, makeVendor, openFakeNeonDb, openMemoryDb, openTwoInstances, type RecordSpec } from "./test-helpers";

async function rows<T>(handle: DbHandle, query: ReturnType<typeof sql>): Promise<T[]> {
  const res = (await handle.db.execute(query)) as unknown as { rows: T[] };
  return res.rows;
}

const ONCE_COMPANY = makeCompany({
  vendors: [
    makeVendor("v-uno", {
      agreements: [
        {
          id: "a-unico",
          description: "Implementación",
          kind: "one_off",
          currency: "USD",
          amount: 1000,
          rate: null,
          maxQuantity: null,
          frequency: "once",
          validFrom: "2026-01-01",
          validTo: null,
        },
      ],
    }),
  ],
});

/** Un PAGAR con valores propios en las tres claves, salvo los que se indiquen. */
function pay(id: string, spec: Partial<RecordSpec> = {}): DecisionRecord {
  return makeRecord({ id, decidedAt: "2026-10-16T10:00:00Z", outcome: "PAGAR", ...spec });
}

describe("paymentKeysOf", () => {
  it("un PAGAR tiene las tres claves", () => {
    expect(paymentKeysOf(pay("d1", { fileHash: " ABC123 ", invoiceNumber: "FE-0012", agreementId: "a-v-uno", agreementPeriod: "2026-10" }))).toEqual({
      file: "abc123",
      invoice: "v-uno|FE12",
      period: "a-v-uno|2026-10",
    });
  });

  it("FRENAR y ESCALAR no tienen claves", () => {
    for (const outcome of ["FRENAR", "ESCALAR"] as const) {
      expect(paymentKeysOf(makeRecord({ id: "d1", decidedAt: "2026-10-16", outcome }))).toEqual({ file: null, invoice: null, period: null });
    }
  });

  it("el número de factura se normaliza como en el motor", () => {
    const key = (invoiceNumber: string) => paymentKeysOf(pay("d1", { invoiceNumber })).invoice;
    for (const variant of ["FE-0012", "fe 12", "FE0012", "Fé-012", "ＦＥ－００１２", "FE-１２"]) expect(key(variant), variant).toBe("v-uno|FE12");
    expect(key("FE-0012-A")).toBe("v-uno|FE12A");
    expect(key("FE-120")).toBe("v-uno|FE120");
    expect(key("000")).toBe("v-uno|0");
  });

  it("el periodo se normaliza como en el motor y un acuerdo de pago único usa «once»", () => {
    expect(paymentKeysOf(pay("d1", { agreementId: "a-v-uno", agreementPeriod: " 2026-10-05 " })).period).toBe("a-v-uno|2026-10");
    expect(paymentKeysOf(pay("d1", { agreementId: "a-unico", agreementPeriod: null, company: ONCE_COMPANY })).period).toBe("a-unico|once");
    // Aunque traiga periodo, un acuerdo único se paga una vez.
    expect(paymentKeysOf(pay("d1", { agreementId: "a-unico", agreementPeriod: "2026-11", company: ONCE_COMPANY })).period).toBe("a-unico|once");
  });
});

describe.each([
  ["PGlite", openMemoryDb],
  ["Neon HTTP (simulado)", openFakeNeonDb],
] as const)("claves de pago sobre %s", (_label, open) => {
  let handle: DbHandle;
  let repo: Repo;

  beforeEach(async () => {
    handle = await open();
    repo = createRepo(handle);
  });
  afterEach(async () => {
    await handle.close();
  });

  const collisions: [string, Partial<RecordSpec>, Partial<RecordSpec>, DuplicatePaymentError["kind"]][] = [
    ["el mismo archivo", { fileHash: "h-igual" }, { fileHash: " H-IGUAL" }, "file"],
    ["el mismo número de factura del mismo proveedor", { invoiceNumber: "FE-0012" }, { invoiceNumber: "fe 12" }, "invoice"],
    ["el mismo acuerdo y periodo", { agreementId: "a-v-uno", agreementPeriod: "2026-10" }, { agreementId: "a-v-uno", agreementPeriod: "2026-10" }, "period"],
    [
      "el mismo acuerdo de pago único en otro periodo",
      { agreementId: "a-unico", agreementPeriod: null, company: ONCE_COMPANY },
      { agreementId: "a-unico", agreementPeriod: "2026-11", company: ONCE_COMPANY },
      "period",
    ],
  ];

  it.each(collisions)("rechaza un segundo PAGAR con %s", async (_name, first, second, kind) => {
    await repo.appendDecision(pay("d1", { invoiceId: "inv-1", ...first }));
    const err = await repo.appendDecision(pay("d2", { invoiceId: "inv-2", ...second })).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(DuplicatePaymentError);
    expect(isDuplicatePaymentError(err)).toBe(true);
    const dup = err as DuplicatePaymentError;
    expect(dup.kind).toBe(kind);
    expect(dup.decisionId).toBe("d2");
    expect(dup.conflictingInvoiceId).toBe("inv-1");
    expect(dup.message).toMatch(/Ya hay un pago registrado/);
    expect((await repo.exportDecisions()).map((r) => r.id)).toEqual(["d1"]);
  });

  it("FRENAR y ESCALAR no chocan con un pago ni entre sí", async () => {
    const same = { fileHash: "h", invoiceNumber: "F-1", agreementId: "a-v-uno", agreementPeriod: "2026-10" };
    await repo.appendDecision(makeRecord({ id: "f1", decidedAt: "2026-10-16T09:00:00Z", outcome: "FRENAR", ...same }));
    await repo.appendDecision(makeRecord({ id: "e1", decidedAt: "2026-10-16T09:30:00Z", outcome: "ESCALAR", ...same }));
    await repo.appendDecision(pay("p1", same));
    await repo.appendDecision(makeRecord({ id: "f2", decidedAt: "2026-10-16T11:00:00Z", outcome: "FRENAR", ...same }));
    expect(await repo.exportDecisions()).toHaveLength(4);
  });

  it("pagos distintos no chocan: otro proveedor con el mismo número, otro periodo del mismo acuerdo", async () => {
    await repo.appendDecision(pay("p1", { invoiceNumber: "F-1", agreementId: "a-v-uno", agreementPeriod: "2026-09" }));
    await repo.appendDecision(pay("p2", { vendorId: "v-dos", invoiceNumber: "F-1", agreementId: "a-v-dos" }));
    await repo.appendDecision(pay("p3", { invoiceNumber: "F-2", agreementId: "a-v-uno", agreementPeriod: "2026-10" }));
    expect(await repo.exportDecisions()).toHaveLength(3);
  });

  it("el reinicio de la demostración libera las claves", async () => {
    await repo.appendDecision(pay("p1", { fileHash: "h" }));
    await repo.resetAll(makeCompany());
    await repo.appendDecision(pay("p2", { fileHash: "h" }));
    expect((await repo.exportDecisions()).map((r) => r.id)).toEqual(["p2"]);
  });

  it("un id repetido sigue dando el error de id, no el de pago doble", async () => {
    await repo.appendDecision(pay("p1"));
    const err = await repo.appendDecision(pay("p1")).catch((e: unknown) => e);
    expect(isDuplicatePaymentError(err)).toBe(false);
    expect((err as Error).message).toMatch(/Ya existe una decisión con id/);
  });
});

describe("carrera entre dos instancias sobre la misma base", () => {
  let instances: Awaited<ReturnType<typeof openTwoInstances>>;
  beforeEach(async () => {
    instances = await openTwoInstances();
  });
  afterEach(async () => {
    await instances.close();
  });

  it("dos PAGAR equivalentes a la vez: se registra uno y el otro recibe DuplicatePaymentError", async () => {
    const a = createRepo(instances.a);
    const b = createRepo(instances.b);
    // Las dos decidieron sobre el mismo historial vacío: misma factura, subida dos veces.
    const same = { fileHash: "h-factura", invoiceNumber: "FE-1001", agreementId: "a-v-uno", agreementPeriod: "2026-10" };
    const results = await Promise.allSettled([
      a.appendDecision(pay("dec_a", { invoiceId: "inv_a", ...same })),
      b.appendDecision(pay("dec_b", { invoiceId: "inv_b", ...same })),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(isDuplicatePaymentError(rejected[0].reason)).toBe(true);
    const history = await a.getHistory();
    expect(history.filter((h) => h.outcome === "PAGAR")).toHaveLength(1);
    expect(await b.getHistory()).toEqual(history);
  });

  it("también con números escritos distinto y archivos distintos (la misma factura reenviada)", async () => {
    const a = createRepo(instances.a);
    const b = createRepo(instances.b);
    const results = await Promise.allSettled([
      a.appendDecision(pay("dec_a", { fileHash: "h-pdf", invoiceNumber: "FE-0012", agreementId: "a-v-uno", agreementPeriod: "2026-10" })),
      b.appendDecision(pay("dec_b", { fileHash: "h-foto", invoiceNumber: "fe 12", agreementId: "a-v-uno", agreementPeriod: "2026-11" })),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    const reason = (results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason as DuplicatePaymentError;
    expect(reason.kind).toBe("invoice");
  });
});

describe.each([
  ["PGlite", openMemoryDb],
  ["Neon HTTP (simulado)", openFakeNeonDb],
] as const)("migración de una base anterior sobre %s", (_label, open) => {
  let handle: DbHandle;
  beforeEach(async () => {
    handle = await open();
  });
  afterEach(async () => {
    await handle.close();
  });

  /** Deja la base como antes de las claves de pago: sin columnas, sin índices y con el disparador viejo. */
  async function downgrade(): Promise<void> {
    for (const stmt of [
      `CREATE OR REPLACE FUNCTION centinela_decisions_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'El registro de decisiones es inmutable: no se permite % sobre decisions', TG_OP; END $$`,
      `DROP INDEX IF EXISTS decisions_pay_file_key_uq`,
      `DROP INDEX IF EXISTS decisions_pay_invoice_key_uq`,
      `DROP INDEX IF EXISTS decisions_pay_period_key_uq`,
      `ALTER TABLE decisions DROP COLUMN pay_file_key, DROP COLUMN pay_invoice_key, DROP COLUMN pay_period_key`,
    ]) {
      await handle.db.execute(sql.raw(stmt));
    }
  }

  /** Inserta como lo hacía la versión anterior (sin columnas de claves). */
  async function insertOld(record: DecisionRecord): Promise<void> {
    await handle.db.execute(
      sql`INSERT INTO decisions (id, invoice_id, decided_at, outcome, record)
          VALUES (${record.id}, ${record.invoiceId}, ${record.decidedAt}, ${record.decision.outcome}, ${JSON.stringify(record)}::jsonb)`,
    );
  }

  async function keysById(): Promise<Record<string, [string | null, string | null, string | null]>> {
    const list = await rows<{ id: string; f: string | null; i: string | null; p: string | null }>(
      handle,
      sql`SELECT id, pay_file_key AS f, pay_invoice_key AS i, pay_period_key AS p FROM decisions ORDER BY seq`,
    );
    return Object.fromEntries(list.map((r) => [r.id, [r.f, r.i, r.p]]));
  }

  it("agrega las columnas, rellena los PAGAR guardados y crea los índices únicos", async () => {
    await downgrade();
    await insertOld(pay("p1", { decidedAt: "2026-10-01T10:00:00Z", fileHash: "h1", invoiceNumber: "F-1", agreementId: "a-v-uno", agreementPeriod: "2026-09" }));
    await insertOld(makeRecord({ id: "f1", decidedAt: "2026-10-02T10:00:00Z", outcome: "FRENAR", fileHash: "h1" }));
    // Un pago doble anterior a la protección: misma factura con otro archivo. Solo el primero recibe
    // la clave que comparten; crear el índice no falla.
    await insertOld(pay("p2", { decidedAt: "2026-10-03T10:00:00Z", fileHash: "h2", invoiceNumber: "f 01", agreementId: "a-v-uno", agreementPeriod: "2026-10" }));

    await ensureSchema(handle);

    expect(await keysById()).toEqual({
      p1: ["h1", "v-uno|F1", "a-v-uno|2026-09"],
      f1: [null, null, null],
      p2: ["h2", null, "a-v-uno|2026-10"],
    });
    const indexes = await rows<{ indexname: string; indexdef: string }>(
      handle,
      sql`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'decisions' AND indexname LIKE 'decisions_pay_%' ORDER BY indexname`,
    );
    expect(indexes.map((i) => i.indexname)).toEqual(["decisions_pay_file_key_uq", "decisions_pay_invoice_key_uq", "decisions_pay_period_key_uq"]);
    expect(indexes.every((i) => /UNIQUE/.test(i.indexdef))).toBe(true);

    // Ya protegida: un nuevo PAGAR de la factura F-1 choca con p1.
    const repo = createRepo(handle);
    const err = await repo.appendDecision(pay("p3", { fileHash: "h3", invoiceNumber: "F-001", agreementId: "a-v-uno", agreementPeriod: "2026-11" })).catch((e: unknown) => e);
    expect(isDuplicatePaymentError(err)).toBe(true);
    expect((err as DuplicatePaymentError).conflictingInvoiceId).toBe("inv-p1");

    // Repetir la migración no cambia nada.
    await ensureSchema(handle);
    expect((await keysById()).p2).toEqual(["h2", null, "a-v-uno|2026-10"]);
  });

  it("después de migrar, el registro sigue siendo inmutable (la excepción es solo para rellenar claves vacías)", async () => {
    await downgrade();
    await insertOld(pay("p1", { fileHash: "h1" }));
    await insertOld(makeRecord({ id: "f1", decidedAt: "2026-10-02T10:00:00Z", outcome: "FRENAR" }));
    await ensureSchema(handle);

    await expect(handle.db.execute(sql`UPDATE decisions SET outcome = 'FRENAR' WHERE id = 'p1'`)).rejects.toThrow();
    await expect(handle.db.execute(sql`UPDATE decisions SET pay_file_key = NULL WHERE id = 'p1'`)).rejects.toThrow();
    await expect(handle.db.execute(sql`DELETE FROM decisions`)).rejects.toThrow();
    // Ni siquiera con la marca de la migración: p1 ya tiene claves y f1 no es un PAGAR.
    await expect(
      handle.atomic((db) => [
        db.execute(sql`SELECT set_config('centinela.fill_pay_keys', 'on', true)`),
        db.execute(sql`UPDATE decisions SET pay_file_key = 'otra' WHERE id = 'p1'`),
      ]),
    ).rejects.toThrow();
    await expect(
      handle.atomic((db) => [
        db.execute(sql`SELECT set_config('centinela.fill_pay_keys', 'on', true)`),
        db.execute(sql`UPDATE decisions SET pay_file_key = 'bloquear' WHERE id = 'f1'`),
      ]),
    ).rejects.toThrow();
    expect(await keysById()).toEqual({ p1: ["h1", "v-uno|FP1", "a-v-uno-p1|2026-10"], f1: [null, null, null] });
  });
});
