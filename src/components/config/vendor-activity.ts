/**
 * Actividad de cada proveedor a partir del registro de decisiones (funciones puras, para el servidor).
 * El proveedor de cada decisión es el que identificó el motor (`DecisionSummary.vendorId`).
 * Si la decisión no identificó proveedor, o su id ya no está en la ficha, se empareja por nombre o alias.
 */
import { normalizeName } from "@/core/normalize";
import type { DecisionRecord, Outcome, Vendor } from "@/core/schemas";
import type { DecisionSummary } from "@/store/mappers";

/** Una factura que pidió pagar a una cuenta distinta de la registrada (PRV-2 en `fail`). */
export interface AccountAlert {
  decisionId: string;
  decidedAt: string;
  filename: string;
  /** Últimos 4 dígitos de la cuenta que pedía la factura, si se leyeron. */
  requestedLast4: string | null;
  /** Últimos 4 dígitos de la cuenta registrada al decidir. */
  registeredLast4: string | null;
  outcome: Outcome;
}

/** Facturas que pidieron pagar a otra cuenta, por id de proveedor (la más reciente primero). */
export function accountAlerts(records: DecisionRecord[]): Record<string, AccountAlert[]> {
  const out: Record<string, AccountAlert[]> = {};
  for (const r of records) {
    const check = r.decision.checks.find((c) => c.code === "PRV-2");
    if (!check || check.status !== "fail") continue;
    const vendorId = r.decision.vendorId ?? (typeof check.params.vendorId === "string" ? check.params.vendorId : null);
    if (!vendorId) continue;
    const last4 = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
    (out[vendorId] ??= []).push({
      decisionId: r.id,
      decidedAt: r.decidedAt,
      filename: r.filename,
      requestedLast4: last4(check.params.invoiceAccountLast4),
      registeredLast4: last4(check.params.registeredAccountLast4),
      outcome: r.decision.outcome,
    });
  }
  for (const list of Object.values(out)) list.sort((a, b) => b.decidedAt.localeCompare(a.decidedAt));
  return out;
}

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
export function vendorActivity(vendors: Vendor[], decisions: DecisionSummary[]): Record<string, VendorActivity> {
  const known = new Set(vendors.map((v) => v.id));
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
    const vendorId = (d.vendorId && known.has(d.vendorId) ? d.vendorId : undefined) ?? (key ? byName.get(key) : undefined);
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
