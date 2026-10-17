"use client";

import { ChevronRight, Download, Pencil, Plus, ShieldAlert, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { Fragment, useId, useMemo, useState } from "react";
import type { Company, Vendor } from "@/core/schemas";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { COUNTRY_NAME, CountryFlag } from "@/components/ui/country-flag";
import { EmptyState } from "@/components/ui/empty-state";
import { Card } from "@/components/ui/sheet";
import { Badge, DecisionChip } from "@/components/ui/status";
import { useToast } from "@/components/ui/toast";
import { Eyebrow, Mono, maskAccount } from "@/components/ui/typography";
import { requestJson, saveJson } from "./api";
import { Notice } from "./fields";
import {
  AGREEMENT_KIND_LABEL,
  agreementRule,
  agreementState,
  agreementSummary,
  formatAmount,
  formatDateTime,
  validityText,
  vendorValidity,
} from "./format";
import { ImportVendors } from "./import-vendors";
import { DangerButton, Modal, SidePanel } from "./overlay";
import type { VendorActivity } from "./vendor-activity";
import { VendorForm } from "./vendor-form";

interface VendorsViewProps {
  companyName: string;
  vendors: Vendor[];
  activity: Record<string, VendorActivity>;
  /** Monedas con tasa de cambio. */
  currencies: string[];
  /** Tolerancia de las reglas (ACU-3), en porcentaje. */
  tolerancePct: number;
  /** YYYY-MM-DD */
  today: string;
}

type PanelState = { mode: "create" } | { mode: "edit"; vendor: Vendor } | null;

function ValidityCell({ vendor, today }: { vendor: Vendor; today: string }) {
  const v = vendorValidity(vendor, today);
  if (v.state === "expired") return <Badge tone="warning">{v.text}</Badge>;
  if (v.state === "upcoming") return <Badge tone="info">{v.text}</Badge>;
  if (v.state === "none") return <Badge>{v.text}</Badge>;
  return <span className="text-ink-2">{v.text}</span>;
}

function ActivityCell({ activity }: { activity: VendorActivity | undefined }) {
  if (!activity || activity.invoices === 0) return <span className="text-ink-3">Sin facturas</span>;
  return (
    <span className="flex flex-col items-end gap-0.5">
      <span className="text-ink-2">{activity.invoices === 1 ? "1 factura" : `${activity.invoices} facturas`}</span>
      {activity.paidUsd > 0 ? (
        <span className="tnum text-caption text-muted">{formatAmount(activity.paidUsd, "USD")} pagado</span>
      ) : (
        <span className="text-caption text-ink-3">Sin pagos</span>
      )}
    </span>
  );
}

/** Ficha de proveedores: tabla con filas expandibles, panel para crear o editar, importar y exportar. */
export function VendorsView({ companyName, vendors, activity, currencies, tolerancePct, today }: VendorsViewProps) {
  const router = useRouter();
  const { toast } = useToast();
  const uid = useId();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [panel, setPanel] = useState<PanelState>(null);
  const [deleting, setDeleting] = useState<Vendor | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const takenIds = useMemo(() => vendors.map((v) => v.id), [vendors]);
  const activeCount = vendors.filter((v) => vendorValidity(v, today).state === "active").length;
  const withInvoices = vendors.filter((v) => (activity[v.id]?.invoices ?? 0) > 0).length;

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function exportVendors() {
    setExporting(true);
    const r = await requestJson<{ company: Company }>("/api/company", {
      method: "GET",
    });
    setExporting(false);
    if (!r.ok) {
      toast({
        tone: "ERROR",
        title: "No se exportaron los proveedores.",
        description: r.error,
      });
      return;
    }
    saveJson(r.data.company.vendors, `centinela-proveedores-${today}.json`);
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    setDeleteError(null);
    const r = await requestJson<{ company: Company }>(`/api/company/vendors/${encodeURIComponent(deleting.id)}`, {
      method: "DELETE",
    });
    setDeleteBusy(false);
    if (!r.ok) {
      setDeleteError(r.error);
      return;
    }
    toast({
      tone: "NEUTRAL",
      title: "Proveedor eliminado.",
      description: deleting.name,
    });
    setDeleting(null);
    router.refresh();
  }

  const panelTitleId = `${uid}-panel-title`;
  const deleteTitleId = `${uid}-delete-title`;
  const importTitleId = `${uid}-import-title`;

  return (
    <>
      <PageHeader
        eyebrow={companyName}
        title="Proveedores."
        description="Con quién hay acuerdos y a qué cuenta se le paga. Centinela solo paga a proveedores de esta ficha, a su cuenta registrada."
        actions={
          <>
            <Button variant="secondary" size="sm" icon={<Upload />} onClick={() => setImportOpen(true)}>
              Importar JSON
            </Button>
            <Button variant="secondary" size="sm" icon={<Download />} onClick={exportVendors} disabled={exporting}>
              Exportar JSON
            </Button>
            <Button size="sm" icon={<Plus />} onClick={() => setPanel({ mode: "create" })}>
              Nuevo proveedor
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <p className="text-small text-ink-2">
          <span className="tnum font-medium text-navy">{vendors.length}</span>{" "}
          {vendors.length === 1 ? "proveedor" : "proveedores"}
          <span className="text-faint"> · </span>
          <span className="tnum font-medium text-navy">{activeCount}</span> con acuerdo vigente
          <span className="text-faint"> · </span>
          <span className="tnum font-medium text-navy">{withInvoices}</span> con facturas
        </p>
        <p className="flex items-center gap-1.5 text-caption text-muted">
          <ShieldAlert aria-hidden size={14} strokeWidth={1.5} className="text-ink-3" />
          Cambiar una cuenta registrada es sensible. Las facturas que pidan pagar a otra cuenta se escalan.
        </p>
      </div>

      {vendors.length === 0 ? (
        <Card padding="none">
          <EmptyState
            title="Sin proveedores."
            description="Sin proveedores registrados, toda factura se escala. Crea uno o importa la ficha en JSON."
            action={
              <>
                <Button size="sm" icon={<Plus />} onClick={() => setPanel({ mode: "create" })}>
                  Nuevo proveedor
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setImportOpen(true)}>
                  Importar JSON
                </Button>
              </>
            }
          />
        </Card>
      ) : (
        <Card padding="none" className="max-lg:overflow-x-auto">
          <table className="w-full border-collapse text-left text-small max-lg:min-w-[700px]">
            <thead>
              <tr className="text-caption text-muted">
                <th scope="col" className="w-9 py-3 pl-3 font-medium">
                  <span className="sr-only">Ver acuerdos</span>
                </th>
                <th scope="col" className="py-3 pr-3 font-medium">
                  Proveedor
                </th>
                <th scope="col" className="hidden px-2.5 py-3 font-medium xl:table-cell">
                  ID tributario
                </th>
                <th scope="col" className="px-2.5 py-3 font-medium">
                  Cuenta registrada
                </th>
                <th scope="col" className="px-2.5 py-3 font-medium">
                  Acuerdo
                </th>
                <th scope="col" className="hidden px-2.5 py-3 font-medium xl:table-cell">
                  Vigencia
                </th>
                <th scope="col" className="hidden px-2.5 py-3 text-right font-medium xl:table-cell">
                  Actividad
                </th>
                <th scope="col" className="w-[88px] py-3 pr-4 font-medium">
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {vendors.map((v) => {
                const open = expanded.has(v.id);
                const detailId = `${uid}-detail-${v.id}`;
                const first = v.agreements[0];
                const act = activity[v.id];
                const validity = vendorValidity(v, today);
                return (
                  <Fragment key={v.id}>
                    <tr
                      onClick={() => toggle(v.id)}
                      className={cn(
                        "group h-14 cursor-pointer border-t border-seam align-middle transition-colors duration-150",
                        open ? "bg-row-active" : "hover:bg-row-active/70",
                      )}
                    >
                      <td className="py-2 pl-3">
                        <button
                          type="button"
                          aria-expanded={open}
                          aria-controls={detailId}
                          aria-label={open ? `Ocultar acuerdos de ${v.name}` : `Ver acuerdos de ${v.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggle(v.id);
                          }}
                          className="grid size-7 place-items-center rounded-full text-ink-3 transition-colors duration-150 hover:bg-surface-2 hover:text-ink-2"
                        >
                          <ChevronRight
                            aria-hidden
                            size={16}
                            strokeWidth={1.5}
                            className={cn("transition-transform duration-200 ease-out", open && "rotate-90")}
                          />
                        </button>
                      </td>
                      <td className="py-2 pr-3">
                        <span className="flex items-center gap-3">
                          <CountryFlag country={v.country} size={20} />
                          <span className="block max-w-[220px] min-w-0">
                            <span className="block truncate font-medium text-navy">{v.name}</span>
                            {v.aliases.length > 0 ? (
                              <span className="block truncate text-caption text-ink-3">{v.aliases.join(" · ")}</span>
                            ) : null}
                          </span>
                        </span>
                      </td>
                      <td className="hidden px-2.5 py-2 xl:table-cell">
                        {v.taxId ? (
                          <Mono className="text-caption whitespace-nowrap text-ink-2">{v.taxId}</Mono>
                        ) : (
                          <span className="text-ink-3">—</span>
                        )}
                      </td>
                      <td className="px-2.5 py-2">
                        <span className="block max-w-[136px] truncate text-ink-2" title={v.account.bankName}>
                          {v.account.bankName}
                        </span>
                        <Mono className="text-caption text-ink-3">{maskAccount(v.account.accountNumber)}</Mono>
                      </td>
                      <td className="px-2.5 py-2">
                        {first ? (
                          <>
                            <span className="tnum block whitespace-nowrap text-navy">{agreementSummary(first)}</span>
                            <span className="block text-caption text-ink-3">
                              {AGREEMENT_KIND_LABEL[first.kind]}
                              {v.agreements.length > 1 ? ` · y ${v.agreements.length - 1} más` : ""}
                            </span>
                            {/* Sin la columna Vigencia (pantallas medianas): solo el aviso si no está vigente. */}
                            {validity.state !== "active" ? (
                              <span className="mt-1 block xl:hidden">
                                <ValidityCell vendor={v} today={today} />
                              </span>
                            ) : null}
                          </>
                        ) : (
                          <span className="text-ink-3">Sin acuerdos</span>
                        )}
                      </td>
                      <td className="hidden px-2.5 py-2 whitespace-nowrap xl:table-cell">
                        <ValidityCell vendor={v} today={today} />
                      </td>
                      <td className="hidden px-2.5 py-2 text-right whitespace-nowrap xl:table-cell">
                        <ActivityCell activity={act} />
                      </td>
                      <td className="py-2 pr-4">
                        <span className="flex items-center justify-end gap-0.5">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPanel({ mode: "edit", vendor: v });
                            }}
                            aria-label={`Editar ${v.name}`}
                            title="Editar"
                            className="grid size-8 place-items-center rounded-full text-ink-3 transition-colors duration-150 hover:bg-surface-2 hover:text-navy"
                          >
                            <Pencil aria-hidden size={15} strokeWidth={1.5} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteError(null);
                              setDeleting(v);
                            }}
                            aria-label={`Eliminar ${v.name}`}
                            title="Eliminar"
                            className="grid size-8 place-items-center rounded-full text-ink-3 transition-colors duration-150 hover:bg-hold-wash hover:text-hold"
                          >
                            <Trash2 aria-hidden size={15} strokeWidth={1.5} />
                          </button>
                        </span>
                      </td>
                    </tr>
                    {open ? (
                      <tr id={detailId} className="bg-row-active">
                        <td />
                        <td colSpan={7} className="pr-4 pb-5">
                          <VendorDetail vendor={v} activity={act} today={today} tolerancePct={tolerancePct} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {/* Crear o editar */}
      <SidePanel open={panel !== null} onClose={() => setPanel(null)} labelledBy={panelTitleId}>
        {panel ? (
          <VendorForm
            key={panel.mode === "edit" ? panel.vendor.id : "new"}
            vendor={panel.mode === "edit" ? panel.vendor : null}
            takenIds={takenIds}
            currencies={currencies}
            today={today}
            titleId={panelTitleId}
            onClose={() => setPanel(null)}
            onSaved={(_company, vendor, created) => {
              setPanel(null);
              toast({
                tone: "NEUTRAL",
                title: created ? "Proveedor creado." : "Proveedor guardado.",
                description: vendor.name,
              });
              router.refresh();
            }}
          />
        ) : null}
      </SidePanel>

      {/* Eliminar */}
      <Modal
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        labelledBy={deleteTitleId}
        describedBy={`${deleteTitleId}-d`}
      >
        {deleting ? (
          <div>
            <div className="space-y-2 px-6 pt-6 pb-5">
              <Eyebrow>Proveedores</Eyebrow>
              <h2 id={deleteTitleId} className="text-h2">
                Eliminar a {deleting.name.replace(/\.+$/, "")}.
              </h2>
              <p id={`${deleteTitleId}-d`} className="text-small text-ink-2">
                Sale de la ficha. Sus próximas facturas se escalan porque el proveedor no estará registrado. Las
                decisiones ya tomadas no cambian.
              </p>
              {deleteError ? (
                <Notice tone="danger" role="alert" className="mt-3">
                  {deleteError}
                </Notice>
              ) : null}
            </div>
            <footer className="flex items-center justify-end gap-2 border-t border-seam px-6 py-4">
              <Button variant="ghost" onClick={() => setDeleting(null)} data-autofocus>
                Cancelar
              </Button>
              <DangerButton onClick={confirmDelete} disabled={deleteBusy}>
                {deleteBusy ? "Eliminando…" : "Eliminar proveedor"}
              </DangerButton>
            </footer>
          </div>
        ) : null}
      </Modal>

      {/* Importar */}
      <Modal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        labelledBy={importTitleId}
        className="max-w-[560px]"
      >
        {importOpen ? (
          <ImportVendors
            titleId={importTitleId}
            currentCount={vendors.length}
            onClose={() => setImportOpen(false)}
            onImported={(company) => {
              setImportOpen(false);
              toast({
                tone: "NEUTRAL",
                title: "Proveedores importados.",
                description: `${company.vendors.length} en la ficha. Aplican a las próximas facturas.`,
              });
              router.refresh();
            }}
          />
        ) : null}
      </Modal>
    </>
  );
}

function VendorDetail({
  vendor: v,
  activity,
  today,
  tolerancePct,
}: {
  vendor: Vendor;
  activity: VendorActivity | undefined;
  today: string;
  tolerancePct: number;
}) {
  return (
    <div className="grid animate-rise gap-4 rounded-card border border-row-active-border bg-surface-0 p-5 shadow-hairline lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="min-w-0">
        <Eyebrow className="mb-2">
          {v.agreements.length === 1 ? "Acuerdo" : `Acuerdos · ${v.agreements.length}`}
        </Eyebrow>
        {v.agreements.length === 0 ? (
          <p className="text-small text-ink-2">Sin acuerdos. Sus facturas se escalan hasta que haya uno vigente.</p>
        ) : (
          <>
            <ul className="divide-y divide-seam">
              {v.agreements.map((a) => {
                const state = agreementState(a, today);
                return (
                  <li
                    key={a.id}
                    className="grid gap-x-6 gap-y-1 py-2.5 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto]"
                  >
                    <div className="min-w-0">
                      <p className="text-small font-medium text-navy">{a.description}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-caption text-muted">
                        <span>{AGREEMENT_KIND_LABEL[a.kind]}</span>
                        <span className="text-faint">·</span>
                        <Mono>{a.id}</Mono>
                      </p>
                      <p className="mt-1.5 text-caption text-ink-2">{agreementRule(a, tolerancePct)}</p>
                    </div>
                    <div className="text-left sm:text-right">
                      <p className="tnum text-small text-navy">{agreementSummary(a)}</p>
                      <p
                        className={cn(
                          "text-caption",
                          state === "expired" ? "text-warning" : state === "upcoming" ? "text-info" : "text-muted",
                        )}
                      >
                        {validityText(a, today)}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 border-t border-seam pt-3 text-caption text-muted">
              Una factura en otra moneda, fuera de la vigencia o fuera de estas cifras se escala a una persona.
            </p>
          </>
        )}
      </div>
      <div className="space-y-4 border-seam lg:border-l lg:pl-5">
        <div>
          <Eyebrow className="mb-2">Cuenta registrada</Eyebrow>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-caption">
            {v.taxId ? (
              <>
                <dt className="text-muted">ID tributario</dt>
                <dd>
                  <Mono className="text-ink-2">{v.taxId}</Mono>
                </dd>
              </>
            ) : null}
            <dt className="text-muted">Beneficiario</dt>
            <dd className="truncate text-ink-2">{v.account.beneficiaryName}</dd>
            <dt className="text-muted">Banco</dt>
            <dd className="truncate text-ink-2">
              {v.account.bankName} · {COUNTRY_NAME[v.country] ?? v.country}
            </dd>
            <dt className="text-muted">Cuenta</dt>
            <dd>
              <Mono className="text-ink-2">{maskAccount(v.account.accountNumber)}</Mono>
            </dd>
            {v.account.routingOrSwift ? (
              <>
                <dt className="text-muted">SWIFT o ruta</dt>
                <dd>
                  <Mono className="text-ink-2">{v.account.routingOrSwift}</Mono>
                </dd>
              </>
            ) : null}
          </dl>
        </div>
        <div>
          <Eyebrow className="mb-2">Decisiones</Eyebrow>
          {activity && activity.invoices > 0 ? (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {(["PAGAR", "FRENAR", "ESCALAR"] as const)
                  .filter((o) => activity.byOutcome[o] > 0)
                  .map((o) => (
                    <DecisionChip
                      key={o}
                      status={o}
                      label={`${activity.byOutcome[o]} ${o === "PAGAR" ? "pagada" : o === "FRENAR" ? "frenada" : "escalada"}${activity.byOutcome[o] === 1 ? "" : "s"}`}
                    />
                  ))}
              </div>
              {activity.paidByCurrency.length > 0 ? (
                <p className="text-caption text-muted">
                  Pagado: {activity.paidByCurrency.map((p) => formatAmount(p.amount, p.currency)).join(" · ")}
                </p>
              ) : null}
              {activity.lastDecidedAt ? (
                <p className="text-caption text-muted">Última: {formatDateTime(activity.lastDecidedAt).date}</p>
              ) : null}
            </div>
          ) : (
            <p className="text-caption text-ink-3">Sin facturas registradas.</p>
          )}
        </div>
      </div>
    </div>
  );
}
