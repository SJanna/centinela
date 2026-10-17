"use client";

import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { ACCEPT_ATTRIBUTE } from "@/ingest/limits";
import { cn } from "./cn";

interface DropZoneProps {
  /** Recibe los archivos soltados o elegidos. No sube nada: eso lo decide quien usa el componente. */
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  /** Varios archivos a la vez (por defecto sí). */
  multiple?: boolean;
  /** Valor de `<input accept>`. Por defecto, los formatos que acepta `src/ingest`. */
  accept?: string;
  title?: ReactNode;
  /** Línea de ayuda bajo el título. */
  hint?: ReactNode;
  /** Muestra el estado "arrastrando" sin arrastrar nada (para la guía de estilo). */
  forceDragging?: boolean;
  /** Texto cuando está deshabilitada, p. ej. "Revisando una factura. Espera a que termine." */
  disabledHint?: ReactNode;
  /** Alto mínimo (px si es número, o cualquier medida CSS). Por defecto 176px. */
  minHeight?: number | string;
  /**
   * Clases extra. Alto mínimo, separación y relleno por defecto ceden ante las de aquí sin `!`
   * (p. ej. `min-h-[136px] gap-3 py-5`, también con variantes como `max-xl:`).
   */
  className?: string;
}

/**
 * Límite de POST /api/invoices (4 MB por archivo, por el límite del cuerpo de las funciones de Vercel).
 * Espacios de no separación: "hasta 4 MB por factura" no se corta en dos líneas.
 */
export const DROP_ZONE_DEFAULT_HINT = "PDF, imagen, correo (.eml) o texto · hasta\u00a04\u00a0MB por\u00a0factura";

// Valores por defecto con especificidad 0 (`:where`): cualquier clase de `className` les gana.
const DEFAULT_SIZING = "[:where(&)]:min-h-[176px] [:where(&)]:gap-4 [:where(&)]:px-6 [:where(&)]:py-8";

/**
 * Zona para soltar facturas. Borde punteado de 1.5px, radio 20.
 * Estados: normal, arrastrando (borde cobalto y fondo lavado) y deshabilitada.
 */
export function DropZone({
  onFiles,
  disabled = false,
  multiple = true,
  accept = ACCEPT_ATTRIBUTE,
  title = "Suelta aquí las facturas.",
  hint = DROP_ZONE_DEFAULT_HINT,
  forceDragging = false,
  disabledHint,
  minHeight,
  className,
}: DropZoneProps) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const active = !disabled && (dragging || forceDragging);

  function hasFiles(e: DragEvent) {
    return Array.from(e.dataTransfer.types).includes("Files");
  }

  function handleDragEnter(e: DragEvent<HTMLLabelElement>) {
    if (disabled || !hasFiles(e)) return;
    e.preventDefault();
    depth.current += 1;
    setDragging(true);
  }

  function handleDragOver(e: DragEvent<HTMLLabelElement>) {
    if (disabled || !hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }

  function handleDragLeave(e: DragEvent<HTMLLabelElement>) {
    if (disabled || !hasFiles(e)) return;
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setDragging(false);
  }

  function handleDrop(e: DragEvent<HTMLLabelElement>) {
    if (disabled) return;
    e.preventDefault();
    depth.current = 0;
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) onFiles(multiple ? files : files.slice(0, 1));
  }

  return (
    <label
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      data-state={disabled ? "disabled" : active ? "dragging" : "idle"}
      aria-disabled={disabled || undefined}
      style={minHeight !== undefined ? { minHeight } : undefined}
      className={cn(
        "group/drop relative flex flex-col items-center justify-center rounded-panel border-[1.5px] border-dashed text-center",
        DEFAULT_SIZING,
        "transition-[background-color,border-color] duration-[180ms] ease-out",
        "has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-accent",
        disabled
          ? "cursor-not-allowed border-faint/70 bg-surface-1/60"
          : active
            ? "cursor-copy border-accent bg-accent-wash"
            : "cursor-pointer border-faint bg-surface-1 hover:border-ink-3/60 hover:bg-[#f4f5f6]",
        className,
      )}
    >
      <input
        type="file"
        className="sr-only"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        onChange={(e) => {
          const files = Array.from(e.currentTarget.files ?? []);
          if (files.length > 0) onFiles(files);
          // Permite elegir el mismo archivo otra vez.
          e.currentTarget.value = "";
        }}
      />
      <DropArt active={active} disabled={disabled} />
      <div className="space-y-1">
        <p className={cn("text-h3", disabled ? "text-ink-3" : "text-navy")}>
          {active ? "Suéltalas para revisarlas." : title}
        </p>
        <p className={cn("text-small", disabled ? "text-ink-3" : "text-ink-2")}>
          {disabled && disabledHint ? (
            disabledHint
          ) : (
            <>
              {hint}
              {!active && !disabled ? (
                <>
                  {" · "}
                  <span className="font-medium text-accent underline decoration-accent/30 underline-offset-[3px] group-hover/drop:decoration-accent">
                    o elige archivos
                  </span>
                </>
              ) : null}
            </>
          )}
        </p>
      </div>
    </label>
  );
}

/** Dos hojas apiladas con una flecha: dibujo de línea fina. */
function DropArt({ active, disabled }: { active: boolean; disabled: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative grid size-12 place-items-center rounded-row border bg-surface-0 transition-[translate,box-shadow,border-color] duration-[180ms] ease-out",
        active ? "-translate-y-0.5 border-lavender shadow-drop" : "border-seam shadow-hairline",
        disabled && "opacity-60",
      )}
    >
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 3.75h6.2L18 7.6v11.15a1.5 1.5 0 0 1-1.5 1.5h-8.5A1.5 1.5 0 0 1 6.5 18.75v-13.5A1.5 1.5 0 0 1 8 3.75Z" stroke="var(--color-ink-3)" strokeWidth="1.25" />
        <path d="M14 3.9v3.6h3.8" stroke="var(--color-ink-3)" strokeWidth="1.25" />
        <path
          d="M12.25 16.5v-6m0 0-2.4 2.4m2.4-2.4 2.4 2.4"
          stroke={active ? "var(--color-accent)" : "var(--color-ink-2)"}
          strokeWidth="1.5"
        />
      </svg>
    </span>
  );
}
