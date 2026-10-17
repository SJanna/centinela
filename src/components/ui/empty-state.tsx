import type { ReactNode } from "react";
import { cn } from "./cn";
import { Ribbon } from "./ribbon";
import { Studio } from "./sheet";
import { Eyebrow } from "./typography";

interface EmptyStateProps {
  /** Frase corta con punto: "Sin facturas por revisar." */
  title?: ReactNode;
  description?: ReactNode;
  /** CTA en píldora (uno o dos botones). */
  action?: ReactNode;
  /** "default": líneas finas y una frase · "first-use": portada del primer uso con la cinta. */
  variant?: "default" | "first-use";
  /** Antetítulo (solo first-use). */
  eyebrow?: ReactNode;
  /** Nivel del título. h2 por defecto; usa h1 si es lo principal de la página. */
  headingLevel?: 1 | 2 | 3;
  /** Contenido extra bajo las acciones (solo first-use). */
  children?: ReactNode;
  className?: string;
}

/** Título por defecto del primer uso: "Tu agente *paga*. Tú decides." con "paga" en Playfair italic. */
function FirstUseTitle() {
  return (
    <>
      Tu agente{" "}
      <em className="font-serif text-[1.1em] leading-none font-normal tracking-[-0.025em] italic">paga</em>
      . Tú decides.
    </>
  );
}

/** Estado vacío: líneas finas, una frase con punto y un CTA. Variante de primer uso con la cinta generativa. */
export function EmptyState({
  title,
  description,
  action,
  variant = "default",
  eyebrow,
  headingLevel = 2,
  children,
  className,
}: EmptyStateProps) {
  const Heading = (`h${headingLevel}` as "h1" | "h2" | "h3");

  if (variant === "first-use") {
    return (
      <Studio className={cn("min-h-[440px]", className)}>
        <div
          aria-hidden
          className="absolute inset-y-0 right-0 w-[68%] [mask-image:linear-gradient(to_right,transparent_0%,#000_38%)]"
        >
          <Ribbon />
        </div>
        <div className="relative z-10 flex max-w-[560px] flex-col items-start gap-5 px-8 py-12 sm:px-12 sm:py-14">
          {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
          <Heading className="text-display text-navy">{title ?? <FirstUseTitle />}</Heading>
          {description ? <div className="max-w-[46ch] text-[15px] leading-[1.65] text-ink-2">{description}</div> : null}
          {action ? <div className="flex flex-wrap items-center gap-3 pt-1">{action}</div> : null}
          {children}
        </div>
      </Studio>
    );
  }

  return (
    <div className={cn("flex flex-col items-center px-6 py-14 text-center", className)}>
      <EmptyArt />
      <Heading className="mt-6 text-h3 text-navy">{title ?? "Nada por aquí todavía."}</Heading>
      {description ? <div className="mt-1.5 max-w-[42ch] text-small text-ink-2">{description}</div> : null}
      {action ? <div className="mt-6 flex flex-wrap items-center justify-center gap-3">{action}</div> : null}
    </div>
  );
}

/** Dos hojas en línea fina sobre una base: lo que queda cuando no hay facturas. */
function EmptyArt() {
  return (
    <svg aria-hidden viewBox="0 0 168 96" width="168" height="96" fill="none" strokeLinecap="round">
      <path d="M8 88.5h152" stroke="var(--color-line)" />
      <path d="M20 88.5h20M128 88.5h20" stroke="var(--color-paper)" strokeWidth="2" />
      <g transform="rotate(-7 84 50)">
        <rect x="50.5" y="12.5" width="64" height="74" rx="8" stroke="var(--color-line)" fill="var(--color-surface-1)" />
      </g>
      <rect x="54.5" y="8.5" width="64" height="78" rx="8" stroke="var(--color-seam)" fill="var(--color-surface-0)" />
      <path d="M64.5 22.5h26" stroke="var(--color-faint)" />
      <path d="M64.5 31.5h44M64.5 38.5h38M64.5 45.5h41" stroke="var(--color-line)" />
      <path d="M86.5 66.5h22" stroke="var(--color-line)" />
      <path d="M86.5 72.5h22" stroke="var(--color-lavender)" strokeWidth="1.25" />
      <circle cx="68.5" cy="69.5" r="4" stroke="var(--color-lavender)" />
    </svg>
  );
}
