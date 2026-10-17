/**
 * Lector simulado: devuelve la lectura «perfecta» del manifiesto del dataset.
 * Sirve para probar la lógica de decisión sin costo. NO mide la calidad de lectura.
 */
import { ExtractionSchema, type NormalizedDoc, type Reader, type ReaderResult } from "../core/schemas";
import type { ManifestEntry } from "../core/ports";
import { PROMPT_VERSION } from "./prompt";

export const SIMULATED_MODEL = "simulado";
export const SIMULATED_UNAVAILABLE_MESSAGE = "Lectura simulada no disponible para este archivo";

export function createSimulatedReader(opts: { id: string; manifest: ManifestEntry[] }): Reader {
  const byHash = new Map<string, ManifestEntry>();
  for (const entry of opts.manifest) byHash.set(entry.sha256.toLowerCase(), entry);

  const meta = { readerId: opts.id, model: SIMULATED_MODEL, promptVersion: PROMPT_VERSION };

  return {
    id: opts.id,
    model: SIMULATED_MODEL,
    promptVersion: PROMPT_VERSION,
    async read(doc: NormalizedDoc): Promise<ReaderResult> {
      const entry = byHash.get(doc.fileHash.toLowerCase());
      if (!entry) {
        return { ok: false, ...meta, error: "unavailable", message: SIMULATED_UNAVAILABLE_MESSAGE };
      }
      const parsed = ExtractionSchema.safeParse(structuredClone(entry.groundTruth));
      if (!parsed.success) {
        return {
          ok: false,
          ...meta,
          error: "parse_error",
          message: `La lectura simulada del caso ${entry.caseId} no cumple el esquema: ${parsed.error.message}`,
        };
      }
      return { ok: true, ...meta, extraction: parsed.data };
    },
  };
}
