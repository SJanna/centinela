/**
 * Conjuntos de casos del banco de pruebas:
 * - «base»: dataset/casos.csv + dataset/generated (138 casos etiquetados; los 97 de B24–B120 se arman
 *   con dataset/generator/base-extension.ts).
 * - «stress»: dataset/stress/casos.csv + dataset/stress/generated (2000 casos con la etiqueta definida
 *   por construcción; se generan con npm run stress:generate y no se versionan).
 *
 * Los dos usan la misma empresa (dataset/company.json) y el mismo formato de manifiesto.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { CHECK_BY_CODE } from "../src/core/checks";
import type { CaseRow, ManifestEntry } from "../src/core/ports";
import type { CheckCode, Company, Outcome } from "../src/core/schemas";
import {
  loadDatasetCompany,
  loadManifest,
  manifestFilePath,
  readCaseRows,
  readScenarios,
  type Scenario,
} from "../src/pipeline/dataset";

export type DatasetName = "base" | "stress";
export const DATASET_NAMES: readonly DatasetName[] = ["base", "stress"];

/** Columnas extra del set de estrés (vacías en el dataset base). */
export interface CaseExtras {
  /** Trampas de la factura separadas por «+», o «ninguna». */
  trampa: string;
  dificultad: string;
  idioma: string;
  plantilla: string;
}

export interface EvalDataset {
  name: DatasetName;
  /** Filas en el orden del CSV (las etiquetas son la referencia). */
  rows: CaseRow[];
  extras: Map<string, CaseExtras>;
  scenarios: Scenario[];
  manifest: ManifestEntry[];
  /** Ruta absoluta del archivo de un caso. */
  filePath(entry: ManifestEntry): string;
  company: Company;
  /** Caché de lecturas por defecto (modos cache y live). */
  defaultCacheDir: string;
  /** Avisos para la consola (p. ej. company.json cambió desde que se generó el set). */
  warnings: string[];
}

export const STRESS_DIR = path.join("dataset", "stress");
export const STRESS_GENERATED = path.join(STRESS_DIR, "generated");
export const STRESS_CACHE_DIR = path.join(STRESS_DIR, "reading-cache");

const OUTCOMES = new Set<Outcome>(["PAGAR", "FRENAR", "ESCALAR"]);

function readStress(file: string, what: string): string {
  const full = path.join(process.cwd(), file);
  if (!fs.existsSync(full)) {
    throw new Error(`${what} (${file}) no existe. Genera el set de estrés con: npm run stress:generate`);
  }
  return fs.readFileSync(full, "utf8");
}

/** Filas de dataset/stress/casos.csv (mismas columnas que dataset/casos.csv + extras). */
export function parseStressCases(raw: string): { rows: CaseRow[]; extras: Map<string, CaseExtras> } {
  const records = parse(raw, { columns: true, skip_empty_lines: true, trim: true, bom: true }) as Record<string, string>[];
  const extras = new Map<string, CaseExtras>();
  const rows = records.map((r): CaseRow => {
    const codes = (r.codigos_esperados ?? "")
      .split(/[;|\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const code of codes) {
      if (!(code in CHECK_BY_CODE)) throw new Error(`casos.csv de estrés, caso ${r.id}: código desconocido «${code}».`);
    }
    if (!OUTCOMES.has(r.decision_esperada as Outcome)) throw new Error(`casos.csv de estrés, caso ${r.id}: decisión desconocida «${r.decision_esperada}».`);
    extras.set(r.id, { trampa: r.trampa || "ninguna", dificultad: r.dificultad ?? "", idioma: r.idioma ?? "", plantilla: r.plantilla ?? "" });
    return {
      id: r.id,
      split: r.split as CaseRow["split"],
      escenario: r.escenario,
      formato: r.formato as CaseRow["formato"],
      proveedor: r.proveedor ?? "",
      descripcion: r.descripcion,
      decision_esperada: r.decision_esperada as Outcome,
      codigos_esperados: codes as CheckCode[],
    };
  });
  return { rows, extras };
}

function loadStress(): EvalDataset {
  const { rows, extras } = parseStressCases(readStress(path.join(STRESS_DIR, "casos.csv"), "La lista de casos del set de estrés"));
  const scen = JSON.parse(readStress(path.join(STRESS_DIR, "scenarios.json"), "Los escenarios del set de estrés")) as {
    companySha256?: string;
    scenarios?: Array<Scenario & Record<string, unknown>>;
  };
  if (!Array.isArray(scen.scenarios)) throw new Error("dataset/stress/scenarios.json no trae la lista «scenarios».");
  const manifest = JSON.parse(readStress(path.join(STRESS_GENERATED, "manifest.json"), "El manifiesto del set de estrés")) as ManifestEntry[];
  if (!Array.isArray(manifest)) throw new Error("El manifiesto del set de estrés no es una lista.");
  const warnings: string[] = [];
  const companyRaw = fs.readFileSync(path.join(process.cwd(), "dataset", "company.json"));
  const sha = crypto.createHash("sha256").update(companyRaw).digest("hex");
  if (scen.companySha256 && scen.companySha256 !== sha) {
    warnings.push("dataset/company.json cambió desde que se generó el set de estrés: las etiquetas pueden no valer. Regenera con npm run stress:generate.");
  }
  const base = path.join(process.cwd(), STRESS_GENERATED);
  return {
    name: "stress",
    rows,
    extras,
    scenarios: scen.scenarios.map((s) => ({ id: s.id, now: s.now, rulesOverride: s.rulesOverride ?? {} })),
    manifest,
    filePath(entry) {
      const full = path.resolve(base, entry.file);
      if (!full.startsWith(base + path.sep)) throw new Error(`El archivo «${entry.file}» está fuera de ${STRESS_GENERATED}.`);
      return full;
    },
    company: loadDatasetCompany(),
    defaultCacheDir: STRESS_CACHE_DIR,
    warnings,
  };
}

function loadBase(): EvalDataset {
  return {
    name: "base",
    rows: readCaseRows(),
    extras: new Map(),
    scenarios: readScenarios(),
    manifest: loadManifest(),
    filePath: manifestFilePath,
    company: loadDatasetCompany(),
    defaultCacheDir: path.join("dataset", "reading-cache"),
    warnings: [],
  };
}

export function loadEvalDataset(name: DatasetName = "base"): EvalDataset {
  return name === "stress" ? loadStress() : loadBase();
}
