"use client";

import type { ChangeEvent, FocusEvent } from "react";
import { cn } from "@/components/ui/cn";

interface PillInputProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** Se llama al salir del campo: sirve para dar formato al número escrito. */
  onBlur?: (value: string) => void;
  /** Texto antes de la cifra ("USD"). */
  prefix?: string;
  /** Texto después de la cifra ("%"). */
  suffix?: string;
  /** Nombre accesible: la frase completa con el valor en blanco. */
  label: string;
  /** El valor es distinto del guardado. */
  changed?: boolean;
  invalid?: boolean;
  errorId?: string;
  className?: string;
}

/**
 * Valor editable dentro de una frase: una píldora con la cifra y su unidad.
 * Cambiada: fondo accent-tint y borde cobalto. Con error: borde rojo.
 */
export function PillInput({
  id,
  value,
  onChange,
  onBlur,
  prefix,
  suffix,
  label,
  changed = false,
  invalid = false,
  errorId,
  className,
}: PillInputProps) {
  // Ancho según lo escrito: los dígitos tabulares miden 1ch; puntos y comas, menos.
  const width = `${Math.max(2, value.length) * 0.92 + 0.6}ch`;
  return (
    <span
      data-changed={changed || undefined}
      data-invalid={invalid || undefined}
      className={cn(
        "group/pill relative ml-[0.18em] inline-flex h-[1.75em] translate-y-[-0.06em] items-center rounded-pill px-[0.6em] align-middle whitespace-nowrap",
        "bg-surface-0 shadow-[0_1px_2px_#1c253a0f] ring-1 ring-seam ring-inset",
        "transition-[background-color,box-shadow] duration-150 ease-out",
        "hover:ring-[#cfd5e6] focus-within:ring-2 focus-within:ring-accent hover:focus-within:ring-accent",
        "data-[changed]:bg-accent-tint data-[changed]:ring-accent/70",
        "data-[invalid]:bg-hold-wash/50 data-[invalid]:ring-hold-mark/70 data-[invalid]:focus-within:ring-hold-mark",
        className ?? "mr-[0.18em]",
      )}
    >
      {prefix ? (
        <span aria-hidden className="mr-[0.4em] font-mono text-[0.62em] font-medium tracking-[0.02em] text-ink-3">
          {prefix}
        </span>
      ) : null}
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? errorId : undefined}
        value={value}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        onBlur={(e: FocusEvent<HTMLInputElement>) => onBlur?.(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        style={{ width }}
        className="tnum min-w-0 bg-transparent p-0 text-center font-[inherit] leading-none tracking-[-0.03em] text-navy outline-none focus-visible:outline-none"
      />
      {suffix ? (
        <span aria-hidden className="ml-[0.12em] text-[0.8em] text-ink-3">
          {suffix}
        </span>
      ) : null}
    </span>
  );
}
