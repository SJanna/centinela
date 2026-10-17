/**
 * Campos de formulario de las pantallas de configuración: etiqueta, ayuda y error en español.
 * Radio 12, borde seam, foco cobalto. Sin estado propio: sirven en cliente y en servidor.
 */
import { CircleAlert } from "lucide-react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "@/components/ui/cn";

/** Clases de un control de texto (input o select). `invalid` lo pinta en rojo. */
export function controlClasses(invalid = false, className?: string): string {
  return cn(
    "h-10 w-full min-w-0 rounded-row border bg-surface-0 px-3 text-body text-ink shadow-hairline",
    "placeholder:text-ink-3 transition-[border-color,box-shadow] duration-150 ease-out",
    "focus:outline-none focus-visible:outline-none focus:ring-[3px]",
    "disabled:cursor-not-allowed disabled:bg-surface-1 disabled:text-ink-3",
    invalid
      ? "border-hold-mark/70 focus:border-hold-mark focus:ring-hold-wash"
      : "border-seam hover:border-[#d5d9e5] focus:border-accent focus:ring-accent-wash",
    className,
  );
}

interface FieldProps {
  label: ReactNode;
  /** id del control; enlaza la etiqueta, la ayuda y el error. */
  htmlFor: string;
  hint?: ReactNode;
  error?: string | null;
  /** Marca visual de opcional. */
  optional?: boolean;
  className?: string;
  children: ReactNode;
}

/** Etiqueta arriba, control, y debajo la ayuda o el error. */
export function Field({ label, htmlFor, hint, error, optional, className, children }: FieldProps) {
  return (
    <div className={cn("min-w-0 space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="flex items-baseline justify-between gap-2 text-small font-medium text-navy">
        <span>{label}</span>
        {optional ? <span className="text-caption font-normal text-ink-3">Opcional</span> : null}
      </label>
      {children}
      {error ? (
        <FieldError id={`${htmlFor}-error`}>{error}</FieldError>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="text-caption text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function FieldError({ id, children, className }: { id?: string; children: ReactNode; className?: string }) {
  return (
    <p id={id} className={cn("flex items-start gap-1.5 text-caption text-hold", className)}>
      <CircleAlert aria-hidden size={13} strokeWidth={1.75} className="mt-[2px] shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/** aria-* de un control según tenga error o ayuda. */
export function describedBy(id: string, error?: string | null, hint?: ReactNode) {
  return {
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? `${id}-error` : hint ? `${id}-hint` : undefined,
  } as const;
}

type InputProps = ComponentPropsWithoutRef<"input"> & { invalid?: boolean; mono?: boolean };

export function TextInput({ invalid, mono, className, ...rest }: InputProps) {
  return <input className={controlClasses(invalid, cn(mono && "font-mono text-[13px] tracking-[-0.01em]", className))} {...rest} />;
}

type SelectProps = ComponentPropsWithoutRef<"select"> & { invalid?: boolean };

export function Select({ invalid, className, children, ...rest }: SelectProps) {
  return (
    <select
      className={controlClasses(
        invalid,
        cn(
          "appearance-none bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='none' stroke='%238D969E' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m4.5 6.5 3.5 3.5 3.5-3.5'/%3E%3C/svg%3E\")] bg-[length:16px_16px] bg-[right_10px_center] bg-no-repeat pr-9",
          className,
        ),
      )}
      {...rest}
    >
      {children}
    </select>
  );
}

/** Aviso en bloque (no es una decisión): fondo lavado, icono y texto. */
export function Notice({
  tone = "warning",
  icon,
  title,
  children,
  className,
  role,
}: {
  tone?: "warning" | "danger" | "info" | "neutral";
  icon?: ReactNode;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
  role?: "alert" | "status";
}) {
  const TONES = {
    warning: "bg-warning-wash/70 text-warning",
    danger: "bg-danger-wash/80 text-danger",
    info: "bg-info-wash/80 text-info",
    neutral: "bg-surface-2 text-ink-2",
  } as const;
  return (
    <div role={role} className={cn("flex gap-3 rounded-row px-4 py-3 text-small", TONES[tone], className)}>
      {icon ? <span className="mt-[2px] shrink-0 [&_svg]:size-4 [&_svg]:stroke-[1.75]">{icon}</span> : null}
      <div className="min-w-0 space-y-0.5">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className="text-ink-2">{children}</div> : null}
      </div>
    </div>
  );
}
