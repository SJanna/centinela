/**
 * Exportación del registro de decisiones a CSV (separador coma, UTF-8 con BOM para que Excel
 * reconozca las tildes, fin de línea CRLF, columnas en español) y a JSON.
 *
 * Las dos llevan la clave de idempotencia de cada decisión (`./idempotency`), calculada al exportar:
 * no está guardada en la base ni cambia `DecisionRecord`.
 */
import type { DecisionRecord } from "../core/schemas";
import { toDecisionSummary } from "../store/mappers";
import { idempotencyKeyOf, type IdempotencyKey } from "./idempotency";

export const CSV_COLUMNS = [
  "id_decision",
  "fecha_decision",
  "id_factura",
  "archivo",
  "decision",
  "proveedor",
  "numero_factura",
  "clave_idempotencia",
  "moneda",
  "total",
  "monto_usd",
  "comprobaciones_no_superadas",
  "texto_sospechoso",
  "guardia_bajo_a_escalar",
  "modo_lectura",
  "resumen",
  "accion_para_una_persona",
] as const;

type Cell = string | number | boolean | null | undefined;

/** Modo de lectura como lo lee una persona (el registro guarda el identificador interno). */
export const READING_MODE_LABEL: Record<DecisionRecord["readingMode"], string> = {
  live: "en vivo",
  cache: "caché",
  simulated: "simulada",
};

/**
 * Una celda CSV. Los textos que empiezan como una fórmula (=, +, -, @) se anteponen con «'» para
 * que una hoja de cálculo no los ejecute (el nombre del archivo o del proveedor vienen de afuera).
 */
export function csvCell(value: Cell): string {
  if (value == null) return "";
  if (typeof value === "boolean") return value ? "sí" : "no";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  let text = value;
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function decisionsToCsv(records: readonly DecisionRecord[]): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const record of records) {
    const s = toDecisionSummary(record);
    const row: Cell[] = [
      s.id,
      s.decidedAt,
      s.invoiceId,
      s.filename,
      s.outcome,
      s.vendorName,
      s.invoiceNumber,
      idempotencyKeyOf(record).key,
      s.currency,
      s.total,
      s.amountUsd,
      s.failedChecks.join(" "),
      s.hasSuspiciousText,
      s.guardOverride,
      READING_MODE_LABEL[s.readingMode] ?? s.readingMode,
      s.summary,
      record.decision.humanAction,
    ];
    lines.push(row.map(csvCell).join(","));
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** Un registro exportado a JSON: el `DecisionRecord` tal cual, más su clave de idempotencia. */
export type ExportedDecision = DecisionRecord & { idempotency: IdempotencyKey };

export function withIdempotency(record: DecisionRecord): ExportedDecision {
  return { ...record, idempotency: idempotencyKeyOf(record) };
}

/** JSON del registro (del más antiguo al más reciente, como llega), con sangría de 2 espacios. */
export function decisionsToJson(records: readonly DecisionRecord[]): string {
  return JSON.stringify(records.map(withIdempotency), null, 2);
}
