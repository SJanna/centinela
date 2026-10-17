/**
 * Filtros del registro y ruta del detalle. Sin "use client": lo usan la página (servidor) y la tabla.
 */
import type { Outcome } from "@/core/schemas";
import type { DecisionSummary } from "@/store/mappers";

export type LedgerFilter = "todas" | "pagadas" | "frenadas" | "escaladas";

export const LEDGER_FILTERS: readonly { key: LedgerFilter; label: string; outcome: Outcome | null }[] = [
  { key: "todas", label: "Todas", outcome: null },
  { key: "pagadas", label: "Pagadas", outcome: "PAGAR" },
  { key: "frenadas", label: "Frenadas", outcome: "FRENAR" },
  { key: "escaladas", label: "Escaladas", outcome: "ESCALAR" },
];

export function isLedgerFilter(value: unknown): value is LedgerFilter {
  return LEDGER_FILTERS.some((f) => f.key === value);
}

/** Ruta del detalle de una decisión. */
export function decisionHref(d: Pick<DecisionSummary, "id">): string {
  return `/facturas/${encodeURIComponent(d.id)}`;
}
