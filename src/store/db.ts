/**
 * Conexión a la base de datos.
 *
 * - Con `DATABASE_URL` → Neon (HTTP, `drizzle-orm/neon-http`).
 * - Sin ella → PGlite en `PGLITE_DIR` (por defecto `.data/pglite`). `PGLITE_DIR=memory` usa memoria.
 *   Dentro de Vitest, si no hay `PGLITE_DIR`, también se usa memoria: las pruebas nunca tocan `.data/`.
 *
 * `getDb()` devuelve un singleton guardado en `globalThis`, así sobrevive al recargado en caliente
 * de Next (dos PGlite sobre la misma carpeta la corromperían). Al abrir se ejecuta `ensureSchema()`.
 */
import { sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import type { PGlite } from "@electric-sql/pglite";
import { schema, type StoreSchema } from "./schema";

/** Base de datos Drizzle, igual para PGlite y Neon. */
export type Db = PgDatabase<PgQueryResultHKT, StoreSchema>;

/** Una consulta Drizzle aún sin ejecutar (insert, update, delete, select o execute). */
export type StoreQuery = BatchItem<"pg">;

export interface DbHandle {
  db: Db;
  driver: "pglite" | "neon";
  /**
   * Ejecuta varias escrituras de forma atómica: transacción en PGlite, `batch` en Neon HTTP
   * (que no admite transacciones interactivas). `build` recibe la base sobre la que debe
   * construir las consultas; no las ejecute, solo devuélvalas.
   */
  atomic(build: (db: Db) => StoreQuery[]): Promise<void>;
  close(): Promise<void>;
}

export type DbConfig =
  /** Carpeta de datos, o "memory" para una base en memoria. */
  | { kind: "pglite"; dir: string }
  /** Instancia PGlite ya creada (pruebas). `close()` del handle la cierra. */
  | { kind: "pglite"; client: PGlite }
  | { kind: "neon"; url: string }
  /** Cliente Neon ya construido (pruebas o configuración avanzada). */
  | { kind: "neon"; client: NeonQueryFunction<false, false> };

/** SQL que crea las tablas. Debe coincidir con `schema.ts` (lo verifica una prueba). */
export const SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS company_settings (
    id integer PRIMARY KEY CHECK (id = 1),
    name text NOT NULL,
    rules jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS vendors (
    id text PRIMARY KEY,
    data jsonb NOT NULL,
    position integer NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS invoices (
    id text PRIMARY KEY,
    filename text NOT NULL,
    media_type text NOT NULL,
    file_hash text NOT NULL,
    size integer NOT NULL,
    bytes_b64 text NOT NULL,
    uploaded_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS invoices_file_hash_idx ON invoices (file_hash)`,
  `CREATE TABLE IF NOT EXISTS decisions (
    id text PRIMARY KEY,
    seq bigint GENERATED ALWAYS AS IDENTITY,
    invoice_id text NOT NULL,
    decided_at timestamptz NOT NULL,
    outcome text NOT NULL CHECK (outcome IN ('PAGAR', 'FRENAR', 'ESCALAR')),
    record jsonb NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS decisions_decided_at_idx ON decisions (decided_at, seq)`,
  `CREATE INDEX IF NOT EXISTS decisions_invoice_id_idx ON decisions (invoice_id)`,
  `CREATE TABLE IF NOT EXISTS reading_cache (
    key text PRIMARY KEY,
    extraction jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS app_meta (
    key text PRIMARY KEY,
    value text NOT NULL
  )`,
  // Registro inmutable: la base rechaza modificar o borrar decisiones fila por fila.
  // El reinicio de la demostración usa TRUNCATE, que no dispara este control.
  `CREATE OR REPLACE FUNCTION centinela_decisions_append_only() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'El registro de decisiones es inmutable: no se permite % sobre decisions', TG_OP;
    END
    $$`,
  `DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'decisions_append_only') THEN
        CREATE TRIGGER decisions_append_only BEFORE UPDATE OR DELETE ON decisions
          FOR EACH ROW EXECUTE FUNCTION centinela_decisions_append_only();
      END IF;
    END
    $$`,
];

/** Crea las tablas si no existen (sin migraciones). Reintenta por si dos arranques compiten. */
export async function ensureSchema(handle: Pick<DbHandle, "db" | "atomic">): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await handle.atomic((db) => SCHEMA_STATEMENTS.map((stmt) => db.execute(sql.raw(stmt))));
      return;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

/**
 * Configuración a partir de las variables de entorno.
 * Dentro de Vitest se ignora `DATABASE_URL`: una prueba que llame a `resetAll` no debe poder borrar
 * la base real aunque la variable esté exportada. Para probar contra Neon, use `openDb({ kind: "neon", url })`.
 */
export function configFromEnv(env: Record<string, string | undefined> = process.env): DbConfig {
  const pgliteDir = env.PGLITE_DIR?.trim();
  if (env.VITEST) return { kind: "pglite", dir: pgliteDir || "memory" };
  const url = env.DATABASE_URL?.trim();
  if (url) return { kind: "neon", url };
  return { kind: "pglite", dir: pgliteDir || ".data/pglite" };
}

/** Abre una conexión nueva (no compartida) y asegura el esquema. Útil para pruebas aisladas. */
export async function openDb(config: DbConfig = configFromEnv()): Promise<DbHandle> {
  const handle = config.kind === "neon" ? await openNeon(config) : await openPglite(config);
  try {
    await ensureSchema(handle);
  } catch (err) {
    await handle.close().catch(() => undefined);
    throw err;
  }
  return handle;
}

async function openPglite(config: Extract<DbConfig, { kind: "pglite" }>): Promise<DbHandle> {
  const { drizzle } = await import("drizzle-orm/pglite");
  let client: PGlite;
  if ("client" in config) {
    client = config.client;
  } else {
    const { PGlite } = await import("@electric-sql/pglite");
    if (config.dir === "memory") {
      client = await PGlite.create();
    } else {
      const { mkdir } = await import("node:fs/promises");
      const path = await import("node:path");
      const absolute = path.resolve(process.cwd(), config.dir);
      await mkdir(absolute, { recursive: true });
      client = await PGlite.create(absolute);
    }
  }
  const db = drizzle({ client, schema });
  const handle: DbHandle = {
    db: db as unknown as Db,
    driver: "pglite",
    async atomic(build) {
      await db.transaction(async (tx) => {
        for (const query of build(tx as unknown as Db)) {
          await (query as unknown as PromiseLike<unknown>);
        }
      });
    },
    async close() {
      if (!client.closed) await client.close();
    },
  };
  return handle;
}

async function openNeon(config: Extract<DbConfig, { kind: "neon" }>): Promise<DbHandle> {
  const { drizzle } = await import("drizzle-orm/neon-http");
  let client: NeonQueryFunction<false, false>;
  if ("client" in config) {
    client = config.client;
  } else {
    const { neon } = await import("@neondatabase/serverless");
    client = neon(config.url);
  }
  const db = drizzle({ client, schema });
  return {
    db: db as unknown as Db,
    driver: "neon",
    async atomic(build) {
      const queries = build(db as unknown as Db);
      if (queries.length === 0) return;
      await db.batch(queries as [StoreQuery, ...StoreQuery[]]);
    },
    async close() {
      // Neon HTTP no mantiene conexiones abiertas.
    },
  };
}

// ───────────────────────── Singleton ─────────────────────────

const GLOBAL_KEY = "__centinelaStoreDb";
type GlobalWithDb = typeof globalThis & { [GLOBAL_KEY]?: Promise<DbHandle> };

/** Conexión compartida por todo el proceso (sobrevive al recargado en caliente de Next). */
export function getDbHandle(): Promise<DbHandle> {
  const g = globalThis as GlobalWithDb;
  const existing = g[GLOBAL_KEY];
  if (existing) return existing;
  const pending: Promise<DbHandle> = openDb(configFromEnv()).catch((err: unknown) => {
    if (g[GLOBAL_KEY] === pending) delete g[GLOBAL_KEY];
    throw err;
  });
  g[GLOBAL_KEY] = pending;
  return pending;
}

/** Base de datos Drizzle compartida. */
export async function getDb(): Promise<Db> {
  return (await getDbHandle()).db;
}

/** Cierra y olvida la conexión compartida; la próxima llamada a `getDb()` abre una nueva. */
export async function resetDbForTests(): Promise<void> {
  const g = globalThis as GlobalWithDb;
  const existing = g[GLOBAL_KEY];
  delete g[GLOBAL_KEY];
  if (!existing) return;
  try {
    const handle = await existing;
    await handle.close();
  } catch {
    // Si la apertura había fallado no hay nada que cerrar.
  }
}
