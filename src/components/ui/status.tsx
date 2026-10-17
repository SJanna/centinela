import { TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "./cn";
import { DECISION_LABEL, TONE, type DecisionStatus, type Tone } from "./tones";
import { Tooltip } from "./tooltip";

interface StatusDotProps {
  status?: Tone;
  /** Diámetro en px (6 por defecto). */
  size?: number;
  /** Late suavemente. Activo por defecto en PROCESANDO. */
  pulse?: boolean;
  /** Halo lavado de 3px alrededor del punto. */
  halo?: boolean;
  /** Texto para lectores de pantalla (el punto solo es decorativo si no se pasa). */
  label?: string;
  className?: string;
}

/** Punto de estado en el color de la decisión. */
export function StatusDot({ status = "NEUTRAL", size = 6, pulse, halo = false, label, className }: StatusDotProps) {
  const t = TONE[status];
  const pulsing = pulse ?? status === "PROCESANDO";
  return (
    <span className={cn("inline-flex shrink-0 items-center", className)}>
      <span
        aria-hidden
        style={{ width: size, height: size }}
        className={cn("inline-block rounded-full", t.mark, pulsing && "animate-processing", halo && cn("ring-[3px]", t.ring))}
      />
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}

type ChipSize = "sm" | "lg";

const CHIP_SIZE: Record<ChipSize, { root: string; dot: number }> = {
  sm: { root: "h-6 gap-1.5 px-2.5 text-caption", dot: 6 },
  lg: { root: "h-8 gap-2 px-3.5 text-small", dot: 7 },
};

interface DecisionChipProps {
  status: DecisionStatus;
  size?: ChipSize;
  /** Reemplaza la etiqueta ("Pagada.", "Frenada."…). */
  label?: ReactNode;
  className?: string;
}

/** Píldora de decisión: fondo lavado, punto y texto del estado. "Pagada." · "Frenada." · "Escalada." · "Revisando…" */
export function DecisionChip({ status, size = "sm", label, className }: DecisionChipProps) {
  const t = TONE[status];
  const s = CHIP_SIZE[size];
  return (
    <span
      data-status={status}
      className={cn("inline-flex shrink-0 items-center rounded-pill font-medium whitespace-nowrap", s.root, t.wash, t.text, className)}
    >
      <StatusDot status={status} size={s.dot} />
      <span>{label ?? DECISION_LABEL[status]}</span>
    </span>
  );
}

type NoticeTone = "success" | "warning" | "danger" | "info" | "neutral";

const NOTICE: Record<NoticeTone, string> = {
  success: "bg-success-wash text-success",
  warning: "bg-warning-wash text-warning",
  danger: "bg-danger-wash text-danger",
  info: "bg-info-wash text-info",
  neutral: "bg-surface-2 text-ink-2",
};

interface BadgeProps {
  tone?: NoticeTone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Etiqueta pequeña sobre fondo lavado, para avisos que no son decisiones ("Cuenta cambió hace 2 días"). */
export function Badge({ tone = "neutral", icon, children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-pill px-2.5 text-caption font-medium whitespace-nowrap [&_svg]:size-3.5 [&_svg]:stroke-[1.75]",
        NOTICE[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

/** Insignia sólida para una instrucción escondida en el documento. */
export function SuspiciousBadge({ className, children = "Instrucción sospechosa" }: { className?: string; children?: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-pill bg-suspicious-solid px-2.5 text-caption font-medium whitespace-nowrap text-white",
        className,
      )}
    >
      <TriangleAlert aria-hidden size={13} strokeWidth={2} />
      {children}
    </span>
  );
}

interface SuspiciousTextProps {
  children: ReactNode;
  /** Qué intenta el fragmento y qué hizo el agente. Aparece al pasar el cursor. */
  note?: ReactNode;
  className?: string;
}

/** Fragmento sospechoso dentro del documento: marcador amarillo y subrayado ondulado. */
export function SuspiciousText({ children, note, className }: SuspiciousTextProps) {
  const mark = <mark className={cn("marker-suspicious px-0.5", className)}>{children}</mark>;
  if (!note) return mark;
  return (
    <Tooltip content={note} side="top" align="start">
      <mark tabIndex={0} className={cn("marker-suspicious cursor-help px-0.5", className)}>
        {children}
      </mark>
    </Tooltip>
  );
}
