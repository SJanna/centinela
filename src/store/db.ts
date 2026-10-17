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
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import type { PGlite } from "@electric-sql/pglite";
import type { DecisionRecord } from "../core/schemas";
import { PAYMENT_KEY_COLUMN, PAYMENT_KEY_INDEX, PAYMENT_KEY_KINDS, paymentKeysOf, type PaymentKeyKind } from "./payment-keys";
import { decisions, schema, type StoreSchema } from "./schema";

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

/** Marca local de transacción con que la migración puede rellenar claves de pago (ver el disparador). */
const FILL_PAY_KEYS_SETTING = "centinela.fill_pay_keys";

/**
 * SQL que crea las tablas. Junto con `PAYMENT_KEY_INDEX_STATEMENTS` debe coincidir con `schema.ts`
 * (lo verifica una prueba).
 */
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
    record jsonb NOT NULL,
    pay_file_key text,
    pay_invoice_key text,
    pay_period_key text
  )`,
  // Bases creadas antes de las claves de pago. Los índices únicos se crean en `ensureSchema`,
  // después de rellenar las claves de los PAGAR ya guardados.
  `ALTER TABLE decisions ADD COLUMN IF NOT EXISTS pay_file_key text`,
  `ALTER TABLE decisions ADD COLUMN IF NOT EXISTS pay_invoice_key text`,
  `ALTER TABLE decisions ADD COLUMN IF NOT EXISTS pay_period_key text`,
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
  // Única excepción: la migración que rellena las claves de pago de un PAGAR guardado sin ellas
  // (solo con la marca local de esa transacción, solo claves vacías y sin cambiar nada más).
  `CREATE OR REPLACE FUNCTION centinela_decisions_append_only() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'UPDATE'
        AND current_setting('${FILL_PAY_KEYS_SETTING}', true) = 'on'
        AND OLD.outcome = 'PAGAR'
        AND OLD.pay_file_key IS NULL AND OLD.pay_invoice_key IS NULL AND OLD.pay_period_key IS NULL
        AND (NEW.id, NEW.seq, NEW.invoice_id, NEW.decided_at, NEW.outcome, NEW.record)
          IS NOT DISTINCT FROM (OLD.id, OLD.seq, OLD.invoice_id, OLD.decided_at, OLD.outcome, OLD.record)
      THEN
        RETURN NEW;
      END IF;
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

/** Índices únicos de las claves de pago (se crean después de rellenarlas). */
export const PAYMENT_KEY_INDEX_STATEMENTS: readonly string[] = PAYMENT_KEY_KINDS.map(
  (kind) => `CREATE UNIQUE INDEX IF NOT EXISTS ${PAYMENT_KEY_INDEX[kind]} ON decisions (${PAYMENT_KEY_COLUMN[kind]})`,
);

/**
 * Crea las tablas si no existen y migra las bases anteriores: agrega las columnas de claves de pago,
 * rellena las de los PAGAR ya guardados y crea sus índices únicos. Se puede repetir sin efecto.
 * Reintenta por si dos arranques compiten.
 */
export async function ensureSchema(handle: Pick<DbHandle, "db" | "atomic">): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await handle.atomic((db) => SCHEMA_STATEMENTS.map((stmt) => db.execute(sql.raw(stmt))));
      await fillPaymentKeysAndIndex(handle);
      return;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

type KeyFill = { id: string } & Partial<Record<PaymentKeyKind, string>>;

/**
 * Rellena las claves de pago de los PAGAR guardados sin ellas (registrados antes de que existieran)
 * y crea los índices únicos, en una sola transacción.
 *
 * Se recorre el registro en orden: si dos PAGAR viejos comparten una clave (un pago doble anterior a
 * esta protección), solo el primero la recibe; el otro queda sin esa clave. Así crear el índice nunca
 * falla por datos viejos, y el motor sigue viendo los dos pagos en el historial.
 */
