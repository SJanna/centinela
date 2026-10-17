"use client";

import { FileDown, FileText, Image as ImageIcon, Mail, MessageSquare, Search, ShieldAlert, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDeferredValue, useMemo, useState, type ReactNode } from "react";
import { CHECK_BY_CODE } from "@/core/checks";
import type { DecisionSummary } from "@/store/mappers";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { EmptyState } from "@/components/ui/empty-state";
import { Money, formatMoneyText } from "@/components/ui/money";
import { Card } from "@/components/ui/sheet";
import { Badge, DecisionChip, SuspiciousBadge } from "@/components/ui/status";
import { useToast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import { Mono } from "@/components/ui/typography";
import { downloadFrom } from "./api";
import { READING_MODE_HELP, READING_MODE_SHORT, formatDateTime } from "./format";
import { LEDGER_FILTERS, decisionHref, type LedgerFilter } from "./ledger-filters";

/** Minúsculas y sin tildes, para buscar sin importar cómo se escribió. */
function fold(text: string | null | undefined): string {
  return (text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

const SINGULAR: Record<LedgerFilter, string> = { todas: "", pagadas: "pagada ", frenadas: "frenada ", escaladas: "escalada " };

/**
 * El motivo sin la parte que repite la decisión (el chip ya la dice):
 * "Se escala a una persona: no cumple «X»." → "No cumple «X»." El texto completo va en el tooltip.
 */
function motiveOf(d: DecisionSummary): string {
  // Las referencias internas ("(factura inv_…, decisión: Pagar)") quedan en el tooltip, no en la tabla.
  const summary = d.summary.trim().replace(/\s*\([^()]*\binv_[0-9a-z-]+[^()]*\)/gi, "");
  const m = /^Se (?:escala a una persona|frena|paga[^:]*):\s*([\s\S]+)$/.exec(summary);
  if (!m) return summary;
  let rest = m[1];
  if (d.outcome === "PAGAR") {
    const all = /Cumple las \d+ comprobaciones\.?/.exec(rest);
    if (all) rest = all[0];
  }
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

/** "LEC-1 · Datos completos y legibles", una por línea: para el title de los códigos. */
function failedChecksTitle(codes: DecisionSummary["failedChecks"]): string {
  return ["No pasaron:", ...codes.map((c) => `${c} · ${CHECK_BY_CODE[c]?.title ?? ""}`)].join("\n");
}

function FileKindIcon({ filename }: { filename: string }) {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const props = { "aria-hidden": true, size: 14, strokeWidth: 1.5, className: "shrink-0 text-ink-3" } as const;
  if (["png", "jpg", "jpeg", "webp", "gif", "heic"].includes(ext)) return <ImageIcon {...props} />;
  if (["eml", "msg"].includes(ext)) return <Mail {...props} />;
  if (["txt", "chat"].includes(ext)) return <MessageSquare {...props} />;
  return <FileText {...props} />;
}

function ExportButtons() {
  const { toast } = useToast();
  const [busy, setBusy] = useState<"json" | "csv" | null>(null);
  async function run(format: "json" | "csv") {
    setBusy(format);
    const r = await downloadFrom(`/api/export?format=${format}`, `centinela-registro.${format}`);
    setBusy(null);
    if (!r.ok) toast({ tone: "ERROR", title: "No se exportó el registro.", description: r.error });
  }
  return (
    <>
      <Button variant="secondary" size="sm" icon={<FileDown />} onClick={() => run("csv")} disabled={busy !== null}>
        {busy === "csv" ? "Exportando…" : "Exportar CSV"}
      </Button>
      <Button variant="secondary" size="sm" icon={<FileDown />} onClick={() => run("json")} disabled={busy !== null}>
        {busy === "json" ? "Exportando…" : "Exportar JSON"}
      </Button>
    </>
  );
}

interface LedgerViewProps {
  companyName: string;
  decisions: DecisionSummary[];
  initialFilter: LedgerFilter;
  initialQuery: string;
}

/** El registro completo: filtros por decisión, búsqueda y una fila por decisión que lleva a su detalle. */
export function LedgerView({ companyName, decisions, initialFilter, initialQuery }: LedgerViewProps) {
  const router = useRouter();
  const [filter, setFilter] = useState<LedgerFilter>(initialFilter);
  const [query, setQuery] = useState(initialQuery);
  const deferredQuery = useDeferredValue(query);

  const counts = useMemo(() => {
    const c: Record<LedgerFilter, number> = { todas: decisions.length, pagadas: 0, frenadas: 0, escaladas: 0 };
    for (const d of decisions) {
      if (d.outcome === "PAGAR") c.pagadas += 1;
      else if (d.outcome === "FRENAR") c.frenadas += 1;
      else c.escaladas += 1;
    }
    return c;
  }, [decisions]);

  const rows = useMemo(() => {
    const outcome = LEDGER_FILTERS.find((f) => f.key === filter)?.outcome ?? null;
    const q = fold(deferredQuery.trim());
    return decisions.filter((d) => {
      if (outcome && d.outcome !== outcome) return false;
      if (!q) return true;
      return fold(d.vendorName).includes(q) || fold(d.invoiceNumber).includes(q) || fold(d.filename).includes(q);
    });
  }, [decisions, filter, deferredQuery]);

  function syncUrl(nextFilter: LedgerFilter, nextQuery: string) {
    const params = new URLSearchParams();
    if (nextFilter !== "todas") params.set("decision", nextFilter);
    if (nextQuery.trim()) params.set("q", nextQuery.trim());
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `/registro?${qs}` : "/registro");
  }

  function changeFilter(next: LedgerFilter) {
    setFilter(next);
    syncUrl(next, query);
  }

  function changeQuery(next: string) {
    setQuery(next);
    syncUrl(filter, next);
  }

  const isFiltered = filter !== "todas" || query.trim() !== "";

  return (
    <>
      <PageHeader
        eyebrow={companyName}
        title="Registro de decisiones."
        description="Cada factura que leyó Centinela, con lo que decidió y por qué. Nada se borra ni se reescribe."
        actions={decisions.length > 0 ? <ExportButtons /> : null}
      />

      {decisions.length === 0 ? (
        <Card padding="none">
          <EmptyState
            title="El registro está vacío."
            description="Cada factura que revise Centinela queda aquí, con su decisión y su porqué."
            action={
              <Button href="/" size="sm" arrow="next">
                Ir al resumen
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="scrollbar-quiet -mx-1 max-w-[calc(100%+0.5rem)] overflow-x-auto px-1 py-0.5">
              <div role="radiogroup" aria-label="Filtrar por decisión" className="inline-flex rounded-pill bg-control/70 p-1">
                {LEDGER_FILTERS.map((f) => {
                  const active = filter === f.key;
                  return (
                    <button
                      key={f.key}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => changeFilter(f.key)}
                      className={cn(
                        "inline-flex h-8 shrink-0 items-center gap-2 rounded-pill px-3.5 text-small font-medium whitespace-nowrap transition-[background-color,color,box-shadow] duration-150",
                        active ? "bg-surface-0 text-navy shadow-[0_1px_2px_#1c253a1f] ring-1 ring-seam" : "text-ink-2 hover:text-navy",
                      )}
                    >
                      {f.outcome ? (
                        <span
                          aria-hidden
                          className={cn(
                            "size-1.5 rounded-full",
                            f.outcome === "PAGAR" ? "bg-pay-mark" : f.outcome === "FRENAR" ? "bg-hold-mark" : "bg-escalate-mark",
                          )}
                        />
                      ) : null}
                      {f.label}
                      <span className={cn("tnum text-caption", active ? "text-ink-2" : "text-ink-3")}>{counts[f.key]}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="relative w-full sm:w-[340px]">
              <Search aria-hidden size={15} strokeWidth={1.5} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-ink-3" />
              <label htmlFor="registro-buscar" className="sr-only">
                Buscar por proveedor, número o archivo
              </label>
              <input
                id="registro-buscar"
                type="search"
                value={query}
                onChange={(e) => changeQuery(e.target.value)}
                placeholder="Buscar proveedor, número o archivo"
                autoComplete="off"
                className="h-10 w-full rounded-pill border border-seam bg-surface-0 pr-9 pl-9 text-small text-ink shadow-hairline transition-[border-color,box-shadow] duration-150 placeholder:text-ink-3 hover:border-[#d5d9e5] focus:border-accent focus:ring-[3px] focus:ring-accent-wash focus:outline-none focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => changeQuery("")}
                  aria-label="Borrar búsqueda"
                  className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center rounded-full text-ink-3 hover:bg-surface-2 hover:text-ink-2"
                >
                  <X aria-hidden size={13} strokeWidth={1.75} />
                </button>
              ) : null}
            </div>
          </div>

          <Card padding="none" className="max-lg:overflow-x-auto">
            {rows.length === 0 ? (
              <EmptyState
                title="Nada coincide."
                description={
                  query.trim()
                    ? `Ninguna decisión ${SINGULAR[filter]}tiene «${query.trim()}» en el proveedor, el número o el archivo.`
                    : `Todavía no hay facturas ${filter}.`
                }
                action={
                  isFiltered ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setFilter("todas");
                        setQuery("");
                        syncUrl("todas", "");
                      }}
                    >
                      Ver todas
                    </Button>
                  ) : null
                }
              />
            ) : (
              <table className="w-full table-fixed border-collapse text-left text-small max-lg:min-w-[700px]">
                <thead>
                  <tr className="text-caption text-muted">
                    <Th className="w-[96px] pl-5">Fecha y hora</Th>
                    <Th className="w-[176px] xl:w-[196px]">Proveedor y número</Th>
                    <Th className="hidden w-[120px] xl:table-cell">Archivo</Th>
                    <Th className="w-[136px] text-right">Monto</Th>
                    <Th className="hidden w-[100px] text-right xl:table-cell">≈ USD</Th>
                    <Th className="w-[112px]">Decisión</Th>
                    <Th className="pr-5 xl:pr-3">Motivo</Th>
                    <Th className="hidden w-[84px] pr-5 xl:table-cell">Lectura</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((d, i) => {
                    const when = formatDateTime(d.decidedAt);
                    const href = decisionHref(d);
                    const tipSide = i === 0 ? "bottom" : "top";
                    return (
                      <tr
                        key={d.id}
                        onClick={(e) => {
                          if ((e.target as HTMLElement).closest("a, button")) return;
                          if (e.metaKey || e.ctrlKey) window.open(href, "_blank", "noopener");
                          else router.push(href);
                        }}
                        className="group h-16 cursor-pointer border-t border-seam align-middle transition-colors duration-150 hover:bg-row-active"
                      >
                        <td className="py-3 pr-3 pl-5 whitespace-nowrap">
                          <span className="block text-ink-2">{when.date}</span>
                          <Mono className="text-caption text-ink-3" title={d.decidedAt}>
                            {when.time}
                          </Mono>
                        </td>
                        <td className="px-3 py-3">
                          <Link
                            href={href}
                            className="block truncate font-medium text-navy outline-offset-2 hover:text-accent focus-visible:text-accent"
                          >
                            {d.vendorName ?? <span className="text-ink-3">Proveedor no leído</span>}
                          </Link>
                          <Mono className="block truncate text-caption text-ink-3">{d.invoiceNumber ?? "Sin número"}</Mono>
                          {/* Sin la columna Archivo (pantallas medianas), el archivo va bajo el número. */}
                          <span className="mt-0.5 flex min-w-0 items-center gap-1 xl:hidden" title={d.filename}>
                            <FileKindIcon filename={d.filename} />
                            <Mono className="truncate text-[11px] text-ink-3">{d.filename}</Mono>
                          </span>
                        </td>
                        <td className="hidden px-3 py-3 xl:table-cell">
                          <span className="flex min-w-0 items-center gap-1.5" title={d.filename}>
                            <FileKindIcon filename={d.filename} />
                            <Mono className="truncate text-caption text-ink-2">{d.filename}</Mono>
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right whitespace-nowrap">
                          {d.currency ? (
                            <Money amount={d.total} currency={d.currency} size="sm" className="text-navy" />
                          ) : (
                            <Money amount={d.total} display="none" size="sm" className="text-navy" />
                          )}
                          {/* Sin la columna ≈ USD, el equivalente va bajo el monto. */}
                          {d.amountUsd != null && d.currency !== "USD" ? (
                            <span className="tnum block text-caption text-ink-3 xl:hidden">≈ {formatMoneyText(d.amountUsd, "USD")}</span>
                          ) : null}
                        </td>
                        <td className="hidden px-3 py-3 text-right whitespace-nowrap xl:table-cell">
                          <Money amount={d.amountUsd} display="none" size="sm" className="text-ink-2" />
                        </td>
                        <td className="px-3 py-3">
                          <DecisionChip status={d.outcome} />
                        </td>
                        <td className="py-3 pr-5 pl-3 xl:pr-3">
                          <Tooltip
                            content={<span className="whitespace-normal">{d.summary}</span>}
                            side={tipSide}
                            align="end"
                            maxWidth={380}
                            className="w-full"
                          >
                            <span tabIndex={0} className="line-clamp-2 min-w-0 text-ink-2 outline-offset-2">
                              {motiveOf(d)}
                            </span>
                          </Tooltip>
                          {d.hasSuspiciousText || d.guardOverride || d.failedChecks.length > 0 ? (
                            <span className="mt-1 flex min-w-0 items-center gap-1.5">
                              {d.hasSuspiciousText ? (
                                <SuspiciousBadge className="h-[18px] shrink-0 gap-1 px-1.5 text-[10.5px] [&_svg]:size-[11px]">Sospechosa</SuspiciousBadge>
                              ) : null}
                              {d.guardOverride ? (
                                <Badge tone="info" icon={<ShieldAlert />} className="h-[18px] shrink-0 gap-1 px-1.5 text-[10.5px] [&_svg]:size-[11px]">
                                  Guardia
                                </Badge>
                              ) : null}
                              {d.failedChecks.length > 0 ? (
                                <Mono className="min-w-0 truncate text-[11px] text-ink-3" title={failedChecksTitle(d.failedChecks)}>
                                  {d.failedChecks.join(" · ")}
                                </Mono>
                              ) : null}
                            </span>
                          ) : null}
                        </td>
                        <td className="hidden py-3 pr-5 pl-3 whitespace-nowrap xl:table-cell">
                          <Tooltip content={<span className="whitespace-normal">{READING_MODE_HELP[d.readingMode]}</span>} side={tipSide} align="end">
                            <span tabIndex={0} className="cursor-help text-caption text-ink-3 decoration-faint decoration-dotted underline-offset-2 hover:underline">
                              {READING_MODE_SHORT[d.readingMode]}
                            </span>
                          </Tooltip>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Card>
          {rows.length > 0 ? (
            <p className="mt-3 text-caption text-muted">
              {rows.length === decisions.length
                ? `${decisions.length} ${decisions.length === 1 ? "decisión" : "decisiones"}, de la más reciente a la más antigua.`
                : `${rows.length} de ${decisions.length} decisiones.`}{" "}
              Horas de Bogotá.
            </p>
          ) : null}
        </>
      )}
    </>
  );
}

function Th({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <th scope="col" className={cn("px-3 py-3 font-medium whitespace-nowrap", className)}>
      {children}
    </th>
  );
}
