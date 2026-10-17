/**
 * Set de estrés: 2000 facturas con la decisión esperada definida por construcción.
 *
 *   npm run stress:generate                       # 2000 facturas, semilla fija
 *   npx tsx dataset/stress/build-stress.ts --total=200 --seed=7   # un set más chico para probar
 *
 * Escribe:
 * - dataset/stress/generated/<ID>.<ext> y manifest.json (lectura «perfecta» de cada archivo) — no se
 *   versiona (.gitignore); se regenera igual byte a byte con la misma semilla.
 * - dataset/stress/generated/specs.json (las specs, para revisar un caso).
 * - dataset/stress/casos.csv: mismas columnas que dataset/casos.csv + trampa, dificultad, idioma, plantilla.
 * - dataset/stress/scenarios.json: escenarios (cada uno arranca con historial vacío).
 *
 * La etiqueta de cada factura sale de su receta (plan.ts + ledger.ts), nunca de src/engine. Al final
 * se compara con el oráculo independiente del dataset (dataset/generator/oracle.ts) como control de
 * consistencia: sus diferencias esperadas están documentadas en el resumen.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ManifestEntry } from "../../src/core/ports";
import { readCompany } from "../generator/cases";
import { casesCsv, GENERATED_DIR, oracleCheck, renderPlan, scenariosJson, STRESS_DIR, validatePlan } from "./output";
import { DEFAULT_SEED, DEFAULT_TOTAL, planStress, type StressCase } from "./plan";

function parseArgs(argv: string[]): { seed: number; total: number; concurrency: number } {
  const out = { seed: DEFAULT_SEED, total: DEFAULT_TOTAL, concurrency: 4 };
  for (const arg of argv) {
    const m = /^--(seed|total|concurrency)=(\d+)$/.exec(arg);
    if (!m) throw new Error(`Opción desconocida: ${arg}. Uso: build-stress.ts [--seed=N] [--total=N] [--concurrency=N]`);
    out[m[1] as "seed" | "total" | "concurrency"] = Number(m[2]);
  }
  return out;
}

function countBy<T>(items: T[], key: (x: T) => string | string[]): Array<[string, number]> {
  const m = new Map<string, number>();
  for (const it of items) for (const k of [key(it)].flat()) m.set(k, (m.get(k) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]);
}

function printTable(title: string, rows: Array<[string, number]>, total: number): void {
  console.log(`\n${title}`);
  for (const [k, n] of rows) console.log(`  ${k.padEnd(34)} ${String(n).padStart(5)}  ${((n / total) * 100).toFixed(1).padStart(5)} %`);
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const t0 = Date.now();
  const company = readCompany();
  const companySha = crypto.createHash("sha256").update(fs.readFileSync(path.join("dataset", "company.json"))).digest("hex");
  const plan = planStress(company, { seed: opts.seed, total: opts.total });
  const specs = validatePlan(plan);
  console.log(`Plan: ${plan.cases.length} facturas en ${plan.scenarios.length} escenarios (semilla ${plan.seed}). Generando archivos…`);

  const generated = await renderPlan(specs, (d, n) => process.stdout.write(`  ${d}/${n}\r`), opts.concurrency);

  const outDir = path.join(process.cwd(), GENERATED_DIR);
  fs.mkdirSync(outDir, { recursive: true });
  const keep = new Set<string>(["manifest.json", "specs.json"]);
  const manifest: ManifestEntry[] = [];
  let bytes = 0;
  for (const c of plan.cases) {
    const g = generated.get(c.spec.id);
    if (!g) throw new Error(`No se generó ${c.spec.id}`);
    fs.writeFileSync(path.join(outDir, g.file), g.bytes);
    keep.add(g.file);
    bytes += g.bytes.length;
    manifest.push({ caseId: g.caseId, file: g.file, sha256: g.sha256, mediaType: g.mediaType, groundTruth: g.groundTruth });
  }
  for (const f of fs.readdirSync(outDir)) if (!keep.has(f)) fs.rmSync(path.join(outDir, f));
  fs.writeFileSync(path.join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 1)}\n`);
  fs.writeFileSync(path.join(outDir, "specs.json"), `${JSON.stringify(specs, null, 1)}\n`);
  fs.writeFileSync(path.join(process.cwd(), STRESS_DIR, "casos.csv"), casesCsv(plan.cases.map((c) => c.row)));
  fs.writeFileSync(path.join(process.cwd(), STRESS_DIR, "scenarios.json"), scenariosJson(plan, companySha));

  const rows = plan.cases.map((c) => c.row);
  const n = rows.length;
  printTable("Decisión esperada", countBy(rows, (r) => r.decision_esperada), n);
  printTable("Legítimas vs. trampas", countBy(rows, (r) => (r.trampa === "ninguna" ? "legítima" : "trampa")), n);
  printTable("Trampas (una factura puede tener varias)", countBy(plan.cases, (c: StressCase) => (c.traps.length ? c.traps : ["ninguna"])), n);
  printTable("Formato", countBy(rows, (r) => r.formato), n);
  printTable("Presentación", countBy(rows, (r) => r.plantilla), n);
  printTable("Idioma", countBy(rows, (r) => r.idioma), n);
  printTable("Dificultad", countBy(rows, (r) => r.dificultad), n);

  const oracle = oracleCheck(plan, generated);
  console.log(`\nOráculo independiente (dataset/generator/oracle.ts): coincide en ${oracle.agree}/${oracle.total} decisiones.`);
  console.log("  No modela: recibos, fecha o periodo futuros, periodo fuera de la vigencia, id tributario en conflicto,");
  console.log("  el mismo número en otro banco ni la tolerancia de los acuerdos por hora; ahí discrepa a propósito.");
  for (const [t, a, tot] of oracle.byTrap.filter(([, a, tot]) => a < tot)) console.log(`  ${t.padEnd(30)} ${a}/${tot}`);

  const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`;
  const manifestBytes = fs.statSync(path.join(outDir, "manifest.json")).size + fs.statSync(path.join(outDir, "specs.json")).size;
  console.log(`\nArchivos: ${mb(bytes)} + manifest/specs ${mb(manifestBytes)} en ${path.relative(process.cwd(), outDir)}/ · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exitCode = 1;
});
