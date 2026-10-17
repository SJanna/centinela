/**
 * Demostración: reinicio de datos y facturas de ejemplo del dataset.
 */
import { readFile } from "node:fs/promises";
import type { CaseRow } from "../core/ports";
import type { Company, Outcome } from "../core/schemas";
import { resetAll } from "../store";
import { loadDatasetCompany, loadManifest, manifestFilePath, readCaseRows } from "./dataset";
import { withProcessingLock } from "./process";

export interface Sample {
  caseId: string;
  /** Nombre del archivo de ejemplo (p. ej. «B01.pdf»). */
  filename: string;
  formato: CaseRow["formato"];
  descripcion: string;
  split: CaseRow["split"];
  escenario: string;
  decision_esperada: Outcome;
}

export interface SampleFile {
  caseId: string;
  filename: string;
  mediaType: string;
  bytes: Uint8Array;
}

/**
 * Borra facturas y decisiones y vuelve a cargar dataset/company.json.
 * Espera a que termine la factura en curso (usa el mismo candado que `processInvoice`).
 */
export function resetDemo(): Promise<Company> {
  return withProcessingLock(async () => {
    const company = loadDatasetCompany();
    await resetAll(company);
    return company;
  });
}

/** Casos de dataset/casos.csv que tienen archivo en el manifiesto, en el orden del CSV. */
export function listSamples(): Sample[] {
  const files = new Map(loadManifest().map((e) => [e.caseId, e.file]));
  const samples: Sample[] = [];
  for (const row of readCaseRows()) {
    const file = files.get(row.id);
    if (!file) continue;
    samples.push({
      caseId: row.id,
      filename: file.split("/").pop() ?? file,
      formato: row.formato,
      descripcion: row.descripcion,
      split: row.split,
      escenario: row.escenario,
      decision_esperada: row.decision_esperada,
    });
  }
  return samples;
}

/** Bytes del archivo de ejemplo de un caso, o null si el caso no existe en el manifiesto. */
export async function readSample(caseId: string): Promise<SampleFile | null> {
  const entry = loadManifest().find((e) => e.caseId === caseId);
  if (!entry) return null;
  const buf = await readFile(manifestFilePath(entry));
  return {
    caseId: entry.caseId,
    filename: entry.file.split("/").pop() ?? entry.file,
    mediaType: entry.mediaType,
    bytes: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength),
  };
}
