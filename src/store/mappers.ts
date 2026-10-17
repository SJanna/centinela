/**
 * Conversiones puras de DecisionRecord a las vistas que usan el motor y la pantalla.
 */
import type { CheckCode, DecisionRecord, HistoryEntry, Outcome } from "../core/schemas";

/** Una fila del listado de decisiones (para la pantalla). */
export interface DecisionSummary {
  id: string;
  invoiceId: string;
  filename: string;
  decidedAt: string;
  outcome: Outcome;
  /** Nombre en la ficha (copia de la empresa al decidir) si hay proveedor; si no, el leído. */
  vendorName: string | null;
  /** Proveedor de la ficha identificado por el motor, o null. */
  vendorId: string | null;
  /** País del proveedor en la copia de la empresa al decidir (p. ej. "CO"), o null. */
  vendorCountry: string | null;
  invoiceNumber: string | null;
  total: number | null;
  currency: string | null;
  amountUsd: number | null;
  summary: string;
  readingMode: DecisionRecord["readingMode"];
  /** Comprobaciones que no pasaron (`fail` o `not_evaluable`), en el orden del catálogo. */
  failedChecks: CheckCode[];
  /** true si la verificación detectó texto que intenta dar órdenes. */
  hasSuspiciousText: boolean;
  guardOverride: boolean;
}

/** Entrada del historial que reciben el motor y la guardia. */
export function toHistoryEntry(record: DecisionRecord): HistoryEntry {
  const d = record.decision;
  return {
    invoiceId: record.invoiceId,
    fileHash: record.fileHash,
    outcome: d.outcome,
    vendorId: d.vendorId ?? null,
    invoiceNumber: record.reading?.data?.invoiceNumber ?? null,
    agreementId: d.agreementId ?? null,
    agreementPeriod: d.agreementPeriod ?? null,
    amountUsd: d.amountUsd ?? null,
    decidedAt: record.decidedAt,
  };
}

export function toDecisionSummary(record: DecisionRecord): DecisionSummary {
  const d = record.decision;
  const data = record.reading?.data ?? null;
  const vendorId = typeof d.vendorId === "string" && d.vendorId.length > 0 ? d.vendorId : null;
  const snapshotVendors = Array.isArray(record.companySnapshot?.vendors) ? record.companySnapshot.vendors : [];
  const vendor = vendorId ? snapshotVendors.find((v) => v?.id === vendorId) ?? null : null;
  const vendorFromFile = typeof vendor?.name === "string" ? vendor.name : null;
  const vendorCountry = typeof vendor?.country === "string" && vendor.country.trim().length > 0 ? vendor.country.trim() : null;
  return {
    id: record.id,
    invoiceId: record.invoiceId,
    filename: record.filename,
    decidedAt: record.decidedAt,
    outcome: d.outcome,
    vendorName: vendorFromFile ?? data?.vendorName ?? null,
    vendorId,
    vendorCountry,
    invoiceNumber: data?.invoiceNumber ?? null,
    total: data?.total ?? null,
    currency: data?.currency ?? null,
    amountUsd: d.amountUsd ?? null,
    summary: d.summary,
    readingMode: record.readingMode,
    failedChecks: (d.checks ?? []).filter((c) => c.status !== "pass").map((c) => c.code),
    hasSuspiciousText: (record.reading?.signals?.suspiciousInstructions?.length ?? 0) > 0,
    guardOverride: d.guardOverride === true,
  };
}
