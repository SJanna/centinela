/**
 * Tonos de estado compartidos por chips, puntos, barras y avisos.
 * Las clases van escritas completas para que Tailwind las detecte.
 */
import type { Outcome } from "@/core/schemas";

/** Estado visible de una factura: la decisión final o "en revisión". */
export type DecisionStatus = Outcome | "PROCESANDO";

/** Tonos disponibles: los cuatro estados de decisión y uno neutro. */
export type Tone = DecisionStatus | "NEUTRAL";

interface ToneClasses {
  /** Texto del estado. */
  text: string;
  /** Fondo lavado. */
  wash: string;
  /** Punto o marca sólida (fondo). */
  mark: string;
  /** Marca como color de texto/trazo (para SVG con currentColor). */
  markText: string;
  /** Halo alrededor del punto. */
  ring: string;
}

export const TONE: Record<Tone, ToneClasses> = {
  PAGAR: { text: "text-pay", wash: "bg-pay-wash", mark: "bg-pay-mark", markText: "text-pay-mark", ring: "ring-pay-wash" },
  FRENAR: { text: "text-hold", wash: "bg-hold-wash", mark: "bg-hold-mark", markText: "text-hold-mark", ring: "ring-hold-wash" },
  ESCALAR: {
    text: "text-escalate",
    wash: "bg-escalate-wash",
    mark: "bg-escalate-mark",
    markText: "text-escalate-mark",
    ring: "ring-escalate-wash",
  },
  PROCESANDO: {
    text: "text-processing",
    wash: "bg-processing-wash",
    mark: "bg-processing-mark",
    markText: "text-processing-mark",
    ring: "ring-processing-wash",
  },
  NEUTRAL: { text: "text-ink-2", wash: "bg-surface-2", mark: "bg-ink-3", markText: "text-ink-3", ring: "ring-surface-2" },
};

/** Etiquetas cortas, con punto, tal como se leen en la pantalla. */
export const DECISION_LABEL: Record<DecisionStatus, string> = {
  PAGAR: "Pagada.",
  FRENAR: "Frenada.",
  ESCALAR: "Escalada.",
  PROCESANDO: "Revisando…",
};

/** Nombre del estado en plural, para leyendas y KPIs. */
export const DECISION_GROUP_LABEL: Record<Outcome, string> = {
  PAGAR: "Pagadas",
  FRENAR: "Frenadas",
  ESCALAR: "Escaladas",
};
