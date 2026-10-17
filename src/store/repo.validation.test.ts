/**
 * Pruebas de la revisión: validación en la frontera de la base de datos.
 *
 * El registro de decisiones es inmutable y alimenta al motor y a la guardia (DUP-1..3, LIM-2, FON-1).
 * Un registro mal formado no se puede corregir después: o se rechaza al guardarlo, o queda para siempre.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Company, DecisionRecord } from "../core/schemas";
import type { DbHandle } from "./db";
import { createRepo, type Repo } from "./repo";
import { makeCompany, makeExtraction, makeRecord, makeVendor, openFakeNeonDb, openMemoryDb } from "./test-helpers";

const NOW = "2026-10-20T12:00:00.000Z";

/** El error con que se rechaza la promesa (falla la prueba si se resuelve). */
async function errorOf(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(Error);
    return err as Error;
  }
  throw new Error("se esperaba un rechazo");
}

describe.each([
  ["PGlite", openMemoryDb],
  ["Neon HTTP (simulado)", openFakeNeonDb],
] as const)("validación del repositorio sobre %s", (_label, open) => {
  let handle: DbHandle;
  let repo: Repo;

  beforeEach(async () => {
    handle = await open();
    repo = createRepo(handle);
  });
  afterEach(async () => {
    await handle.close();
  });

  describe("decidedAt debe ser una fecha ISO 8601 real", () => {
    it("rechaza fechas que JavaScript y Postgres aceptan pero que no son ISO (rompen el mes de LIM-2)", async () => {
      // "10/16/2026" lo aceptan Date.parse y Postgres, pero monthOf() da "10/16/2" y el pago no se cuenta en octubre.
      await expect(
        repo.appendDecision(makeRecord({ id: "d1", decidedAt: "10/16/2026 10:00:00", outcome: "PAGAR", amountUsd: 20000 })),
      ).rejects.toThrow(/decidedAt no es una fecha ISO/);
      expect(await repo.exportDecisions()).toEqual([]);
      expect((await repo.getStats(NOW)).monthSpentUsd).toBe(0);
    });

    it("rechaza días que no existen con un mensaje en español (no un error de Postgres)", async () => {
      // Date.parse("2026-02-30…") devuelve una fecha (2 de marzo); Postgres la rechaza con un error en inglés.
      await expect(repo.appendDecision(makeRecord({ id: "d1", decidedAt: "2026-02-30T10:00:00Z" }))).rejects.toThrow(
        /decidedAt no es una fecha ISO/,
      );
      await expect(repo.appendDecision(makeRecord({ id: "d2", decidedAt: "2026-13-01T10:00:00Z" }))).rejects.toThrow(
        /decidedAt no es una fecha ISO/,
      );
      expect(await repo.exportDecisions()).toEqual([]);
    });

    it("acepta las formas ISO habituales", async () => {
      await repo.appendDecision(makeRecord({ id: "a", decidedAt: "2026-10-16" }));
      await repo.appendDecision(makeRecord({ id: "b", decidedAt: "2026-10-16T10:00:00Z" }));
      await repo.appendDecision(makeRecord({ id: "c", decidedAt: "2026-10-16T10:00:00.123-05:00" }));
      await repo.appendDecision(makeRecord({ id: "d", decidedAt: "2026-10-16T10:00" }));
      expect(await repo.getHistory()).toHaveLength(4);
    });
  });

  describe("una decisión PAGAR solo se registra si cumple las invariantes", () => {
    const pay = (extra: Partial<Parameters<typeof makeRecord>[0]> = {}): DecisionRecord =>
      makeRecord({ id: "p1", decidedAt: "2026-10-16T10:00:00Z", outcome: "PAGAR", ...extra });

    const cases: [string, () => DecisionRecord, RegExp][] = [
      ["una comprobación en fail", () => pay({ checks: { "LIM-2": "fail" } }), /comprobaciones/],
      ["una comprobación no evaluable", () => pay({ checks: { "FON-1": "not_evaluable" } }), /comprobaciones/],
      [
        "faltan comprobaciones",
        () => {
          const r = pay();
          r.decision.checks = r.decision.checks.filter((c) => c.code !== "DUP-1");
          return r;
        },
        /comprobaciones/,
      ],
      [
        "sin revisión de la guardia",
        () => {
          const r = pay();
          r.decision.guard = null;
          return r;
        },
        /guardia/,
      ],
      [
        "la guardia no aprobó",
        () => {
          const r = pay();
          r.decision.guard = { approved: false, violations: ["el periodo ya se pagó"] };
          return r;
        },
        /guardia/,
      ],
      ["la guardia contradijo al motor", () => pay({ guardOverride: true }), /guardia/],
      ["sin monto en USD", () => pay({ amountUsd: null }), /amountUsd/],
      ["monto NaN", () => pay({ amountUsd: Number.NaN }), /amountUsd/],
      ["monto infinito", () => pay({ amountUsd: Number.POSITIVE_INFINITY }), /amountUsd/],
      ["monto negativo", () => pay({ amountUsd: -500 }), /amountUsd/],
      ["sin proveedor", () => pay({ vendorId: null, agreementId: "a-v-uno" }), /vendorId/],
      ["sin acuerdo", () => pay({ agreementId: null }), /agreementId/],
      ["sin lectura", () => pay({ readingFailed: true }), /número de factura/],
      ["sin número de factura", () => pay({ invoiceNumber: null }), /número de factura/],
      ["sin huella de archivo", () => pay({ fileHash: "" }), /fileHash/],
    ];

    it.each(cases)("rechaza un PAGAR %s", async (_name, build, message) => {
      await expect(repo.appendDecision(build())).rejects.toThrow(message);
      expect(await repo.exportDecisions()).toEqual([]);
      const stats = await repo.getStats(NOW);
      expect(stats.paidUsd).toBe(0);
      expect(stats.byOutcome.PAGAR).toBe(0);
    });

    it("un PAGAR válido se registra y cuenta", async () => {
      await repo.saveCompany(makeCompany());
      await repo.appendDecision(pay({ amountUsd: 0 }));
      await repo.appendDecision(makeRecord({ id: "p2", decidedAt: "2026-10-17T10:00:00Z", amountUsd: 1234.56 }));
      expect((await repo.getStats(NOW)).paidUsd).toBe(1234.56);
    });

    it("FRENAR y ESCALAR se registran aunque tengan comprobaciones fallidas o datos faltantes", async () => {
      const escalar = makeRecord({
        id: "e1",
        decidedAt: "2026-10-16T10:00:00Z",
        outcome: "ESCALAR",
        readingFailed: true,
        vendorId: null,
        agreementId: null,
        amountUsd: Number.NaN, // p. ej. moneda sin tasa: se guarda como null
        checks: { "LEC-1": "fail", "ACU-3": "not_evaluable" },
        guardOverride: true,
      });
      escalar.decision.guard = { approved: false, violations: ["x"] };
      const frenar = makeRecord({ id: "f1", decidedAt: "2026-10-16T11:00:00Z", outcome: "FRENAR", checks: { "DUP-1": "fail" }, fileHash: "" });
      await repo.appendDecision(escalar);
      await repo.appendDecision(frenar);
      const history = await repo.getHistory();
      expect(history.map((h) => [h.outcome, h.amountUsd])).toEqual([
        ["ESCALAR", null],
        ["FRENAR", 1000],
      ]);
    });
  });

  describe("amountUsd debe ser número o null en cualquier decisión", () => {
    it("rechaza un texto: si se guardara, getStats fallaría para siempre (el registro no se puede borrar)", async () => {
      const bad = makeRecord({ id: "e1", decidedAt: "2026-10-16T10:00:00Z", outcome: "ESCALAR" });
      (bad.decision as { amountUsd: unknown }).amountUsd = "mil dólares";
      await expect(repo.appendDecision(bad)).rejects.toThrow(/amountUsd/);
      await expect(repo.getStats(NOW)).resolves.toMatchObject({ total: 0 });
    });

    it("aunque un registro con monto no numérico llegue a la tabla, getStats no falla y no lo suma", async () => {
      const { decisions } = await import("./schema");
      const bad = makeRecord({ id: "e1", decidedAt: "2026-10-16T10:00:00Z", outcome: "PAGAR" });
      (bad.decision as { amountUsd: unknown }).amountUsd = "mil dólares";
      // Escritura directa, sin pasar por appendDecision (p. ej. un dato antiguo o un script).
      await handle.db.insert(decisions).values({ id: bad.id, invoiceId: bad.invoiceId, decidedAt: bad.decidedAt, outcome: "PAGAR", record: bad });
      await repo.appendDecision(makeRecord({ id: "p2", decidedAt: "2026-10-17T10:00:00Z", amountUsd: 10 }));
      const stats = await repo.getStats(NOW);
      expect(stats.byOutcome.PAGAR).toBe(2);
      expect(stats.paidUsd).toBe(10);
      expect(stats.monthSpentUsd).toBe(10);
    });
  });

  describe("getStats", () => {
    it("rechaza un `now` que no es fecha ISO en vez de calcular un mes sin sentido", async () => {
      await expect(repo.getStats("ayer")).rejects.toThrow(/now no es una fecha ISO/);
      await expect(repo.getStats("Fri Oct 16 2026")).rejects.toThrow(/now no es una fecha ISO/);
    });
  });

  describe("listDecisions", () => {
    it("un límite con decimales o negativo no devuelve todo el registro", async () => {
      for (let i = 1; i <= 5; i++) {
        await repo.appendDecision(makeRecord({ id: `d${i}`, decidedAt: `2026-10-0${i}T10:00:00Z` }));
      }
      expect((await repo.listDecisions({ limit: 2.7 })).map((d) => d.id)).toEqual(["d5", "d4"]);
      expect(await repo.listDecisions({ limit: -1 })).toEqual([]);
      expect(await repo.listDecisions({ limit: Number.NaN })).toHaveLength(5);
    });
  });

  describe("los errores de validación se muestran en español", () => {
    const english = /Invalid input|expected|received|Required/;

    it("empresa, reglas y proveedores", async () => {
      const company = makeCompany();
      const badCompany = { ...company, rules: { ...company.rules, periodLimitUsd: "mucho" } } as unknown as Company;
      const err1 = await errorOf(repo.saveCompany(badCompany));
      expect(err1.message).toMatch(/La empresa no es válida/);
      expect(err1.message).toMatch(/rules\.periodLimitUsd/);
      expect(err1.message).not.toMatch(english);

      const err2 = await errorOf(repo.resetAll(badCompany));
      expect(err2.message).toMatch(/La empresa no es válida/);
      expect(err2.message).not.toMatch(english);

      await repo.saveCompany(company);
      const err3 = await errorOf(repo.saveRules({ ...company.rules, fxToUsd: { USD: "uno" } } as never));
      expect(err3.message).toMatch(/Las reglas no son válidas/);
      expect(err3.message).not.toMatch(english);

      const err4 = await errorOf(repo.upsertVendor({ ...makeVendor("v-x"), account: undefined } as never));
      expect(err4.message).toMatch(/El proveedor no es válido/);
      expect(err4.message).not.toMatch(english);

      const err5 = await errorOf(repo.replaceVendors([makeVendor("v-a"), { id: "roto" } as never]));
      expect(err5.message).toMatch(/La lista de proveedores no es válida/);
      expect(err5.message).toMatch(/1\.name/);
      expect(err5.message).not.toMatch(english);
    });

    it("caché de lecturas", async () => {
      const err = await errorOf(repo.readingCache().set("k", { ...makeExtraction(), documentType: "otro" } as never));
      expect(err.message).toMatch(/La lectura no es válida/);
      expect(err.message).not.toMatch(english);
    });
  });
});
