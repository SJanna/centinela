/**
 * Exportación del registro de decisiones a CSV (separador coma, UTF-8 con BOM para que Excel
 * reconozca las tildes, fin de línea CRLF, columnas en español).
 */
import type { DecisionRecord } from "../core/schemas";
import { toDecisionSummary } from "../store/mappers";

export const CSV_COLUMNS = [
  "id_decision",
  "fecha_decision",
  "id_factura",
  "archivo",
  "decision",
  "proveedor",
  "numero_factura",
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
