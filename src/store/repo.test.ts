import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CompanySchema, type Company } from "../core/schemas";
import type { DbHandle } from "./db";
import { createRepo, toHistoryEntry, type Repo } from "./repo";
import { makeCompany, makeExtraction, makeRecord, makeVendor, openFakeNeonDb, openMemoryDb } from "./test-helpers";

const datasetCompany: Company = CompanySchema.parse(
  JSON.parse(readFileSync(path.resolve(__dirname, "../../dataset/company.json"), "utf8")),
);
describe.each([
  ["PGlite", openMemoryDb],
  ["Neon HTTP (simulado)", openFakeNeonDb],
] as const)("repositorio sobre %s", (_label, open) => {
  let handle: DbHandle;
  let repo: Repo;

  beforeEach(async () => {
    handle = await open();
    repo = createRepo(handle);
  });
  afterEach(async () => {
    await handle.close();
  });

  describe("empresa y proveedores", () => {
    it("sin empresa guardada devuelve null", async () => {
      expect(await repo.getCompany()).toBeNull();
    });

    it("ida y vuelta de la empresa del dataset, con proveedores en orden e identidad de compradora", async () => {
      await repo.saveCompany(datasetCompany);
      const got = await repo.getCompany();
      expect(got).toEqual(datasetCompany);
      expect(got?.buyer?.legalNames).toEqual(["Andes Labs Inc."]);
      expect(got?.buyer?.taxIds).toEqual(["93-4127765"]);
    });

    it("una empresa sin identidad de compradora vuelve sin ella, y guardarla sin ella borra la anterior", async () => {
      const withoutBuyer: Company = { name: datasetCompany.name, rules: datasetCompany.rules, vendors: datasetCompany.vendors };
      await repo.saveCompany(datasetCompany);
      await repo.saveCompany(withoutBuyer);
      const got = await repo.getCompany();
      expect(got).toEqual(withoutBuyer);
      expect(got && "buyer" in got).toBe(false);
    });

    it("saveCompany reemplaza la empresa anterior por completo", async () => {
      await repo.saveCompany(makeCompany());
      const next = makeCompany({ name: "Otra", vendors: [makeVendor("v-z"), makeVendor("v-a")] });
      await repo.saveCompany(next);
      expect(await repo.getCompany()).toEqual(next);
    });

    it("rechaza una empresa inválida o con proveedores repetidos sin tocar lo guardado", async () => {
      const original = makeCompany();
      await repo.saveCompany(original);
      const invalid = { ...original, rules: { ...original.rules, periodLimitUsd: "mucho" } } as unknown as Company;
      await expect(repo.saveCompany(invalid)).rejects.toThrow();
      await expect(repo.saveCompany(makeCompany({ vendors: [makeVendor("v-x"), makeVendor("v-x")] }))).rejects.toThrow(
        /más de una vez/,
      );
      expect(await repo.getCompany()).toEqual(original);
    });

    it("saveRules cambia solo las reglas y falla si no hay empresa", async () => {
      const rules = { ...makeCompany().rules, approvalThresholdUsd: 1234.5 };
      await expect(repo.saveRules(rules)).rejects.toThrow(/No hay empresa/);
      const company = makeCompany();
      await repo.saveCompany(company);
      await repo.saveRules(rules);
      expect(await repo.getCompany()).toEqual({ ...company, rules });
    });

    it("upsertVendor agrega al final y actualiza sin mover de lugar", async () => {
      const company = makeCompany();
      await repo.saveCompany(company);
      await repo.upsertVendor(makeVendor("v-nuevo"));
      const renamed = makeVendor("v-uno", { name: "Uno renombrado" });
      await repo.upsertVendor(renamed);
      const got = await repo.getCompany();
      expect(got?.vendors.map((v) => v.id)).toEqual(["v-uno", "v-dos", "v-tres", "v-nuevo"]);
      expect(got?.vendors[0]).toEqual(renamed);
    });

    it("upsertVendor funciona con la ficha vacía", async () => {
      await repo.saveCompany(makeCompany({ vendors: [] }));
      await repo.upsertVendor(makeVendor("v-solo"));
      expect((await repo.getCompany())?.vendors.map((v) => v.id)).toEqual(["v-solo"]);
    });

    it("deleteVendor borra y dice si existía", async () => {
      await repo.saveCompany(makeCompany());
      expect(await repo.deleteVendor("v-dos")).toBe(true);
      expect(await repo.deleteVendor("v-dos")).toBe(false);
      expect((await repo.getCompany())?.vendors.map((v) => v.id)).toEqual(["v-uno", "v-tres"]);
    });

    it("replaceVendors reemplaza la ficha respetando el orden y valida", async () => {
      const company = makeCompany();
      await repo.saveCompany(company);
      const list = [makeVendor("v-c"), makeVendor("v-a"), makeVendor("v-b")];
      await repo.replaceVendors(list);
      expect(await repo.getCompany()).toEqual({ ...company, vendors: list });
      await expect(repo.replaceVendors([{ id: "roto" } as never])).rejects.toThrow();
      await repo.replaceVendors([]);
      expect((await repo.getCompany())?.vendors).toEqual([]);
    });
  });

  describe("facturas", () => {
    it("guarda y devuelve los bytes exactos", async () => {
      const bytes = new Uint8Array(1024);
      for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 37) % 256;
      const { id } = await repo.saveInvoice({ filename: "factura.pdf", mediaType: "application/pdf", bytes, fileHash: "abc" });
      expect(id).toMatch(/^inv_/);
      const file = await repo.getInvoiceFile(id);
      expect(file?.filename).toBe("factura.pdf");
      expect(file?.mediaType).toBe("application/pdf");
      expect(Array.from(file!.bytes)).toEqual(Array.from(bytes));
      expect(file!.bytes).toBeInstanceOf(Uint8Array);
    });

    it("respeta subarreglos (byteOffset) y archivos vacíos", async () => {
      const big = new Uint8Array([9, 9, 1, 2, 3, 9]);
      const { id } = await repo.saveInvoice({ filename: "a.txt", mediaType: "text/plain", bytes: big.subarray(2, 5), fileHash: "h" });
      expect(Array.from((await repo.getInvoiceFile(id))!.bytes)).toEqual([1, 2, 3]);
      const empty = await repo.saveInvoice({ filename: "b.txt", mediaType: "text/plain", bytes: new Uint8Array(), fileHash: "h2" });
      expect((await repo.getInvoiceFile(empty.id))!.bytes.length).toBe(0);
    });

    it("cada subida tiene su propio id aunque el archivo se repita", async () => {
      const input = { filename: "x.pdf", mediaType: "application/pdf", bytes: new Uint8Array([1]), fileHash: "same" };
      const a = await repo.saveInvoice(input);
      const b = await repo.saveInvoice(input);
      expect(a.id).not.toBe(b.id);
    });

    it("id desconocido → null", async () => {
      expect(await repo.getInvoiceFile("inv_no_existe")).toBeNull();
    });
  });

  describe("decisiones (solo inserción)", () => {
    it("guarda el registro completo tal cual", async () => {
      const record = makeRecord({ id: "d1", decidedAt: "2026-10-16T10:00:00.000Z", suspicious: true });
      await repo.appendDecision(record);
      expect(await repo.getDecision("d1")).toEqual(record);
      expect(await repo.getDecisionByInvoice(record.invoiceId)).toEqual(record);
      expect(await repo.getDecision("otra")).toBeNull();
      expect(await repo.getDecisionByInvoice("otra")).toBeNull();
    });

    it("no permite reescribir una decisión con el mismo id", async () => {
      await repo.appendDecision(makeRecord({ id: "d1", decidedAt: "2026-10-16T10:00:00.000Z", outcome: "PAGAR" }));
      await expect(
        repo.appendDecision(makeRecord({ id: "d1", decidedAt: "2026-10-16T11:00:00.000Z", outcome: "FRENAR" })),
      ).rejects.toThrow(/Ya existe una decisión/);
      expect((await repo.getDecision("d1"))?.decision.outcome).toBe("PAGAR");
    });

    it("rechaza registros sin datos mínimos", async () => {
      await expect(repo.appendDecision(makeRecord({ id: "", decidedAt: "2026-10-16T10:00:00Z" }))).rejects.toThrow(/falta id/);
      await expect(repo.appendDecision(makeRecord({ id: "x", decidedAt: "ayer" }))).rejects.toThrow(/decidedAt/);
      const bad = makeRecord({ id: "y", decidedAt: "2026-10-16T10:00:00Z" });
      (bad.decision as { outcome: string }).outcome = "APROBAR";
      await expect(repo.appendDecision(bad)).rejects.toThrow(/outcome/);
      expect(await repo.exportDecisions()).toEqual([]);
    });

    it("guarda textos con caracteres que Postgres rechaza (NUL, sustitutos sueltos)", async () => {
      const record = makeRecord({ id: "d-nul", decidedAt: "2026-10-16T10:00:00Z", suspicious: true });
      record.decision.summary = "texto con nul \u0000 y sustituto \uD800 suelto 😀";
      record.reading.signals.suspiciousInstructions[0].text = "\u0000oculto";
      await repo.appendDecision(record);
      const got = await repo.getDecision("d-nul");
      expect(got?.decision.summary).toBe("texto con nul \uFFFD y sustituto \uFFFD suelto 😀");
      expect(got?.reading.signals.suspiciousInstructions[0].text).toBe("\uFFFDoculto");
      expect(await repo.getDecision("d-nul\u0000")).toBeNull();
      const cache = repo.readingCache();
      await cache.set("k\u0000", makeExtraction({ readerNotes: "\u0000" }));
      expect((await cache.get("k\u0000"))?.readerNotes).toBe("\uFFFD");
      await repo.setMeta("m\u0000", "v\u0000");
      expect(await repo.getMeta("m\u0000")).toBe("v\uFFFD");
      const { id } = await repo.saveInvoice({ filename: "a\u0000.pdf", mediaType: "application/pdf", bytes: new Uint8Array([0, 0]), fileHash: "h" });
      expect(await repo.getInvoiceFile(id)).toEqual({ filename: "a\uFFFD.pdf", mediaType: "application/pdf", bytes: new Uint8Array([0, 0]) });
    });

    it("la base rechaza UPDATE y DELETE sobre decisiones", async () => {
      await repo.appendDecision(makeRecord({ id: "d1", decidedAt: "2026-10-16T10:00:00.000Z" }));
      const { sql } = await import("drizzle-orm");
      await expect(handle.db.execute(sql`UPDATE decisions SET outcome = 'FRENAR'`)).rejects.toThrow();
      await expect(handle.db.execute(sql`DELETE FROM decisions`)).rejects.toThrow();
      expect((await repo.getDecision("d1"))?.decision.outcome).toBe("PAGAR");
    });

    it("historial en orden de decidedAt (no de inserción) y desempate por orden de llegada", async () => {
      await repo.appendDecision(makeRecord({ id: "c", decidedAt: "2026-10-16T12:00:00.000Z" }));
      await repo.appendDecision(makeRecord({ id: "a", decidedAt: "2026-10-01T09:00:00.000Z" }));
      await repo.appendDecision(makeRecord({ id: "b2", decidedAt: "2026-10-10T09:00:00.000Z" }));
      await repo.appendDecision(makeRecord({ id: "b1", decidedAt: "2026-10-10T09:00:00.000Z" }));
      const history = await repo.getHistory();
      expect(history.map((h) => h.invoiceId)).toEqual(["inv-a", "inv-b2", "inv-b1", "inv-c"]);
      const exported = await repo.exportDecisions();
      expect(exported.map((r) => r.id)).toEqual(["a", "b2", "b1", "c"]);
      expect(history).toEqual(exported.map(toHistoryEntry));
      const listed = await repo.listDecisions();
      expect(listed.map((d) => d.id)).toEqual(["c", "b1", "b2", "a"]);
    });

    it("mapea el historial desde la decisión y la lectura", async () => {
      await repo.appendDecision(
        makeRecord({
          id: "d1",
          decidedAt: "2026-10-16T10:00:00.000Z",
          outcome: "FRENAR",
          fileHash: "f00d",
          vendorId: "v-dos",
          agreementId: "a-v-dos",
          agreementPeriod: "2026-09",
          invoiceNumber: "FAC-77",
          amountUsd: 321.45,
        }),
      );
      await repo.appendDecision(
        makeRecord({
          id: "d2",
          decidedAt: "2026-10-16T11:00:00.000Z",
          outcome: "ESCALAR",
          readingFailed: true,
          vendorId: null,
          agreementId: null,
          agreementPeriod: null,
          amountUsd: null,
        }),
      );
      expect(await repo.getHistory()).toEqual([
        {
          invoiceId: "inv-d1",
          fileHash: "f00d",
          outcome: "FRENAR",
          vendorId: "v-dos",
          invoiceNumber: "FAC-77",
          agreementId: "a-v-dos",
          agreementPeriod: "2026-09",
          amountUsd: 321.45,
          decidedAt: "2026-10-16T10:00:00.000Z",
        },
        {
          invoiceId: "inv-d2",
          fileHash: "hash-d2",
          outcome: "ESCALAR",
          vendorId: null,
          invoiceNumber: null,
          agreementId: null,
          agreementPeriod: null,
          amountUsd: null,
          decidedAt: "2026-10-16T11:00:00.000Z",
        },
      ]);
    });

    it("getDecisionByInvoice devuelve la más reciente de esa factura", async () => {
      await repo.appendDecision(makeRecord({ id: "d1", invoiceId: "inv-x", decidedAt: "2026-10-16T10:00:00Z", outcome: "ESCALAR" }));
      await repo.appendDecision(makeRecord({ id: "d2", invoiceId: "inv-x", decidedAt: "2026-10-16T12:00:00Z", outcome: "PAGAR" }));
      expect((await repo.getDecisionByInvoice("inv-x"))?.id).toBe("d2");
    });
  });

  describe("listado para la pantalla", () => {
    it("arma el resumen de cada decisión", async () => {
      const company = makeCompany();
      await repo.appendDecision(
        makeRecord({
          id: "d1",
          decidedAt: "2026-10-16T10:00:00Z",
          outcome: "ESCALAR",
          vendorId: "v-dos",
          readVendorName: "Nombre como viene en la factura",
          invoiceNumber: "F-9",
          total: 48000,
          currency: "COP",
          amountUsd: 12,
          checks: { "LEC-4": "fail", "ACU-3": "not_evaluable" },
          suspicious: true,
          guardOverride: true,
          readingMode: "cache",
          company,
        }),
      );
      await repo.appendDecision(
        makeRecord({ id: "d2", decidedAt: "2026-10-16T11:00:00Z", outcome: "ESCALAR", vendorId: null, readVendorName: "Desconocido S.A." }),
      );
      await repo.appendDecision(
        makeRecord({ id: "d3", decidedAt: "2026-10-16T12:00:00Z", outcome: "ESCALAR", readingFailed: true, vendorId: null }),
      );

      const [d3, d2, d1] = await repo.listDecisions();
      expect(d1).toEqual({
        id: "d1",
        invoiceId: "inv-d1",
        filename: "d1.pdf",
        decidedAt: "2026-10-16T10:00:00Z",
        outcome: "ESCALAR",
        vendorName: "Proveedor v-dos",
        vendorId: "v-dos",
        vendorCountry: "CO",
        invoiceNumber: "F-9",
        total: 48000,
        currency: "COP",
        amountUsd: 12,
        summary: "Resumen de d1",
        readingMode: "cache",
        failedChecks: ["LEC-4", "ACU-3"],
        hasSuspiciousText: true,
        guardOverride: true,
      });
      expect(d2.vendorName).toBe("Desconocido S.A.");
      expect(d2.vendorId).toBeNull();
      expect(d2.vendorCountry).toBeNull();
      expect(d2.failedChecks).toEqual([]);
      expect(d2.hasSuspiciousText).toBe(false);
      expect(d3.vendorName).toBeNull();
      expect(d3.invoiceNumber).toBeNull();
      expect(d3.total).toBeNull();
    });

    it("limit devuelve las más recientes", async () => {
      for (let i = 1; i <= 5; i++) {
        await repo.appendDecision(makeRecord({ id: `d${i}`, decidedAt: `2026-10-0${i}T10:00:00Z` }));
      }
      expect((await repo.listDecisions({ limit: 2 })).map((d) => d.id)).toEqual(["d5", "d4"]);
      expect(await repo.listDecisions({ limit: 0 })).toEqual([]);
      expect(await repo.listDecisions({ limit: 50 })).toHaveLength(5);
    });
  });

  describe("estadísticas", () => {
    it("sin decisiones ni empresa todo está en cero", async () => {
      expect(await repo.getStats("2026-10-16T12:00:00Z")).toEqual({
        total: 0,
        byOutcome: { PAGAR: 0, FRENAR: 0, ESCALAR: 0 },
        paidUsd: 0,
        heldUsd: 0,
        escalatedUsd: 0,
        initialFundUsd: 0,
        fundAvailableUsd: 0,
        month: "2026-10",
        monthSpentUsd: 0,
        periodLimitUsd: 0,
        approvalThresholdUsd: 0,
        autonomyRate: 0,
      });
    });

    it("cuenta resultados, lo pagado, lo del mes y la autonomía", async () => {
      await repo.saveCompany(makeCompany());
      const add = (id: string, decidedAt: string, outcome: "PAGAR" | "FRENAR" | "ESCALAR", amountUsd: number | null) =>
        repo.appendDecision(makeRecord({ id, decidedAt, outcome, amountUsd }));
      await add("p-sep", "2026-09-30T23:59:59.000Z", "PAGAR", 1000.1);
      await add("p-oct1", "2026-10-01T00:00:00.000Z", "PAGAR", 0.1);
      await add("p-oct2", "2026-10-15T10:00:00.000Z", "PAGAR", 0.2);
      await add("f-oct", "2026-10-15T11:00:00.000Z", "FRENAR", 5000);
      await add("e-oct", "2026-10-15T12:00:00.000Z", "ESCALAR", 7000);
      await add("e-null", "2026-10-15T13:00:00.000Z", "ESCALAR", null);
      await add("f-sep", "2026-09-10T13:00:00.000Z", "FRENAR", 0.15);

      const stats = await repo.getStats("2026-10-16T12:00:00.000Z");
      expect(stats).toEqual({
        total: 7,
        byOutcome: { PAGAR: 3, FRENAR: 2, ESCALAR: 2 },
        paidUsd: 1000.4,
        heldUsd: 5000.15,
        escalatedUsd: 7000,
        initialFundUsd: 40000,
        fundAvailableUsd: 38999.6,
        month: "2026-10",
        monthSpentUsd: 0.3,
        periodLimitUsd: 25000,
        approvalThresholdUsd: 5000,
        autonomyRate: 5 / 7,
      });
      expect((await repo.getStats("2026-09-02")).monthSpentUsd).toBe(1000.1);
    });
  });

  describe("reinicio", () => {
    it("borra facturas y decisiones, guarda la empresa y conserva caché y metadatos", async () => {
      await repo.saveCompany(makeCompany());
      const { id: invoiceId } = await repo.saveInvoice({ filename: "a.pdf", mediaType: "application/pdf", bytes: new Uint8Array([1]), fileHash: "h" });
      await repo.appendDecision(makeRecord({ id: "d1", invoiceId, decidedAt: "2026-10-16T10:00:00Z" }));
      const cache = repo.readingCache();
      await cache.set("k1", makeExtraction());
      await repo.setMeta("demo", "sí");

      await repo.resetAll(datasetCompany);

      expect(await repo.getInvoiceFile(invoiceId)).toBeNull();
      expect(await repo.exportDecisions()).toEqual([]);
      expect(await repo.getHistory()).toEqual([]);
      expect((await repo.getStats("2026-10-16")).total).toBe(0);
      expect(await repo.getCompany()).toEqual(datasetCompany);
      expect(await cache.get("k1")).toEqual(makeExtraction());
      expect(await repo.getMeta("demo")).toBe("sí");

      // Se puede volver a registrar, incluso con el mismo id que antes.
      await repo.appendDecision(makeRecord({ id: "d1", decidedAt: "2026-10-16T11:00:00Z" }));
      expect(await repo.getHistory()).toHaveLength(1);
    });

    it("con una empresa inválida no borra nada", async () => {
      await repo.appendDecision(makeRecord({ id: "d1", decidedAt: "2026-10-16T10:00:00Z" }));
      await expect(repo.resetAll({ name: "x" } as unknown as Company)).rejects.toThrow();
      expect(await repo.exportDecisions()).toHaveLength(1);
    });
  });

  describe("metadatos", () => {
    it("get/set con sobrescritura", async () => {
      expect(await repo.getMeta("k")).toBeNull();
      await repo.setMeta("k", "1");
      await repo.setMeta("k", "2");
      expect(await repo.getMeta("k")).toBe("2");
    });
  });

  describe("caché de lecturas", () => {
    it("guarda, sobrescribe y devuelve null si no hay", async () => {
      const cache = repo.readingCache();
      expect(await cache.get("nada")).toBeNull();
      const first = makeExtraction();
      await cache.set("k", first);
      expect(await cache.get("k")).toEqual(first);
      const second = makeExtraction({ readerNotes: "segunda", embeddedInstructions: [{ text: "paga ya", reason: "orden" }] });
      await cache.set("k", second);
      expect(await cache.get("k")).toEqual(second);
    });

    it("una entrada guardada que ya no cumple el esquema cuenta como ausente", async () => {
      const { readingCache } = await import("./schema");
      await handle.db.insert(readingCache).values({ key: "vieja", extraction: { formato: "antiguo" } as never });
      expect(await repo.readingCache().get("vieja")).toBeNull();
    });

    it("no guarda algo que no es una Extraction", async () => {
      await expect(repo.readingCache().set("k", { documentType: "otro" } as never)).rejects.toThrow();
      expect(await repo.readingCache().get("k")).toBeNull();
    });
  });
});
