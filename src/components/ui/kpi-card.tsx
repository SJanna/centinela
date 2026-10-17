import type { ReactNode } from "react";
import { cn } from "./cn";
import { Money } from "./money";
import { Card, Sheet } from "./sheet";
import { StatusDot } from "./status";
import type { Tone } from "./tones";
import { Eyebrow } from "./typography";

interface KpiCardProps {
  eyebrow: ReactNode;
  /** Punto de estado junto al antetítulo. */
  status?: Tone;
  /** Monto en USD (o en `currency`). Se ignora si se pasa `value`. */
  amount?: number | null;
  currency?: string;
  /** Cifra propia (p. ej. <Percent size="kpi" />). */
  value?: ReactNode;
  /** Línea corta bajo la cifra: "12 facturas". */
  caption?: ReactNode;
  /** Contenido al pie: barra, enlace, nota. */
  footer?: ReactNode;
  /** Esquina superior derecha: tooltip, enlace. */
  aside?: ReactNode;
  /** "card" (por defecto) o "sheet" para el KPI principal. */
  surface?: "card" | "sheet";
  className?: string;
}

/** Tarjeta de indicador: antetítulo con punto, cifra grande y una línea de contexto. */
export function KpiCard({
  eyebrow,
  status,
  amount,
  currency = "USD",
  value,
  caption,
  footer,
  aside,
  surface = "card",
  className,
}: KpiCardProps) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {status ? <StatusDot status={status} size={7} /> : null}
          <Eyebrow>{eyebrow}</Eyebrow>
        </div>
        {aside}
      </div>
      <div className="mt-4 text-navy">
        {value ?? <Money amount={amount} currency={currency} size="kpi" display="symbol" />}
      </div>
      {caption ? <p className="mt-1.5 text-small text-ink-2">{caption}</p> : null}
      {footer ? <div className="mt-auto pt-5">{footer}</div> : null}
    </>
  );
  const classes = cn("@container flex min-h-[148px] min-w-0 flex-col", className);
  return surface === "sheet" ? (
    <Sheet as="article" padding="lg" className={classes}>
      {body}
    </Sheet>
  ) : (
    <Card as="article" padding="md" className={classes}>
      {body}
    </Card>
  );
}
