/**
 * Salidas del set de estrés: validación del plan, generación de archivos, casos.csv, scenarios.json y
 * comparación con el oráculo independiente. La usa dataset/stress/build-stress.ts y sus pruebas.
 */
import path from "node:path";
import { generateCase, type GeneratedCase } from "../generator/build";
import { readCompany } from "../generator/cases";
import { evaluateScenario, type OracleInput } from "../generator/oracle";
import { isCopySpec, isDocumentSpec, isPhotoOfSpec, parseSpec, type CaseSpec } from "../generator/spec";
import type { StressPlan, StressRow } from "./plan";

export const STRESS_DIR = path.join("dataset", "stress");
export const GENERATED_DIR = path.join(STRESS_DIR, "generated");

export const CSV_COLUMNS: Array<keyof StressRow> = [
  "id",
  "split",
  "escenario",
  "formato",
  "proveedor",
  "descripcion",
  "decision_esperada",
  "codigos_esperados",
  "trampa",
  "dificultad",
  "idioma",
  "plantilla",
];

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function casesCsv(rows: StressRow[]): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const r of rows) {
    lines.push(
      CSV_COLUMNS.map((k) => {
        const v = r[k];
        return csvCell(Array.isArray(v) ? v.join(";") : String(v));
      }).join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

export function scenariosJson(plan: StressPlan, companySha256: string): string {
  return `${JSON.stringify(
    {
      _doc:
        "Set de estrés (dataset/stress/build-stress.ts). Cada escenario arranca con historial vacío y procesa sus casos en el orden de casos.csv. 'rulesOverride' reemplaza campos de company.rules solo en ese escenario. Si company.json cambia (companySha256 distinto), hay que regenerar con npm run stress:generate.",
      seed: plan.seed,
      companySha256,
      scenarios: plan.scenarios.map((s) => ({ id: s.id, now: s.now, rulesOverride: s.rulesOverride, kind: s.kind, split: s.split, description: s.description })),
    },
    null,
    2,
  )}\n`;
}

/** Valida cada spec (esquema del generador) y sus referencias dentro del escenario. */
export function validatePlan(plan: StressPlan): CaseSpec[] {
  const specs = plan.cases.map((c) => parseSpec(c.spec, c.spec.id));
  const pos = new Map(plan.cases.map((c, i) => [c.spec.id, i]));
  const byId = new Map(plan.cases.map((c) => [c.spec.id, c]));
  plan.cases.forEach((c, i) => {
    const s = c.spec;
    if (s.id !== `S${String(i + 1).padStart(4, "0")}`) throw new Error(`Id fuera de orden: ${s.id} en la posición ${i + 1}`);
    const ref = isCopySpec(s) ? s.copyOf : isPhotoOfSpec(s) ? s.photoOf : null;
    if (ref == null) return;
    const target = byId.get(ref);
    if (!target) throw new Error(`${s.id}: referencia a ${ref}, que no existe`);
    if ((pos.get(ref) ?? Infinity) >= i) throw new Error(`${s.id}: ${ref} debe ir antes`);
    if (target.row.escenario !== c.row.escenario) throw new Error(`${s.id}: ${ref} es de otro escenario`);
    if (isCopySpec(target.spec)) throw new Error(`${s.id}: ${ref} es una copia; se copia el original`);
    if (target.spec.vendorId !== s.vendorId) throw new Error(`${s.id}: proveedor distinto al de ${ref}`);
    if (isCopySpec(s) && target.spec.format !== s.format) throw new Error(`${s.id}: formato distinto al de ${ref}`);
    if (isPhotoOfSpec(s) && (!isDocumentSpec(target.spec) || target.spec.template == null)) throw new Error(`${s.id}: ${ref} no tiene plantilla visual`);
  });
  return specs;
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

/** Genera los archivos de todas las specs (documentos, luego fotos, luego copias exactas). */
export async function renderPlan(specs: CaseSpec[], onProgress?: (done: number, total: number) => void, concurrency = 4): Promise<Map<string, GeneratedCase>> {
  const byId = new Map(specs.map((s) => [s.id, s]));
  const done = new Map<string, GeneratedCase>();
  const phases: CaseSpec[][] = [specs.filter(isDocumentSpec), specs.filter(isPhotoOfSpec), specs.filter(isCopySpec)];
  let count = 0;
  for (const phase of phases) {
    await pool(phase, concurrency, async (spec) => {
      done.set(spec.id, await generateCase(spec, byId, done));
      count++;
      if (onProgress && count % 100 === 0) onProgress(count, specs.length);
    });
  }
  return done;
}

/** Compara las etiquetas con el oráculo independiente del dataset (control de consistencia). */
export function oracleCheck(plan: StressPlan, generated: Map<string, GeneratedCase>): { agree: number; total: number; byTrap: Array<[string, number, number]> } {
  const company = readCompany();
  const byTrap = new Map<string, { agree: number; total: number }>();
  let agree = 0;
  for (const sc of plan.scenarios) {
    const cases = plan.cases.filter((c) => c.row.escenario === sc.id);
    const inputs: OracleInput[] = cases.map((c) => {
      const g = generated.get(c.spec.id);
      if (!g) throw new Error(`Falta el caso generado ${c.spec.id}`);
      return { caseId: c.spec.id, sha256: g.sha256, groundTruth: g.groundTruth };
    });
    const results = evaluateScenario(company, { id: sc.id, now: sc.now, rulesOverride: sc.rulesOverride }, inputs);
    results.forEach((r, i) => {
      const c = cases[i];
      const ok = r.outcome === c.row.decision_esperada;
      if (ok) agree++;
      const traps = c.traps.length ? c.traps : ["ninguna"];
      for (const t of traps) {
        const e = byTrap.get(t) ?? { agree: 0, total: 0 };
        e.total++;
        if (ok) e.agree++;
        byTrap.set(t, e);
      }
    });
  }
  return { agree, total: plan.cases.length, byTrap: [...byTrap].map(([k, v]) => [k, v.agree, v.total] as [string, number, number]).sort((a, b) => a[1] / a[2] - b[1] / b[2]) };
}