async function fillPaymentKeysAndIndex(handle: Pick<DbHandle, "db" | "atomic">): Promise<void> {
  const rows = await handle.db
    .select({
      id: decisions.id,
      file: decisions.payFileKey,
      invoice: decisions.payInvoiceKey,
      period: decisions.payPeriodKey,
      record: sql<unknown>`CASE WHEN ${decisions.payFileKey} IS NULL AND ${decisions.payInvoiceKey} IS NULL
        AND ${decisions.payPeriodKey} IS NULL THEN ${decisions.record} END`,
    })
    .from(decisions)
    .where(eq(decisions.outcome, "PAGAR"))
    .orderBy(asc(decisions.decidedAt), asc(decisions.seq));

  const used: Record<PaymentKeyKind, Set<string>> = { file: new Set(), invoice: new Set(), period: new Set() };
  for (const row of rows) {
    for (const kind of PAYMENT_KEY_KINDS) if (row[kind] != null) used[kind].add(row[kind]);
  }
  const fills: KeyFill[] = [];
  for (const row of rows) {
    if (row.record == null) continue;
    let keys: ReturnType<typeof paymentKeysOf>;
    try {
      keys = paymentKeysOf((typeof row.record === "string" ? JSON.parse(row.record) : row.record) as DecisionRecord);
    } catch {
      continue; // Un registro ilegible no debe impedir que la aplicación arranque; queda sin claves.
    }
    const fill: KeyFill = { id: row.id };
    for (const kind of PAYMENT_KEY_KINDS) {
      const key = keys[kind];
      if (key == null || used[kind].has(key)) continue;
      used[kind].add(key);
      fill[kind] = key;
    }
    if (PAYMENT_KEY_KINDS.some((kind) => fill[kind] != null)) fills.push(fill);
  }

  await handle.atomic((db) => {
    const queries: StoreQuery[] = [];
    if (fills.length > 0) {
      queries.push(db.execute(sql`SELECT set_config(${FILL_PAY_KEYS_SETTING}, 'on', true)`));
      for (const fill of fills) {
        queries.push(
          db
            .update(decisions)
            .set({ payFileKey: fill.file, payInvoiceKey: fill.invoice, payPeriodKey: fill.period })
            .where(
              and(
                eq(decisions.id, fill.id),
                isNull(decisions.payFileKey),
                isNull(decisions.payInvoiceKey),
                isNull(decisions.payPeriodKey),
              ),
            ),
        );
      }
      queries.push(db.execute(sql`SELECT set_config(${FILL_PAY_KEYS_SETTING}, 'off', true)`));
    }
    for (const stmt of PAYMENT_KEY_INDEX_STATEMENTS) queries.push(db.execute(sql.raw(stmt)));
    return queries;
  });
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
const GLOBAL_SCHEMA_KEY = "__centinelaStoreSchema";
type GlobalWithDb = typeof globalThis & { [GLOBAL_KEY]?: Promise<DbHandle>; [GLOBAL_SCHEMA_KEY]?: string };

/** El esquema que espera este código: cambia solo cuando cambia el SQL. */
const SCHEMA_SIGNATURE = [...SCHEMA_STATEMENTS, ...PAYMENT_KEY_INDEX_STATEMENTS].join("\n");

/**
 * Conexión compartida por todo el proceso (sobrevive al recargado en caliente de Next).
 * Si el código recargado espera otro esquema que la conexión ya abierta, lo migra sobre esa misma
 * conexión (abrir otra PGlite sobre la misma carpeta la corrompería).
 */
export function getDbHandle(): Promise<DbHandle> {
  const g = globalThis as GlobalWithDb;
  const existing = g[GLOBAL_KEY];
  if (existing) {
    if (g[GLOBAL_SCHEMA_KEY] === SCHEMA_SIGNATURE) return existing;
    const migrated: Promise<DbHandle> = existing.then(async (handle) => {
      await ensureSchema(handle);
      return handle;
    });
    g[GLOBAL_KEY] = migrated;
    g[GLOBAL_SCHEMA_KEY] = SCHEMA_SIGNATURE;
    migrated.catch(() => {
      if (g[GLOBAL_KEY] !== migrated) return;
      delete g[GLOBAL_SCHEMA_KEY];
      // Si la conexión abrió, se conserva y la próxima llamada reintenta la migración; si no, se olvida.
      existing.then(
        () => {
          if (g[GLOBAL_KEY] === migrated) g[GLOBAL_KEY] = existing;
        },
        () => {
          if (g[GLOBAL_KEY] === migrated) delete g[GLOBAL_KEY];
        },
      );
    });
    return migrated;
  }
  const pending: Promise<DbHandle> = openDb(configFromEnv()).catch((err: unknown) => {
    if (g[GLOBAL_KEY] === pending) {
      delete g[GLOBAL_KEY];
      delete g[GLOBAL_SCHEMA_KEY];
    }
    throw err;
  });
  g[GLOBAL_KEY] = pending;
  g[GLOBAL_SCHEMA_KEY] = SCHEMA_SIGNATURE;
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
  delete g[GLOBAL_SCHEMA_KEY];
  if (!existing) return;
  try {
    const handle = await existing;
    await handle.close();
  } catch {
    // Si la apertura había fallado no hay nada que cerrar.
  }
}
