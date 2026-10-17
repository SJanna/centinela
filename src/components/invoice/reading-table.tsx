"use client";

import type { ReactNode } from "react";
import { CheckIcon, cn, maskAccount, Mono, Money, Sheet, Tooltip } from "@/components/ui";
import type { Extraction, ReadingAssessment, ReaderResult } from "@/core/schemas";
import { useDetail } from "./detail-context";
import { formatDateLong, formatDateShort, formatPeriod, READER_ERROR_LABEL } from "./format";
import {
  CHECK_FIELDS,
  extractionOf,
  FIELD_ROWS,
  readField,
  readingsAgree,
  readLines,
  type FieldKey,
  type FieldRow,
} from "./fields";

/** Cuenta enmascarada (•••• 7891); completa al pasar el cursor o al enfocar. */
export function MaskedAccount({ value, className }: { value: string; className?: string }) {
  const masked = maskAccount(value);
  if (masked === value.replace(/[^A-Za-z0-9]/g, "")) return <Mono className={className}>{value}</Mono>;
  return (
    <span
      tabIndex={0}
      className={cn("group/acct inline-grid cursor-default rounded-[4px] outline-none focus-visible:ring-2 focus-visible:ring-accent", className)}
      aria-label={`Cuenta terminada en ${value.replace(/[^A-Za-z0-9]/g, "").slice(-4)}`}
    >
      <Mono className="col-start-1 row-start-1 transition-opacity duration-150 group-hover/acct:opacity-0 group-focus/acct:opacity-0">
        {masked}
      </Mono>
      <Mono className="col-start-1 row-start-1 opacity-0 transition-opacity duration-150 group-hover/acct:opacity-100 group-focus/acct:opacity-100">
        {value}
      </Mono>
    </span>
  );
}

function Missing() {
  return <span className="text-caption text-ink-3 italic">No se leyó</span>;
}

function renderValue(row: FieldRow, value: string | number | null | undefined, currency: string | null): ReactNode {
  if (value == null || value === "") return <Missing />;
  switch (row.format) {
    case "money":
      return typeof value === "number" ? <Money amount={value} currency={currency ?? undefined} size="sm" display={currency ? "code" : "none"} /> : String(value);
    case "date":
      return (
        <span className="whitespace-nowrap" title={formatDateLong(String(value))}>
          {formatDateShort(String(value))}
        </span>
      );
    case "period":
      return formatPeriod(String(value));
    case "currency":
      return <Mono>{String(value)}</Mono>;
    case "account":
      return <MaskedAccount value={String(value)} />;
    default:
      return String(value);
  }
}

function readerCaption(result: ReaderResult | null): string {
  if (!result) return "No disponible";
  if (!result.ok) return READER_ERROR_LABEL[result.error] ?? "Falló";
  return result.model;
}

interface CellData {
  value: ReactNode;
  evidence: string | null;
  legible: boolean | null;
}

function cellFor(row: FieldRow, result: ReaderResult | null): CellData | null {
  const e = extractionOf(result);
  if (!e) return null;
  const currency = typeof e.currency?.value === "string" ? e.currency.value : null;
  if (row.key === "lineItems") {
    const lines = readLines(e);
    if (!lines || lines.count === 0) return { value: <Missing />, evidence: null, legible: null };
    return {
      value: (
        <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
          <span>{lines.count === 1 ? "1 línea" : `${lines.count} líneas`}</span>
          <span className="text-ink-3">·</span>
          <Money amount={lines.sum} currency={currency ?? undefined} size="sm" display={currency ? "code" : "none"} />
        </span>
      ),
      evidence: lines.items[0]?.description ?? null,
      legible: null,
    };
  }
  const f = readField(e, row.key as Exclude<FieldKey, "lineItems">);
  if (!f) return { value: <Missing />, evidence: null, legible: null };
  return { value: renderValue(row, f.value, currency), evidence: f.evidence, legible: f.legible };
}

function hasValue(key: FieldKey, e: Extraction | null): boolean {
  if (!e) return false;
  if (key === "lineItems") return (readLines(e)?.count ?? 0) > 0;
  const v = readField(e, key)?.value;
  return v != null && v !== "";
}

