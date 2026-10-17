/**
 * Lectura de los archivos del dataset que fijan personas (solo lectura):
 * casos.csv, company.json y scenarios.json.
 */
import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import type { CaseRow } from "../../src/core/ports";
import { CompanySchema, type CheckCode, type Company, type Outcome, type Rules } from "../../src/core/schemas";
import { datasetDir } from "./spec";

const CHECK_CODES = new Set<CheckCode>([
  "LEC-1", "LEC-2", "LEC-3", "LEC-4", "DUP-1", "DUP-2", "DUP-3", "PRV-1", "PRV-2",
  "ACU-1", "ACU-2", "ACU-3", "LIM-1", "LIM-2", "FON-1",
]);
const OUTCOMES = new Set<Outcome>(["PAGAR", "FRENAR", "ESCALAR"]);

export function readCases(dir = datasetDir()): CaseRow[] {
  const raw = fs.readFileSync(path.join(dir, "casos.csv"), "utf8");
  const records = parse(raw, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string>[];
  return records.map((r) => {
    const codes = (r.codigos_esperados ?? "")
      .split(/[;|\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const code of codes) if (!CHECK_CODES.has(code as CheckCode)) throw new Error(`casos.csv ${r.id}: código desconocido ${code}`);
    if (!OUTCOMES.has(r.decision_esperada as Outcome)) throw new Error(`casos.csv ${r.id}: decisión desconocida ${r.decision_esperada}`);
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

export function readCompany(dir = datasetDir()): Company {
  return CompanySchema.parse(JSON.parse(fs.readFileSync(path.join(dir, "company.json"), "utf8")));
}

export interface Scenario {
  id: string;
  now: string;
  rulesOverride: Partial<Rules>;
}

export function readScenarios(dir = datasetDir()): Scenario[] {
  const raw = JSON.parse(fs.readFileSync(path.join(dir, "scenarios.json"), "utf8")) as { scenarios: Scenario[] };
  return raw.scenarios;
}
