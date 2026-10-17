/**
 * Puertos compartidos entre módulos (interfaces, sin implementación).
 */
import type { Extraction, Outcome, CheckCode } from "./schemas";

/** Caché de lecturas del modelo. Clave = sha256(fileHash + readerId + model + promptVersion). */
export interface ReadingCache {
  get(key: string): Promise<Extraction | null>;
  set(key: string, value: Extraction): Promise<void>;
}

// ───────────────────────── Dataset y banco de pruebas ─────────────────────────

/** Una fila de dataset/casos.csv (las etiquetas las fijan personas). */
export interface CaseRow {
  id: string;
  split: "train" | "holdout";
  escenario: string;
  formato: "pdf" | "png" | "jpg" | "eml" | "txt";
  /** id del proveedor en company.json, o "" si no está registrado. */
  proveedor: string;
  descripcion: string;
  decision_esperada: Outcome;
  /** Comprobaciones que DEBEN fallar para considerar correcta la decisión (puede estar vacío). */
  codigos_esperados: CheckCode[];
}

/** Entrada de dataset/generated/manifest.json, escrita por el generador. */
export interface ManifestEntry {
  caseId: string;
  /** Ruta relativa a dataset/generated/ */
  file: string;
  sha256: string;
  mediaType: string;
  /** Lo que una lectura perfecta debería devolver. Lo usa el lector simulado. */
  groundTruth: Extraction;
}
