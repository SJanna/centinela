/**
 * Actividad de cada proveedor a partir del registro de decisiones (función pura, para el servidor).
 * El proveedor de cada decisión sale del historial (`HistoryEntry.vendorId`, unido por `invoiceId`).
 * Si la decisión no identificó proveedor, o su id ya no está en la ficha, se empareja por nombre o alias.
 */
import { normalizeName } from "@/core/normalize";
import type { HistoryEntry, Outcome, Vendor } from "@/core/schemas";
import type { DecisionSummary } from "@/store/mappers";

export interface VendorActivity {
  invoices: number;
  byOutcome: Record<Outcome, number>;
  /** Suma de `amountUsd` de las decisiones PAGAR. */
  paidUsd: number;
  /** Pagado en la moneda de cada factura (PAGAR). */
  paidByCurrency: { currency: string; amount: number }[];
  /** ISO 8601 de la decisión más reciente. */
  lastDecidedAt: string | null;
}

export function emptyActivity(): VendorActivity {
  return { invoices: 0, byOutcome: { PAGAR: 0, FRENAR: 0, ESCALAR: 0 }, paidUsd: 0, paidByCurrency: [], lastDecidedAt: null };
}

/** Actividad por id de proveedor. Los proveedores sin decisiones no aparecen. */
export function vendorActivity(
  vendors: Vendor[],
  decisions: DecisionSummary[],
  history: Pick<HistoryEntry, "invoiceId" | "vendorId">[] = [],
): Record<string, VendorActivity> {
  const known = new Set(vendors.map((v) => v.id));
  const idByInvoice = new Map<string, string>();
  for (const h of history) if (h.vendorId && known.has(h.vendorId)) idByInvoice.set(h.invoiceId, h.vendorId);
  const byName = new Map<string, string>();
  for (const v of vendors) {
    for (const name of [v.name, ...v.aliases]) {
      const key = normalizeName(name);
      if (key && !byName.has(key)) byName.set(key, v.id);
    }
  }
  const out: Record<string, VendorActivity> = {};
  const paid: Record<string, Map<string, number>> = {};
  for (const d of decisions) {
    const key = normalizeName(d.vendorName);
    const vendorId = idByInvoice.get(d.invoiceId) ?? (key ? byName.get(key) : undefined);
    if (!vendorId) continue;
    const a = (out[vendorId] ??= emptyActivity());
    a.invoices += 1;
    a.byOutcome[d.outcome] += 1;
    if (!a.lastDecidedAt || d.decidedAt > a.lastDecidedAt) a.lastDecidedAt = d.decidedAt;
    if (d.outcome === "PAGAR") {
      if (typeof d.amountUsd === "number") a.paidUsd += d.amountUsd;
      if (typeof d.total === "number" && d.currency) {
        const m = (paid[vendorId] ??= new Map());
        m.set(d.currency, (m.get(d.currency) ?? 0) + d.total);
      }
    }
  }
  for (const [id, m] of Object.entries(paid)) {
    out[id].paidByCurrency = [...m.entries()].map(([currency, amount]) => ({ currency, amount }));
  }
  for (const a of Object.values(out)) a.paidUsd = Math.round(a.paidUsd * 100) / 100;
  return out;
}
