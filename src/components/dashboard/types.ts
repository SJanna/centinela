/**
 * Tipos del resumen ("/"). Solo tipos: se importan desde cliente y servidor.
 */
import type { Outcome } from "@/core/schemas";
import type { Sample } from "@/pipeline";
import type { DecisionSummary, Stats } from "@/store";

export type { DecisionSummary, Outcome, Sample, Stats };

/** País de cada proveedor, por nombre o alias en minúsculas: "camila restrepo dev s.a.s." → "CO". */
export type VendorCountries = Record<string, string>;

/** Una tarjeta del tablero. `layoutKey` une la fila de subida con la tarjeta que cae en su columna. */
export interface BoardItem {
  decision: DecisionSummary;
  layoutKey: string;
  /** true si llegó en esta sesión (anima su entrada). */
  fresh: boolean;
}

export type QueueSource = { kind: "file"; file: File } | { kind: "sample"; sample: Sample };

export type QueueStatus = "waiting" | "running" | "error";

/** Un archivo en la cola de subida. Se procesa de a uno, en orden. */
export interface QueueItem {
  key: string;
  /** Nombre del archivo. */
  label: string;
  /** Para ejemplos: la descripción del caso. */
  detail: string | null;
  source: QueueSource;
  status: QueueStatus;
  error?: string;
  /** Si viene de reproducir un escenario. */
  playbackId?: string;
}

/** Resultado de subir una factura de ejemplo, comparado con la etiqueta del dataset. */
export type SampleResult =
  | {
      kind: "decided";
      outcome: Outcome;
      decisionId: string;
      matches: boolean;
      /** El mismo archivo ya se había revisado (DUP-1): se frena por duplicado y la etiqueta no aplica. */
      repeated: boolean;
    }
  | { kind: "error"; error: string };

export interface PlaybackMismatch {
  caseId: string;
  expected: Outcome;
  got: Outcome | null;
}

/** Reproducción de un escenario completo del dataset. */
export interface Playback {
  id: string;
  scenario: string;
  label: string;
  total: number;
  done: number;
  matches: number;
  mismatches: PlaybackMismatch[];
  status: "running" | "stopped" | "done";
}

export type ViewMode = "board" | "list";
