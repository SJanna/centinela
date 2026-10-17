/**
 * Lectura de los archivos del dataset que usan la aplicación y el banco de pruebas:
 * dataset/company.json, dataset/casos.csv, dataset/scenarios.json y dataset/generated/manifest.json.
 *
 * Las rutas se resuelven desde `process.cwd()` (raíz del repo en desarrollo, en pruebas y en Vercel,
 * donde `next.config.ts` incluye estos archivos en la salida). Solo para el servidor.
 */
import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import type { CaseRow, ManifestEntry } from "../core/ports";
import { CompanySchema, type CheckCode, type Company, type Outcome, type Rules } from "../core/schemas";
import { CHECK_BY_CODE } from "../core/checks";

export interface Scenario {
  id: string;
  /** ISO 8601: «ahora» con que se decide cada caso del escenario. */
  now: string;
  /** Campos de company.rules que se reemplazan solo en este escenario. */
  rulesOverride: Partial<Rules>;
}

/** Ruta dentro de dataset/ (desde la raíz del repo). */
export function datasetPath(...segments: string[]): string {
  return path.join(process.cwd(), "dataset", ...segments);
}

function readText(file: string, what: string): string {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (err) {
    const reason = err instanceof Error && "code" in err && err.code === "ENOENT" ? "no existe" : "no se pudo leer";
    throw new Error(`${what} (${path.relative(process.cwd(), file) || file}) ${reason}.`, { cause: err });
  }
}

// ───────────────────────── Empresa ─────────────────────────

/** Empresa ficticia del dataset, validada. Se lee de disco en cada llamada (es pequeña). */
export function loadDatasetCompany(): Company {
  const raw = readText(datasetPath("company.json"), "La empresa de ejemplo");
  return CompanySchema.parse(JSON.parse(raw));
}

// ───────────────────────── Manifiesto ─────────────────────────

let manifestCache: { file: string; entries: ManifestEntry[] } | null = null;

/**
 * Manifiesto de dataset/generated (lecturas «perfectas» para el lector simulado).
 * Se carga una sola vez por proceso.
 */
export function loadManifest(): ManifestEntry[] {
  const file = datasetPath("generated", "manifest.json");
  if (manifestCache && manifestCache.file === file) return manifestCache.entries;
  const raw = readText(file, "El manifiesto de facturas de ejemplo");
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) throw new Error("El manifiesto de facturas de ejemplo no es una lista.");
  const entries = parsed as ManifestEntry[];
  manifestCache = { file, entries };
  return entries;
}

/** Ruta absoluta de un archivo del manifiesto, sin salir de dataset/generated. */
export function manifestFilePath(entry: Pick<ManifestEntry, "file">): string {
  const base = datasetPath("generated");
  const full = path.resolve(base, entry.file);
  if (full !== base && !full.startsWith(base + path.sep)) {
    throw new Error(`El archivo de ejemplo «${entry.file}» está fuera de dataset/generated.`);
  }
  return full;
}

// ───────────────────────── Casos y escenarios ─────────────────────────

const OUTCOMES = new Set<Outcome>(["PAGAR", "FRENAR", "ESCALAR"]);

/** Filas de dataset/casos.csv en su orden (las etiquetas las fijan personas: solo lectura). */
export function readCaseRows(): CaseRow[] {
  const raw = readText(datasetPath("casos.csv"), "La lista de casos");
  const records = parse(raw, { columns: true, skip_empty_lines: true, trim: true, bom: true }) as Record<string, string>[];
  return records.map((r) => {
    const codes = (r.codigos_esperados ?? "")
      .split(/[;|\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const code of codes) {
      if (!(code in CHECK_BY_CODE)) throw new Error(`casos.csv, caso ${r.id}: código de comprobación desconocido «${code}».`);
    }
    if (!OUTCOMES.has(r.decision_esperada as Outcome)) {
      throw new Error(`casos.csv, caso ${r.id}: decisión esperada desconocida «${r.decision_esperada}».`);
    }
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
}

/** Escenarios de dataset/scenarios.json, en su orden. */
export function readScenarios(): Scenario[] {
  const raw = JSON.parse(readText(datasetPath("scenarios.json"), "La lista de escenarios")) as { scenarios?: Scenario[] };
  if (!Array.isArray(raw.scenarios)) throw new Error("dataset/scenarios.json no trae la lista «scenarios».");
  return raw.scenarios.map((s) => ({ id: s.id, now: s.now, rulesOverride: s.rulesOverride ?? {} }));
}

/** Empresa con las reglas del escenario aplicadas. */
export function companyForScenario(company: Company, scenario: Scenario): Company {
  return { ...company, rules: { ...company.rules, ...scenario.rulesOverride } };
}
