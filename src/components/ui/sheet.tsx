import type { ElementType, ReactNode } from "react";
import { cn } from "./cn";
import { Eyebrow } from "./typography";

type Padding = "none" | "sm" | "md" | "lg";

const PADDING: Record<Padding, string> = {
  none: "",
  sm: "p-4",
  md: "p-5",
  lg: "p-6",
};

interface SurfaceProps {
  children?: ReactNode;
  as?: ElementType;
  padding?: Padding;
  className?: string;
  id?: string;
  "aria-labelledby"?: string;
}

/**
 * Hoja: blanco con degradado, borde de 1px blanco y sombra larga y difusa. Radio 20.
 * Para paneles principales (KPIs, detalle de una factura, la factura misma).
 */
export function Sheet({ children, as: Tag = "section", padding = "lg", className, ...rest }: SurfaceProps) {
  return (
    <Tag className={cn("sheet relative rounded-panel", PADDING[padding], className)} {...rest}>
      {children}
    </Tag>
  );
}

/**
 * Tarjeta secundaria: superficie plana con borde `seam`. Radio 16.
 * Para listas, filas agrupadas y tarjetas dentro de una hoja.
 */
export function Card({ children, as: Tag = "div", padding = "md", className, ...rest }: SurfaceProps) {
  return (
    <Tag
      className={cn(
        "relative rounded-card border border-seam bg-surface-0 shadow-hairline",
        PADDING[padding],
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}

interface StudioProps {
  children?: ReactNode;
  /** Fondo mate gris-azul (por defecto) o salvia. */
  tone?: "slate" | "sage";
  className?: string;
}

/** Estudio: fondo de degradado mate sobre el que se apoya una hoja. Radio 20. */
export function Studio({ children, tone = "slate", className }: StudioProps) {
  return (
    <div
      className={cn(
        "relative isolate overflow-hidden rounded-panel",
        tone === "sage" ? "studio-sage" : "studio",
        className,
      )}
    >
      {children}
    </div>
  );
}

interface SheetHeaderProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Acciones o metadatos a la derecha. */
  action?: ReactNode;
  /** Nivel del título (h2 por defecto). */
  level?: 2 | 3;
  id?: string;
  className?: string;
}

/** Cabecera de una hoja o tarjeta: antetítulo, título, descripción y acción. */
export function SheetHeader({ eyebrow, title, description, action, level = 2, id, className }: SheetHeaderProps) {
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <header className={cn("flex items-start justify-between gap-4", className)}>
      <div className="min-w-0 space-y-1">
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        <Heading id={id} className={level === 2 ? "text-h2" : "text-h3"}>
          {title}
        </Heading>
        {description ? <p className="max-w-prose text-small text-ink-2">{description}</p> : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </header>
  );
}

/** Separador de 1px. Sobre papel usa `line`; dentro de hojas, `seam`. */
export function Divider({ onPaper = false, className }: { onPaper?: boolean; className?: string }) {
  return <hr className={cn("border-0 border-t", onPaper ? "border-line" : "border-seam", className)} />;
}
