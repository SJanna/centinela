import { ShieldAlert } from "lucide-react";
import Link from "next/link";
import { Fragment } from "react";
import {
  Avatar,
  Badge,
  CheckIcon,
  CountryChip,
  cn,
  DecisionChip,
  Eyebrow,
  Mono,
  Money,
  Sheet,
  Superscript,
  SuspiciousBadge,
  Tooltip,
} from "@/components/ui";
import { CHECK_BY_CODE, CHECK_CATALOG } from "@/core/checks";
import type { CheckResult, Decision, DecisionRecord } from "@/core/schemas";
import { CheckMark } from "./check-mark";
import {
  CHECK_ANCHOR_PREFIX,
  displayVendorName,
  effectOf,
  noteNumbering,
  matchedAgreement,
  matchedVendor,
  summaryWithNotes,
  uniqueSuspicious,
} from "./decision-utils";
import { DetailActions } from "./detail-actions";
import { formatDateTimeUtc, formatNumber, READING_MODE_TEXT, readingsLine } from "./format";
import { linkInvoiceIds, type InvoiceRefs } from "./invoice-links";

function Breadcrumbs({ current }: { current: string }) {
  return (
    <nav aria-label="Migas" className="flex min-w-0 items-center gap-2 text-small text-ink-2">
      <Link href="/" className="transition-colors duration-150 hover:text-navy">
        Resumen
      </Link>
      <span aria-hidden className="text-faint">
        /
      </span>
      <Link href="/facturas" className="transition-colors duration-150 hover:text-navy">
        Facturas
      </Link>
      <span aria-hidden className="text-faint">
        /
      </span>
      <Mono className="truncate text-navy" title={current}>
        <span aria-current="page">{current}</span>
      </Mono>
    </nav>
  );
}

/**
 * Notas del porqué, numeradas como los superíndices de la frase: cada comprobación que no se cumple
 * con su explicación y sus valores. Las que no se pudieron evaluar van juntas en una línea.
 */