export function ReadingTable({ reading }: { reading: ReadingAssessment }) {
  const { activeCheck, setActiveField, activeField } = useDetail();
  const a = reading.primary;
  const b = reading.secondary;
  const ea = extractionOf(a);
  const eb = extractionOf(b);
  const secondAvailable = eb != null;
  const disagree = new Set(reading.signals.readersDisagreeOn);
  const highlighted = new Set<FieldKey>(activeCheck ? CHECK_FIELDS[activeCheck] : []);

  return (
    <Sheet padding="none" aria-labelledby="datos-titulo" className="overflow-hidden">
      <header className="space-y-1 px-6 pt-6 pb-4">
        <h2 id="datos-titulo" className="text-h2">
          Datos leídos
        </h2>
        <p className="text-small text-ink-2">
          Dos lecturas independientes. La decisión usa la lectura A; la B sirve para comprobarla.
        </p>
      </header>
      <div className="overflow-x-auto scrollbar-quiet">
        <table className="w-full min-w-[560px] table-fixed text-left text-small">
          <colgroup>
            <col className="w-[23%]" />
            <col className="w-[24%]" />
            <col className="w-[26%]" />
            <col className="w-[27%]" />
          </colgroup>
          <thead>
            <tr className="border-y border-seam bg-surface-1/70 text-caption text-muted">
              <th scope="col" className="py-2.5 pr-2 pl-6 font-medium">
                Campo
              </th>
              <th scope="col" className="px-2 py-2.5 font-medium">
                <span className="block">Lectura A</span>
                <Mono className="block truncate text-[11px] font-normal text-ink-3">{readerCaption(a)}</Mono>
              </th>
              <th scope="col" className="px-2 py-2.5 font-medium">
                <span className="block">Lectura B</span>
                <Mono className="block truncate text-[11px] font-normal text-ink-3">{readerCaption(b)}</Mono>
              </th>
              <th scope="col" className="py-2.5 pr-6 pl-2 font-medium">
                <span className="block">Evidencia</span>
                <span className="block text-[11px] font-normal text-ink-3">Cita del documento</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-seam">
            {FIELD_ROWS.map((row) => {
              const ca = cellFor(row, a);
              const cb = cellFor(row, b);
              const isHighlighted = highlighted.has(row.key);
              const isHovered = activeField === row.key;
              // La marca solo tiene sentido si las dos lecturas trajeron algo que comparar.
              let agree: boolean | null = null;
              if (row.match && ea && secondAvailable && (hasValue(row.key, ea) || hasValue(row.key, eb))) {
                agree = row.match === "critical" ? !disagree.has(row.key) : readingsAgree(row.key, ea, eb);
              }
              const legible =
                ca?.legible == null ? null : cb?.legible == null ? ca.legible : Boolean(ca.legible && cb.legible);
              const evidence = ca?.evidence ?? cb?.evidence ?? null;
              return (
                <tr
                  key={row.key}
                  data-field={row.key}
                  onMouseEnter={() => setActiveField(row.key)}
                  onMouseLeave={() => setActiveField(null)}
                  className={cn(
                    "align-top transition-[background-color,box-shadow] duration-150 ease-out",
                    isHighlighted && "bg-accent-wash shadow-[inset_2px_0_0_var(--color-accent)]",
                    !isHighlighted && isHovered && "bg-row-active",
                  )}
                >
                  <th scope="row" className="py-2.5 pr-2 pl-6 font-normal">
                    <span className={cn("block font-medium", isHighlighted ? "text-accent" : "text-navy")}>{row.label}</span>
                    {row.match === "critical" ? <span className="block text-[11px] text-ink-3">Dato crítico</span> : null}
                    {legible === false ? <span className="block text-[11px] font-medium text-escalate">Ilegible</span> : null}
                  </th>
                  <td className="px-2 py-2.5 break-words text-ink">{ca ? ca.value : <span className="text-caption text-ink-3">Falló</span>}</td>
                  <td className="px-2 py-2.5">
                    {cb ? (
                      <span className="flex items-start gap-1.5">
                        {agree != null ? (
                          <Tooltip content={agree ? "Las dos lecturas coinciden." : "Las lecturas no coinciden en este dato."} side="top" align="start">
                            <span tabIndex={0} className="mt-px inline-flex rounded-full">
                              <CheckIcon status={agree ? "pass" : "warn"} size={16} animate={false} label={agree ? "Coincide" : "No coincide"} />
                            </span>
                          </Tooltip>
                        ) : null}
                        <span className={cn("min-w-0 break-words", agree === false ? "text-escalate" : agree ? "text-ink-2" : "text-ink")}>
                          {cb.value}
                        </span>
                      </span>
                    ) : (
                      <span className="text-caption text-ink-3">{b ? "Falló" : "No disponible"}</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-6 pl-2 text-caption text-ink-2">
                    {evidence ? (
                      row.format === "account" ? (
                        <MaskedAccount value={evidence} className="text-caption" />
                      ) : (
                        <span className="line-clamp-2 break-words" title={evidence}>
                          «{evidence}»
                        </span>
                      )
                    ) : (
                      <span className="text-ink-3">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Sheet>
  );
}
