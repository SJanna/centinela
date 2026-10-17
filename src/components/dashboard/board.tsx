"use client";

/**
 * Tablero de decisiones: tres columnas (Pagadas / Frenadas / Escaladas) o una lista de filas de 64px.
 */
import { Columns3, Rows3 } from "lucide-react";
import type { Outcome } from "@/core/schemas";
import { cn } from "@/components/ui/cn";
import { CountUp, CountUpMoney } from "@/components/ui/count-up";
import { StatusDot } from "@/components/ui/status";
import { DECISION_GROUP_LABEL } from "@/components/ui/tones";
import { sumUsd } from "./format";
import { InvoiceCard, InvoiceRow } from "./invoice-card";
import type { BoardItem, VendorCountries, ViewMode } from "./types";

const OUTCOMES: readonly Outcome[] = ["PAGAR", "FRENAR", "ESCALAR"];

const EMPTY_COLUMN: Record<Outcome, string> = {
  PAGAR: "Ninguna pagada todavía.",
  FRENAR: "Ninguna frenada.",
  ESCALAR: "Nada pendiente de una persona.",
};

/** Alternador "Tablero / Lista". */
export function ViewToggle({ view, onChange }: { view: ViewMode; onChange: (view: ViewMode) => void }) {
  const options: { value: ViewMode; label: string; icon: typeof Columns3 }[] = [
    { value: "board", label: "Tablero", icon: Columns3 },
    { value: "list", label: "Lista", icon: Rows3 },
  ];
  return (
    <div role="group" aria-label="Vista de las facturas" className="inline-flex rounded-pill bg-control p-0.5">
      {options.map(({ value, label, icon: Icon }) => {
        const active = view === value;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(value)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-pill px-3 text-caption font-medium transition-[background-color,color,box-shadow] duration-150 ease-out",
              active ? "bg-surface-0 text-navy shadow-[0_1px_2px_#1c253a14]" : "text-ink-2 hover:text-navy",
            )}
          >
            <Icon aria-hidden size={14} strokeWidth={1.5} className={active ? "text-accent" : "text-ink-3"} />
            {label}
          </button>
        );
      })}
    </div>
  );
}

/** Cabecera de una columna: punto, nombre, conteo y total en USD (mono). Conteo y total suben animados. */
export function ColumnHeader({ outcome, count, totalUsd }: { outcome: Outcome; count: number; totalUsd: number }) {
  const id = `columna-${outcome.toLowerCase()}`;
  return (
    <div className="flex h-8 items-center justify-between gap-2 px-1">
      <div className="flex min-w-0 items-center gap-2">
        <StatusDot status={outcome} size={7} halo />
        <h3 id={id} className="text-small font-medium text-navy">
          {DECISION_GROUP_LABEL[outcome]}
        </h3>
        <CountUp value={count} size="sm" duration={0.6} className="text-ink-3" />
      </div>
      <CountUpMoney
        amount={totalUsd}
        size="sm"
        display="code"
        duration={0.6}
        className="font-mono text-[12px] font-normal tracking-[-0.02em] text-ink-2"
      />
    </div>
  );
}

interface BoardProps {
  items: BoardItem[];
  view: ViewMode;
  /** Ámbito de los layoutId (ver layoutIdOf). */
  scope: string;
  countries: VendorCountries;
  now: number;
}

export function Board({ items, view, scope, countries, now }: BoardProps) {
  if (view === "list") {
    return (
      <div className="min-w-0">
        <div className="mb-3 flex h-8 flex-wrap items-center gap-x-5 gap-y-1 px-1">
          {OUTCOMES.map((o) => {
            const list = items.filter((i) => i.decision.outcome === o);
            return (
              <span key={o} className="inline-flex items-center gap-2 text-small">
                <StatusDot status={o} size={7} halo />
                <span className="font-medium text-navy">{DECISION_GROUP_LABEL[o]}</span>
                <CountUp value={list.length} size="sm" duration={0.6} className="text-ink-3" />
              </span>
            );
          })}
        </div>
        {items.length === 0 ? (
          <EmptyColumn text="Sin facturas decididas." />
        ) : (
          <ul className="rounded-card border border-seam bg-surface-0 p-1.5 shadow-hairline" aria-label="Facturas decididas">
            {items.map((item, i) => (
              <InvoiceRow key={item.layoutKey} item={item} scope={scope} countries={countries} now={now} index={i} />
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="grid min-w-0 gap-4 md:grid-cols-3">
      {OUTCOMES.map((outcome) => {
        const list = items.filter((i) => i.decision.outcome === outcome);
        const decisions = list.map((i) => i.decision);
        return (
          <section key={outcome} aria-labelledby={`columna-${outcome.toLowerCase()}`} className="min-w-0">
            <ColumnHeader outcome={outcome} count={list.length} totalUsd={sumUsd(decisions, outcome)} />
            {list.length === 0 ? (
              <EmptyColumn text={EMPTY_COLUMN[outcome]} className="mt-3" />
            ) : (
              <ul className="mt-3 flex flex-col gap-2.5">
                {list.map((item, i) => (
                  <InvoiceCard key={item.layoutKey} item={item} scope={scope} countries={countries} now={now} index={i} />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

function EmptyColumn({ text, className }: { text: string; className?: string }) {
  return (
    <div
      className={cn(
        "grid h-24 place-items-center rounded-row border border-dashed border-line px-4 text-center text-caption text-ink-3",
        className,
      )}
    >
      {text}
    </div>
  );
}