function ReasonNotes({ decision, refs }: { decision: Decision; refs: InvoiceRefs }) {
  const checks = decision.checks ?? [];
  const numbering = noteNumbering(decision);
  const byNumber = (a: CheckResult, b: CheckResult) => (numbering.get(a.code) ?? 0) - (numbering.get(b.code) ?? 0);
  const failing = checks.filter((c) => c.status === "fail").sort(byNumber);
  const unknown = checks.filter((c) => c.status === "not_evaluable").sort(byNumber);
  // La frase del porqué ya es la explicación de la causa principal (FRENAR): no se repite.
  const flat = (t: string) => t.toLowerCase().replace(/\s+/g, " ").replace(/[.\s]+$/, "");
  const inSummary = (c: CheckResult) => flat(decision.summary).includes(flat(c.explanation));
  const anchor = (code: CheckResult["code"]) => `#${CHECK_ANCHOR_PREFIX}-${numbering.get(code)}`;

  return (
    <div className="space-y-3">
      {failing.length > 0 ? (
        <ol className="space-y-2.5" aria-label="Comprobaciones que no se cumplen">
          {failing.map((c) => {
            const effect = effectOf(c);
            return (
              <li key={c.code} className="grid grid-cols-[14px_20px_minmax(0,1fr)] items-start gap-x-2">
                <span className="tnum pt-px text-right text-caption font-medium text-accent">{numbering.get(c.code)}</span>
                <CheckMark check={c} animate={false} className="mt-px" />
                <div className="min-w-0">
                  <p className="flex flex-wrap items-baseline gap-x-2 text-small">
                    <a
                      href={anchor(c.code)}
                      className="font-medium text-navy underline decoration-transparent underline-offset-2 transition-colors duration-150 hover:decoration-faint"
                    >
                      {CHECK_BY_CODE[c.code]?.title ?? c.code}
                    </a>
                    <span className={cn("text-caption font-medium", effect === "FRENAR" ? "text-hold" : "text-escalate")}>
                      {effect === "FRENAR" ? "Frena." : "Pide a una persona."}
                    </span>
                    <Mono className="text-caption whitespace-nowrap text-ink-3">{c.code}</Mono>
                  </p>
                  {inSummary(c) ? null : (
                    <p className="mt-0.5 line-clamp-3 text-small text-pretty text-ink-2">{linkInvoiceIds(c.explanation, refs)}</p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      ) : null}
      {unknown.length > 0 ? (
        <div className="grid grid-cols-[14px_20px_minmax(0,1fr)] items-start gap-x-2">
          <span aria-hidden />
          <CheckIcon status="warn" size={20} animate={false} label="Sin datos para evaluar" className="mt-px" />
          <p className="text-small text-ink-2">
            <span className="font-medium text-escalate">Sin datos para evaluar: </span>
            {unknown.map((c, i) => (
              <Fragment key={c.code}>
                {i > 0 ? <span className="text-ink-3"> · </span> : null}
                <a href={anchor(c.code)} className="whitespace-nowrap transition-colors duration-150 hover:text-navy">
                  <sup className="tnum top-[-0.4em] mr-0.5 text-[0.75em] font-medium text-accent">{numbering.get(c.code)}</sup>
                  {CHECK_BY_CODE[c.code]?.title ?? c.code}
                </a>
              </Fragment>
            ))}
            <span className="text-ink-3">. Sin ese dato no se paga: decide una persona.</span>
          </p>
        </div>
      ) : null}
    </div>
  );
}

/** Para un pago: los seis grupos de comprobaciones, todos cumplidos. */
function GroupStrip({ checks }: { checks: readonly CheckResult[] }) {
  const byCode = new Map(checks.map((c) => [c.code, c]));
  const groups = [...new Set(CHECK_CATALOG.map((c) => c.group))].map((group) => {
    const defs = CHECK_CATALOG.filter((c) => c.group === group);
    return { group, total: defs.length, pass: defs.filter((d) => byCode.get(d.code)?.status === "pass").length };
  });
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Comprobaciones por grupo">
      {groups.map((g) => (
        <li
          key={g.group}
          className="inline-flex h-7 items-center gap-1.5 rounded-pill bg-surface-1 pr-2.5 pl-1 text-caption text-ink-2 ring-1 ring-seam ring-inset"
        >
          <CheckIcon status={g.pass === g.total ? "pass" : "warn"} size={20} animate={false} />
          {g.group}
          <span className="tnum text-ink-3">
            {g.pass} de {g.total}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Aviso según la decisión: pendiente de una persona, guardia, pago aprobado o freno. */
function OutcomeNotice({ record }: { record: DecisionRecord }) {
  const d = record.decision;
  if (d.outcome === "ESCALAR") {
    return (
      <div className="space-y-3">
        {d.guardOverride ? (
          <div className="rounded-row bg-hold-wash/80 p-4 ring-1 ring-[#f1d9da] ring-inset">
            <p className="flex items-center gap-2 text-small font-medium text-hold">
              <ShieldAlert aria-hidden size={15} strokeWidth={1.75} />
              La guardia independiente no confirmó el pago.
            </p>
            <p className="mt-1.5 text-small text-ink-2">
              El motor proponía pagar. Una segunda revisión, escrita aparte, recalculó las reglas duras y encontró:
            </p>
            <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-small text-ink">
              {(d.guard?.violations ?? []).map((v) => (
                <li key={v}>{v}</li>
              ))}
            </ul>
            <p className="mt-1.5 text-small text-ink-2">Por eso no se paga sin una persona.</p>
          </div>
        ) : null}
        <div className="rounded-row bg-escalate-wash/70 p-4 ring-1 ring-[#f3dcc0] ring-inset">
          <p className="text-small font-medium text-escalate">Pendiente de una persona.</p>
          <p className="mt-1 text-small text-ink-2">
            <span className="text-muted">Acción sugerida: </span>
            {d.humanAction ?? "Revisar las comprobaciones que no se cumplen."}
          </p>
        </div>
      </div>
    );
  }
  if (d.outcome === "PAGAR") {
    return (
      <div className="rounded-row bg-pay-wash/70 p-4 ring-1 ring-[#c9e9df] ring-inset">
        <p className="text-small font-medium text-pay">Aprobada para pago.</p>
        <p className="mt-1 text-small text-ink-2">
          Cumple las 15 comprobaciones y la guardia independiente lo confirmó. Centinela no mueve dinero.
        </p>
      </div>
    );
  }
  const holding = (d.checks ?? []).filter((c) => effectOf(c) === "FRENAR").length;
  return (
    <div className="rounded-row bg-hold-wash/70 p-4 ring-1 ring-[#f1d9da] ring-inset">
      <p className="text-small font-medium text-hold">No se paga.</p>
      <p className="mt-1 text-small text-ink-2">
        {holding > 1 ? `${holding} comprobaciones que frenan no se cumplen.` : "Una comprobación que frena no se cumple."} Frenar no
        espera a una persona: la factura queda registrada y no se paga.
      </p>
    </div>
  );
}

export function DecisionHeader({ record, refs = {} }: { record: DecisionRecord; refs?: InvoiceRefs }) {
  const d = record.decision;
  const data = record.reading?.data ?? null;
  const vendor = matchedVendor(record);
  const agreement = matchedAgreement(record, vendor);
  const vendorName = displayVendorName(record);
  const invoiceNumber = data?.invoiceNumber ?? null;
  const currency = data?.currency ?? null;
  const fx = currency ? record.companySnapshot?.rules?.fxToUsd?.[currency] : undefined;
  const suspicious = uniqueSuspicious(record).length > 0;
  const parts = summaryWithNotes({ ...d, checks: d.checks ?? [] });
  const readings = readingsLine(record);
  const mode = READING_MODE_TEXT[record.readingMode] ?? { label: record.readingMode, help: "" };
  const failed = (d.checks ?? []).filter((c) => c.status !== "pass");

  return (
    <section aria-labelledby="factura-titulo" className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <Breadcrumbs current={invoiceNumber ?? record.filename} />
        <DetailActions record={record} />
      </div>

      <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-5">
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <DecisionChip status={d.outcome} size="lg" />
            {suspicious ? <SuspiciousBadge /> : null}
            {d.guardOverride ? (
              <Badge tone="danger" icon={<ShieldAlert />}>
                Bajada por la guardia
              </Badge>
            ) : null}
          </div>
          <div className="flex min-w-0 items-center gap-4">
            <Avatar name={vendorName} size={40} />
            <div className="min-w-0">
              <h1 id="factura-titulo" className="text-h1 text-navy">
                {vendorName ?? "Proveedor sin leer"}
              </h1>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-small text-ink-2">
                <span>
                  Factura <Mono className="text-navy">{invoiceNumber ?? "sin número"}</Mono>
                </span>
                {vendor ? <CountryChip country={vendor.country} currency={currency ?? agreement?.currency} /> : null}
                {!vendor && currency ? <Mono className="text-caption text-ink-3">{currency}</Mono> : null}
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-1 text-navy sm:text-right">
          <Eyebrow>Total de la factura</Eyebrow>
          {data?.total != null ? (
            <Money amount={data.total} currency={currency} size="kpi" />
          ) : (
            <p className="text-h2 text-escalate">Sin total legible.</p>
          )}
          {currency && currency !== "USD" && d.amountUsd != null ? (
            <p className="text-small text-ink-2">
              <Tooltip
                content={fx != null ? `Tasa fija de la empresa al decidir: 1 ${currency} = ${formatNumber(fx)} USD.` : "Tasa fija de la empresa."}
                side="bottom"
                align="end"
              >
                <span tabIndex={0} className="cursor-help border-b border-dashed border-faint">
                  ≈ <Money amount={d.amountUsd} currency="USD" size="sm" className="font-normal text-ink-2" />
                </span>
              </Tooltip>
            </p>
          ) : null}
        </div>
      </div>

      <Sheet padding="none" className="grid @3xl:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]">
        <div className="space-y-4 p-6">
          <Eyebrow>Por qué</Eyebrow>
          <p className="max-w-[62ch] text-h2 text-pretty text-navy">
            {parts.map((part, i) =>
              part.kind === "text" ? (
                <Fragment key={i}>{linkInvoiceIds(part.text, refs)}</Fragment>
              ) : (
                <Superscript key={i} n={part.numbers} prefix={CHECK_ANCHOR_PREFIX} />
              ),
            )}
          </p>

          {failed.length > 0 ? (
            <ReasonNotes decision={d} refs={refs} />
          ) : (
            <div className="space-y-2">
              <GroupStrip checks={d.checks ?? []} />
              {d.guardOverride ? (
                <p className="text-small text-ink-2">
                  El motor dio por cumplidas las 15 comprobaciones. La guardia, que las recalcula por su cuenta, no
                  confirmó el pago.
                </p>
              ) : null}
            </div>
          )}

          <dl className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-seam pt-4 text-small text-ink-2">
            <div className="flex items-center gap-2">
              <dt className="sr-only">Lecturas</dt>
              <CheckIcon status={readings.tone === "ok" ? "pass" : "warn"} size={16} animate={false} />
              <dd>{readings.text}</dd>
            </div>
            <div>
              <dt className="sr-only">Modo de lectura</dt>
              <dd>
                <Tooltip content={mode.help} side="top" align="start" maxWidth={280}>
                  <span tabIndex={0} className="cursor-help border-b border-dashed border-faint">
                    {mode.label}
                  </span>
                </Tooltip>
              </dd>
            </div>
            <div>
              <dt className="sr-only">Fecha de decisión</dt>
              <dd>
                Decidida el <span className="tnum">{formatDateTimeUtc(record.decidedAt)}</span>
              </dd>
            </div>
            <div>
              <dt className="sr-only">Registro</dt>
              <dd>
                <Mono className="text-ink-3">{record.id}</Mono>
              </dd>
            </div>
          </dl>
        </div>
        <div className="border-t border-seam p-6 @3xl:border-t-0 @3xl:border-l">
          <OutcomeNotice record={record} />
        </div>
      </Sheet>
    </section>
  );
}
