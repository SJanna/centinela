"use client";

/**
 * Una factura decidida: tarjeta del tablero (columna) o fila de la lista (64px).
 * Comparten `layoutId` con la fila de subida para que la tarjeta "caiga" en su sitio.
 */
import { motion } from "motion/react";
import { ShieldAlert } from "lucide-react";
import Link from "next/link";
import { Fragment } from "react";
import type { CheckCode } from "@/core/schemas";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/components/ui/cn";
import { CountryChip, CountryFlag, COUNTRY_NAME } from "@/components/ui/country-flag";
import { Money, moneyParts } from "@/components/ui/money";
import { Badge, DecisionChip, SuspiciousBadge } from "@/components/ui/status";
import { checkTitle, countryOf, reasonOf, relativeTime } from "./format";
import type { BoardItem, VendorCountries } from "./types";

/** Resorte de la caída: suave, sin rebote visible. */
export const LAND_SPRING = { type: "spring", stiffness: 380, damping: 32 } as const;

/** Escalonado de la primera aparición (ms por tarjeta, con tope). */
const STAGGER_S = 0.035;
const MAX_STAGGER_S = 0.4;

/**
 * Id compartido entre la fila de subida y la tarjeta (o fila de la lista) en que cae.
 * `scope` cambia con cada cambio de vista: motion recuerda la última forma de cada id y, si se
 * reusara, las tarjetas volarían desde donde estaban antes de cambiar de vista.
 */
export function layoutIdOf(key: string, scope: string): string {
  return `factura-${scope}-${key}`;
}

/**
 * Códigos que explican la decisión, en superíndice (mono), el decisivo primero. Se pegan a la última
 * palabra del motivo y, si no caben, se cortan entre códigos (nunca dentro de "LEC-1").
 */
function FailedCodes({ codes, max = 3, wrap = true }: { codes: CheckCode[]; max?: number; wrap?: boolean }) {
  if (codes.length === 0) return null;
  const shown = codes.slice(0, max);
  const rest = codes.length - shown.length;
  return (
    <sup className={cn("ml-[0.2em] font-mono text-[0.72em] font-medium tracking-[-0.01em] text-accent", !wrap && "whitespace-nowrap")}>
      {shown.map((code, i) => (
        <Fragment key={code}>
          {i > 0 ? (
            <>
              <span className="text-ink-3">,</span>
              {wrap ? <wbr /> : null}
            </>
          ) : null}
          <span title={checkTitle(code)} className="whitespace-nowrap">
            {code}
          </span>
        </Fragment>
      ))}
      {rest > 0 ? (
        <span className="whitespace-nowrap text-ink-3" title={codes.slice(max).map(checkTitle).join(" · ")}>
          {" "}+{rest}
        </span>
      ) : null}
    </sup>
  );
}

/** Monto de la factura; si no se pudo leer, lo dice en vez de mostrar una raya. */
function InvoiceAmount({ total, currency, size }: { total: number | null; currency: string | null; size: "md" | "lg" }) {
  if (total == null || !Number.isFinite(total)) {
    return <span className="text-small text-ink-3">Sin monto legible</span>;
  }
  return <Money amount={total} currency={currency} size={size} className="text-navy" />;
}

/** "≈ 3.000,00 USD" cuando la factura no viene en dólares. */
function UsdHint({ amountUsd, currency, className }: { amountUsd: number | null; currency: string | null; className?: string }) {
  if (amountUsd == null || !currency || currency.toUpperCase() === "USD") return null;
  const p = moneyParts(amountUsd, "USD");
  return (
    <span className={cn("tnum text-caption whitespace-nowrap text-ink-3", className)}>
      ≈ {p.sign}
      {p.integer}
      {p.fraction} USD
    </span>
  );
}

/** País y moneda; si el proveedor no está en la ficha, solo la moneda. */
function OriginChip({ country, currency }: { country: string | null; currency: string | null }) {
  if (country) return <CountryChip country={country} currency={currency} />;
  if (!currency) return null;
  return (
    <span className="inline-flex h-6 shrink-0 items-center rounded-chip bg-surface-2 px-2 font-mono text-[11px] tracking-[0.02em] text-ink-2">
      {currency.toUpperCase()}
    </span>
  );
}

function Flags({ item }: { item: BoardItem }) {
  const d = item.decision;
  if (!d.hasSuspiciousText && !d.guardOverride) return null;
  return (
    <>
      {d.hasSuspiciousText ? <SuspiciousBadge /> : null}
      {d.guardOverride ? (
        <span title="La guardia revisó el pago por su cuenta, no lo aprobó y lo pasó a una persona.">
          <Badge tone="info" icon={<ShieldAlert />}>
            Guardia
          </Badge>
        </span>
      ) : null}
    </>
  );
}

interface CardProps {
  item: BoardItem;
  /** Ámbito del layoutId (vista + número de cambio de vista). */
  scope: string;
  countries: VendorCountries;
  now: number;
  index: number;
}

