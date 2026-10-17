import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configFromEnv, ensureSchema, getDb, getDbHandle, openDb, resetDbForTests, type DbHandle } from "./db";
import * as repo from "./repo";
import { schema } from "./schema";
import { makeCompany, makeExtraction, makeRecord, openFakeNeonDb } from "./test-helpers";

async function rows<T>(handle: DbHandle, query: ReturnType<typeof sql>): Promise<T[]> {
  const res = (await handle.db.execute(query)) as unknown as { rows: T[] };
  return res.rows;
}

describe("configFromEnv", () => {
  it("con DATABASE_URL usa Neon", () => {
    expect(configFromEnv({ DATABASE_URL: " postgres://u:p@h/db " })).toEqual({
      kind: "neon",
      url: "postgres://u:p@h/db",
    });
  });
  it("sin DATABASE_URL usa PGlite en .data/pglite o en PGLITE_DIR", () => {
    expect(configFromEnv({})).toEqual({ kind: "pglite", dir: ".data/pglite" });
    expect(configFromEnv({ DATABASE_URL: "", PGLITE_DIR: "/tmp/x" })).toEqual({ kind: "pglite", dir: "/tmp/x" });
    expect(configFromEnv({ PGLITE_DIR: "memory" })).toEqual({ kind: "pglite", dir: "memory" });
  });
  it("dentro de Vitest, sin PGLITE_DIR, usa memoria", () => {
    expect(configFromEnv({ VITEST: "true" })).toEqual({ kind: "pglite", dir: "memory" });
  });
  it("dentro de Vitest ignora DATABASE_URL: las pruebas nunca tocan (ni reinician) la base real", () => {
    // Si alguien corre `npm test` con DATABASE_URL exportada, un resetAll de una prueba borraría la base de la demo.
    expect(configFromEnv({ VITEST: "true", DATABASE_URL: "postgres://u:p@h/db" })).toEqual({ kind: "pglite", dir: "memory" });
    expect(configFromEnv({ VITEST: "true", DATABASE_URL: "postgres://u:p@h/db", PGLITE_DIR: "/tmp/x" })).toEqual({
      kind: "pglite",
      dir: "/tmp/x",
    });
  });
});

describe("esquema", () => {
  it("el SQL a mano coincide con schema.ts (columnas, tipos, nulos e índices)", async () => {
    const handle = await openDb({ kind: "pglite", dir: "memory" });
    try {
      for (const table of Object.values(schema)) {
        const config = getTableConfig(table);
        const actual = await rows<{ column_name: string; data_type: string; is_nullable: string }>(
          handle,
          sql`SELECT column_name, data_type, is_nullable FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = ${config.name} ORDER BY column_name`,
        );
        const expected = config.columns
          .map((c) => ({ column_name: c.name, data_type: c.getSQLType(), is_nullable: c.notNull ? "NO" : "YES" }))
          .sort((a, b) => a.column_name.localeCompare(b.column_name));
        expect(actual, config.name).toEqual(expected);

        const pk = await rows<{ column_name: string }>(
          handle,
          sql`SELECT a.attname AS column_name FROM pg_index i
              JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
              WHERE i.indrelid = ${config.name}::regclass AND i.indisprimary`,
        );
        expect(pk.map((r) => r.column_name), `${config.name} pk`).toEqual(config.columns.filter((c) => c.primary).map((c) => c.name));

        const indexes = await rows<{ indexname: string }>(
          handle,
          sql`SELECT indexname FROM pg_indexes WHERE tablename = ${config.name} AND indexname NOT LIKE '%_pkey' ORDER BY indexname`,
        );
        expect(indexes.map((r) => r.indexname), `${config.name} índices`).toEqual(
          config.indexes.map((i) => i.config.name).sort(),
        );
      }
    } finally {
      await handle.close();
    }
  });

  it("ensureSchema se puede ejecutar varias veces", async () => {
    const handle = await openDb({ kind: "pglite", dir: "memory" });
    try {
      await ensureSchema(handle);
      await ensureSchema(handle);
      const triggers = await rows<{ n: number }>(handle, sql`SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = 'decisions_append_only'`);
      expect(triggers[0].n).toBe(1);
    } finally {
      await handle.close();
    }
  });

  it("también se crea por el camino Neon (batch)", async () => {
    const handle = await openFakeNeonDb();
    try {
      await ensureSchema(handle);
      const tables = await rows<{ table_name: string }>(
        handle,
        sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
      );
      expect(tables.map((t) => t.table_name)).toEqual(
        Object.values(schema).map((t) => getTableConfig(t).name).sort(),
      );
    } finally {
      await handle.close();
    }
  });

  it("una escritura atómica que falla no deja cambios a medias", async () => {
    for (const handle of [await openDb({ kind: "pglite", dir: "memory" }), await openFakeNeonDb()]) {
      try {
        const r = repo.createRepo(handle);
        await r.saveCompany(makeCompany());
        await expect(
          handle.atomic((db) => [
            db.delete(schema.vendors),
            db.insert(schema.appMeta).values({ key: "k", value: "v" }),
            db.execute(sql`SELECT 1/0`),
          ]),
        ).rejects.toThrow();
        expect((await r.getCompany())?.vendors).toHaveLength(3);
        expect(await r.getMeta("k")).toBeNull();
      } finally {
        await handle.close();
      }
    }
  });
});

