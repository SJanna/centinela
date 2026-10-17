import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";
import { cn } from "./cn";

type Side = "top" | "bottom";
type Align = "center" | "start" | "end";

interface TooltipProps {
  /** Texto de ayuda. Frases cortas, con punto. */
  content: ReactNode;
  /** El disparador. Si es un elemento, recibe `aria-describedby`; si es texto, se envuelve en un span enfocable. */
  children: ReactNode;
  side?: Side;
  align?: Align;
  /** Ancho máximo del globo en px (por defecto 260). */
  maxWidth?: number;
  className?: string;
}

const POSITION: Record<Side, Record<Align, string>> = {
  top: {
    center: "bottom-full left-1/2 mb-2 -translate-x-1/2 origin-bottom",
    start: "bottom-full left-0 mb-2 origin-bottom-left",
    end: "bottom-full right-0 mb-2 origin-bottom-right",
  },
  bottom: {
    center: "top-full left-1/2 mt-2 -translate-x-1/2 origin-top",
    start: "top-full left-0 mt-2 origin-top-left",
    end: "top-full right-0 mt-2 origin-top-right",
  },
};

/**
 * Tooltip solo con CSS: aparece al pasar el cursor o al enfocar el disparador.
 * Funciona en componentes de servidor (no necesita JavaScript en el cliente).
 */
export function Tooltip({ content, children, side = "top", align = "center", maxWidth = 260, className }: TooltipProps) {
  const id = useId();
  const trigger = isValidElement<{ "aria-describedby"?: string }>(children) ? (
    cloneElement(children as ReactElement<{ "aria-describedby"?: string }>, { "aria-describedby": id })
  ) : (
    <span tabIndex={0} aria-describedby={id} className="cursor-help rounded-sm">
      {children}
    </span>
  );

  return (
    <span className={cn("group/tooltip relative inline-flex", className)}>
      {trigger}
      <span
        role="tooltip"
        id={id}
        style={{ maxWidth }}
        className={cn(
          "pointer-events-none absolute z-50 w-max rounded-row bg-surface-0 px-3 py-2 text-left text-caption font-normal normal-case tracking-normal text-ink-2 shadow-pop ring-1 ring-seam",
          "invisible scale-[0.98] opacity-0 transition-[opacity,scale,visibility] duration-150 ease-out",
          "group-hover/tooltip:visible group-hover/tooltip:scale-100 group-hover/tooltip:opacity-100 group-hover/tooltip:delay-150",
          "group-focus-within/tooltip:visible group-focus-within/tooltip:scale-100 group-focus-within/tooltip:opacity-100",
          POSITION[side][align],
        )}
      >
        {content}
      </span>
    </span>
  );
}
