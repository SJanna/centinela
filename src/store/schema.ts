/**
 * Tablas de Centinela (Drizzle, Postgres). El SQL equivalente que crea las tablas vive en
 * `db.ts` (SCHEMA_STATEMENTS); una prueba verifica que ambos coincidan.
 *
 * Las fechas se guardan como timestamptz pero los repositorios leen siempre la fecha ISO
 * original desde el JSON (p. ej. `record.decidedAt`): las columnas sirven para ordenar.
 */
import { bigint, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type { Buyer, Extraction, Rules, Vendor, DecisionRecord, Outcome } from "../core/schemas";

const tsz = (name: string) => timestamp(name, { withTimezone: true, mode: "string" });

/** Una sola fila (id = 1): nombre de la empresa, reglas e identidad de compradora (`buyer`, opcional). */
export const companySettings = pgTable("company_settings", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  rules: jsonb("rules").$type<Rules>().notNull(),
  /** Razones sociales, alias e ids tributarios de la empresa (ACU-1 y la guardia). null si no se declaró. */
  buyer: jsonb("buyer").$type<Buyer>(),
  updatedAt: tsz("updated_at").notNull().defaultNow(),
});

/** Ficha de proveedores. `data` guarda el Vendor completo; `position` define el orden. */
export const vendors = pgTable("vendors", {
  id: text("id").primaryKey(),
  data: jsonb("data").$type<Vendor>().notNull(),
  position: integer("position").notNull(),
  updatedAt: tsz("updated_at").notNull().defaultNow(),
});

/** Archivos de factura subidos (bytes en base64). */
export const invoices = pgTable(
  "invoices",
  {
    id: text("id").primaryKey(),
    filename: text("filename").notNull(),
    mediaType: text("media_type").notNull(),
    fileHash: text("file_hash").notNull(),
    size: integer("size").notNull(),
    bytesB64: text("bytes_b64").notNull(),
    uploadedAt: tsz("uploaded_at").notNull().defaultNow(),
  },
  (t) => [index("invoices_file_hash_idx").on(t.fileHash)],
);

/**
 * Registro de decisiones. Solo se inserta: un disparador en la base rechaza UPDATE y DELETE
 * (el reinicio usa TRUNCATE). `seq` desempata decisiones con la misma `decided_at`.
 *
 * `pay_*_key`: claves de pago (ver `payment-keys.ts`), solo en las decisiones PAGAR. Sus índices
 * únicos impiden que dos instancias registren el mismo pago (los null no chocan).
 */
export const decisions = pgTable(
  "decisions",
  {
    id: text("id").primaryKey(),
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity(),
    invoiceId: text("invoice_id").notNull(),
    decidedAt: tsz("decided_at").notNull(),
    outcome: text("outcome").$type<Outcome>().notNull(),
    record: jsonb("record").$type<DecisionRecord>().notNull(),
    /** Huella del archivo pagado. */
    payFileKey: text("pay_file_key"),
    /** Proveedor + número de factura normalizado. */
    payInvoiceKey: text("pay_invoice_key"),
    /** Acuerdo + periodo (o + "once" si el acuerdo es de pago único). */
    payPeriodKey: text("pay_period_key"),
  },
  (t) => [
    index("decisions_decided_at_idx").on(t.decidedAt, t.seq),
    index("decisions_invoice_id_idx").on(t.invoiceId),
    uniqueIndex("decisions_pay_file_key_uq").on(t.payFileKey),
    uniqueIndex("decisions_pay_invoice_key_uq").on(t.payInvoiceKey),
    uniqueIndex("decisions_pay_period_key_uq").on(t.payPeriodKey),
  ],
);

/** Caché de lecturas del modelo (clave = sha256(fileHash + readerId + model + promptVersion)). */
export const readingCache = pgTable("reading_cache", {
  key: text("key").primaryKey(),
  extraction: jsonb("extraction").$type<Extraction>().notNull(),
  createdAt: tsz("created_at").notNull().defaultNow(),
});

/** Pares clave/valor de la aplicación (banderas, versión de datos de demostración, etc.). */
export const appMeta = pgTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const schema = { companySettings, vendors, invoices, decisions, readingCache, appMeta };
export type StoreSchema = typeof schema;