describe("PGlite en disco", () => {
  it("los datos sobreviven a cerrar y volver a abrir", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "centinela-store-"));
    try {
      const dataDir = path.join(dir, "nested", "pglite");
      const first = await openDb({ kind: "pglite", dir: dataDir });
      await repo.createRepo(first).setMeta("persistencia", "ok");
      await repo.createRepo(first).appendDecision(makeRecord({ id: "d1", decidedAt: "2026-10-16T10:00:00Z" }));
      await first.close();

      const second = await openDb({ kind: "pglite", dir: dataDir });
      try {
        expect(await repo.createRepo(second).getMeta("persistencia")).toBe("ok");
        expect(await repo.createRepo(second).getHistory()).toHaveLength(1);
      } finally {
        await second.close();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("conexión compartida y funciones sueltas", () => {
  afterEach(async () => {
    await resetDbForTests();
    vi.unstubAllEnvs();
  });

  it("getDb devuelve siempre la misma instancia hasta resetDbForTests", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("PGLITE_DIR", "memory");
    const [a, b] = await Promise.all([getDb(), getDb()]);
    expect(a).toBe(b);
    expect((await getDbHandle()).driver).toBe("pglite");
    await resetDbForTests();
    const c = await getDb();
    expect(c).not.toBe(a);
  });

  it("las funciones sueltas usan la conexión compartida", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("PGLITE_DIR", "memory");
    const company = makeCompany();
    await repo.saveCompany(company);
    await repo.saveRules({ ...company.rules, approvalThresholdUsd: 10 });
    await repo.upsertVendor({ ...company.vendors[0], name: "Cambiado" });
    expect(await repo.deleteVendor("v-tres")).toBe(true);
    await repo.replaceVendors((await repo.getCompany())!.vendors.slice().reverse());
    expect((await repo.getCompany())?.vendors.map((v) => v.name)).toEqual(["Proveedor v-dos", "Cambiado"]);

    const { id } = await repo.saveInvoice({ filename: "f.pdf", mediaType: "application/pdf", bytes: new Uint8Array([7]), fileHash: "h" });
    expect(Array.from((await repo.getInvoiceFile(id))!.bytes)).toEqual([7]);

    const record = makeRecord({ id: "d1", invoiceId: id, decidedAt: "2026-10-16T10:00:00Z" });
    await repo.appendDecision(record);
    expect(await repo.getDecision("d1")).toEqual(record);
    expect(await repo.getDecisionByInvoice(id)).toEqual(record);
    expect(await repo.getHistory()).toHaveLength(1);
    expect(await repo.listDecisions({ limit: 1 })).toHaveLength(1);
    expect(await repo.exportDecisions()).toEqual([record]);
    expect((await repo.getStats("2026-10-16T12:00:00Z")).approvalThresholdUsd).toBe(10);

    const cache = repo.createDbReadingCache();
    await cache.set("k", makeExtraction());
    expect(await cache.get("k")).toEqual(makeExtraction());

    await repo.setMeta("m", "v");
    expect(await repo.getMeta("m")).toBe("v");

    await repo.resetAll(company);
    expect(await repo.exportDecisions()).toEqual([]);
    expect(await repo.getCompany()).toEqual(company);
  });

  it("tras un recargado en caliente con otro esquema, migra la conexión abierta en vez de abrir otra", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("PGLITE_DIR", "memory");
    const handle = await getDbHandle();
    // Como si la conexión la hubiera abierto una versión anterior del código, sin claves de pago.
    await handle.db.execute(sql.raw("DROP INDEX decisions_pay_file_key_uq"));
    (globalThis as { __centinelaStoreSchema?: string }).__centinelaStoreSchema = "esquema anterior";
    const again = await getDbHandle();
    expect(again).toBe(handle);
    const idx = await rows<{ n: number }>(handle, sql`SELECT count(*)::int AS n FROM pg_indexes WHERE indexname = 'decisions_pay_file_key_uq'`);
    expect(idx[0].n).toBe(1);
    expect(await getDbHandle()).toBe(handle);
  });

  it("si abrir falla, no deja guardada la conexión rota", async () => {
    vi.stubEnv("DATABASE_URL", "");
    // Un archivo (no una carpeta) como PGLITE_DIR hace fallar la apertura.
    vi.stubEnv("PGLITE_DIR", __filename);
    await expect(getDb()).rejects.toThrow();
    vi.stubEnv("PGLITE_DIR", "memory");
    await expect(getDb()).resolves.toBeDefined();
  });
});