/** Tarjeta de una factura en su columna. Clic → detalle. */
export function InvoiceCard({ item, scope, countries, now, index }: CardProps) {
  const d = item.decision;
  const country = countryOf(d.vendorName, countries);
  const vendor = d.vendorName?.trim() || "Proveedor sin identificar";
  const reason = reasonOf(d);
  return (
    <motion.li
      layout
      layoutId={layoutIdOf(item.layoutKey, scope)}
      initial={item.fresh ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        layout: LAND_SPRING,
        default: { duration: 0.24, ease: [0.32, 0.72, 0, 1], delay: Math.min(index * STAGGER_S, MAX_STAGGER_S) },
      }}
      className="list-none"
    >
      <Link
        href={`/facturas/${encodeURIComponent(d.id)}`}
        aria-label={`${vendor}, factura ${d.invoiceNumber ?? d.filename}. Ver la decisión.`}
        className={cn(
          "group/card block rounded-row border border-seam bg-surface-0 p-3.5 shadow-hairline",
          "transition-[border-color,box-shadow,background-color] duration-[180ms] ease-out",
          "hover:border-row-active-border hover:bg-white hover:shadow-[0_1px_2px_#1c253a0f,0_14px_28px_-18px_#1c253a40]",
        )}
      >
        <div className="flex items-start gap-3">
          <Avatar name={d.vendorName ?? d.filename} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-body leading-tight font-medium text-navy" title={vendor}>
              {vendor}
            </p>
            <p
              className="mt-1 truncate font-mono text-caption tracking-[-0.01em] text-ink-3"
              title={d.invoiceNumber ? `Factura ${d.invoiceNumber} · ${d.filename}` : d.filename}
            >
              {d.invoiceNumber ?? d.filename}
            </p>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
          <InvoiceAmount total={d.total} currency={d.currency} size="lg" />
          <UsdHint amountUsd={d.amountUsd} currency={d.currency} />
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <OriginChip country={country} currency={d.currency} />
          <time dateTime={d.decidedAt} className="ml-auto pl-1 text-caption whitespace-nowrap text-ink-3">
            {relativeTime(d.decidedAt, now)}
          </time>
        </div>
        {d.hasSuspiciousText || d.guardOverride ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Flags item={item} />
          </div>
        ) : null}

        <p className="mt-2.5 border-t border-seam pt-2.5 text-small leading-snug text-ink-2" title={d.summary}>
          {reason.text}
          <FailedCodes codes={reason.codes} />
        </p>
      </Link>
    </motion.li>
  );
}

/** Fila de 64px para la vista de lista. */
export function InvoiceRow({ item, scope, countries, now, index }: CardProps) {
  const d = item.decision;
  const country = countryOf(d.vendorName, countries);
  const vendor = d.vendorName?.trim() || "Proveedor sin identificar";
  const reason = reasonOf(d);
  return (
    <motion.li
      layout
      layoutId={layoutIdOf(item.layoutKey, scope)}
      initial={item.fresh ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{
        layout: LAND_SPRING,
        default: { duration: 0.2, delay: Math.min(index * 0.02, 0.3) },
      }}
      className="list-none"
    >
      <Link
        href={`/facturas/${encodeURIComponent(d.id)}`}
        aria-label={`${vendor}, factura ${d.invoiceNumber ?? d.filename}. Ver la decisión.`}
        className="grid h-16 grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_8.5rem] items-center gap-4 rounded-row border border-transparent px-3 transition-colors duration-150 ease-out hover:border-row-active-border hover:bg-row-active md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_8.5rem_10rem]"
      >
        <span className="flex min-w-0 items-center gap-3">
          <Avatar name={d.vendorName ?? d.filename} />
          <span className="min-w-0">
            <span className="block truncate text-small font-medium text-navy">{vendor}</span>
            <span className="flex min-w-0 items-center gap-1.5 text-caption text-ink-3">
              {country ? <CountryFlag country={country} size={12} labelled={false} /> : null}
              <span className="truncate font-mono tracking-[-0.01em]">{d.invoiceNumber ?? d.filename}</span>
              {country ? <span className="sr-only">{COUNTRY_NAME[country] ?? country}</span> : null}
            </span>
          </span>
        </span>

        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-small text-ink-2" title={d.summary}>
            {reason.text}
            <FailedCodes codes={reason.codes} max={2} wrap={false} />
          </span>
          {/* En la fila, las insignias van solo con su icono: el motivo es lo que no debe cortarse. */}
          {d.hasSuspiciousText ? (
            <span title="Instrucción sospechosa: la factura trae texto que intenta dar órdenes. El agente lo ignoró." className="inline-flex shrink-0">
              <SuspiciousBadge className="w-6 justify-center px-0">
                <span className="sr-only">Instrucción sospechosa</span>
              </SuspiciousBadge>
            </span>
          ) : null}
          {d.guardOverride ? (
            <span title="Guardia: revisó el pago por su cuenta, no lo aprobó y lo pasó a una persona." className="inline-flex shrink-0">
              <Badge tone="info" icon={<ShieldAlert />} className="w-6 justify-center px-0">
                <span className="sr-only">Guardia</span>
              </Badge>
            </span>
          ) : null}
        </span>

        <span className="flex min-w-0 flex-col items-end leading-tight">
          <InvoiceAmount total={d.total} currency={d.currency} size="md" />
          <UsdHint amountUsd={d.amountUsd} currency={d.currency} className="text-[11.5px]" />
        </span>

        <span className="hidden items-center justify-between gap-2 md:flex">
          <DecisionChip status={d.outcome} />
          <time dateTime={d.decidedAt} className="text-right text-caption whitespace-nowrap text-ink-3">
            {relativeTime(d.decidedAt, now)}
          </time>
        </span>
      </Link>
    </motion.li>
  );
}
