import type { ReactNode } from "react";
import { cn } from "./cn";
import { StatusDot } from "./status";
import { TONE, type Tone } from "./tones";

export interface Segment {
  key: string;
  value: number;
  tone: Tone;
  label?: ReactNode;
}

interface SegmentedBarProps {
  segments: Segment[];
  /** Alto de la barra en px (6 por defecto). */
  height?: number;
  /** Muestra la leyenda con punto, etiqueta y valor. */
  legend?: boolean;
  /** Cómo se escribe cada valor en la leyenda. */
  formatValue?: (value: number, total: number) => ReactNode;
  /**
   * Los segmentos crecen al aparecer y cambian de ancho con transición cuando cambian los valores
   * (CSS; se desactiva con prefers-reduced-motion).
   */
  animate?: boolean;
  /** Descripción para lectores de pantalla. */
  label: string;
  className?: string;
}

/** Barra segmentada en los colores de estado (p. ej. autonomía: pagadas · frenadas · escaladas). */
export function SegmentedBar({
  segments,
  height = 6,
  legend = false,
  formatValue = (v) => v,
  animate = true,
  label,
  className,
}: SegmentedBarProps) {
  const total = segments.reduce((sum, s) => sum + Math.max(0, s.value), 0);
  const visible = segments.filter((s) => s.value > 0);
  return (
    <div className={cn("space-y-3", className)}>
      <div
        role="img"
        aria-label={label}
        className="flex w-full gap-[3px] overflow-hidden rounded-pill"
        style={{ height }}
      >
        {total === 0 ? (
          <span className="h-full w-full rounded-pill bg-surface-3" />
        ) : (
          visible.map((s, i) => (
            <span
              key={s.key}
              className={cn(
                "h-full min-w-0 origin-left first:rounded-l-pill last:rounded-r-pill",
                TONE[s.tone].mark,
                animate && "animate-grow-x transition-[width] duration-500 ease-strong",
              )}
              style={{ width: `${(s.value / total) * 100}%`, animationDelay: animate ? `${i * 90}ms` : undefined }}
            />
          ))
        )}
      </div>
      {legend ? (
        <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-caption text-ink-2">
          {segments.map((s) => (
            <li key={s.key} className="inline-flex items-center gap-1.5">
              <StatusDot status={s.tone} />
              <span>{s.label ?? s.key}</span>
              <span className="tnum font-medium text-ink">{formatValue(s.value, total)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

interface UsageMarker {
  value: number;
  label: ReactNode;
}

interface UsageBarProps {
  /** Lo consumido. */
  value: number;
  /** El total (fondo, límite). */
  max: number;
  /** Marcas verticales, p. ej. el umbral o el límite del mes. */
  markers?: UsageMarker[];
  /** Color del relleno: navy por defecto; usa un tono de estado para alertar. */
  tone?: Tone | "NAVY";
  label: string;
  height?: number;
  className?: string;
}

/** Barra de consumo con marcas de umbral. */
export function UsageBar({ value, max, markers = [], tone = "NAVY", label, height = 6, className }: UsageBarProps) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const fill = tone === "NAVY" ? "bg-navy" : TONE[tone].mark;
  return (
    <div className={cn("relative", markers.length > 0 && "pt-5", className)}>
      {markers.map((m, i) => {
        const left = max > 0 ? Math.min(100, Math.max(0, (m.value / max) * 100)) : 0;
        return (
          <span
            key={i}
            className={cn(
              "absolute top-0 flex flex-col",
              left > 88 ? "-translate-x-full items-end" : left < 12 ? "items-start" : "-translate-x-1/2 items-center",
            )}
            style={{ left: `${left}%` }}
          >
            <span className="text-[10.5px] leading-none font-medium whitespace-nowrap text-muted">{m.label}</span>
          </span>
        );
      })}
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        className="relative w-full overflow-visible rounded-pill bg-surface-3"
        style={{ height }}
      >
        <span
          className={cn(
            "absolute inset-y-0 left-0 origin-left animate-grow-x rounded-pill transition-[width] duration-500 ease-strong",
            fill,
          )}
          style={{ width: `${pct}%` }}
        />
        {markers.map((m, i) => {
          const left = max > 0 ? Math.min(100, Math.max(0, (m.value / max) * 100)) : 0;
          return (
            <span
              key={i}
              aria-hidden
              className="absolute -top-1 -bottom-1 w-px -translate-x-1/2 bg-ink-2/60"
              style={{ left: `${left}%` }}
            />
          );
        })}
      </div>
    </div>
  );
}
