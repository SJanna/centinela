/**
 * Genera las facturas de prueba: dataset/specs/*.json → dataset/generated/<ID>.<ext> + manifest.json.
 * Uso: npm run dataset:generate   (o: npx tsx dataset/generator/generate.ts)
 */
import path from "node:path";
import { readCases } from "./cases";
import { generateAll, writeGenerated } from "./build";
import { datasetDir, loadSpecs } from "./spec";

async function main(): Promise<void> {
  const dir = datasetDir();
  const specs = loadSpecs();
  const rows = readCases();
  const specIds = new Set(specs.map((s) => s.id));
  const missing = rows.filter((r) => !specIds.has(r.id)).map((r) => r.id);
  if (missing.length > 0) throw new Error(`Faltan specs para: ${missing.join(", ")}`);
  for (const row of rows) {
    const spec = specs.find((s) => s.id === row.id);
    if (spec && spec.format !== row.formato) throw new Error(`${row.id}: formato ${spec.format} ≠ ${row.formato} de casos.csv`);
  }

  const cases = await generateAll(specs);
  const outDir = path.join(dir, "generated");
  writeGenerated(cases, outDir);
  for (const c of cases) {
    const kb = (c.bytes.length / 1024).toFixed(1).padStart(7);
    console.log(`${c.caseId}  ${c.file.padEnd(8)} ${kb} KB  ${c.sha256.slice(0, 12)}`);
  }
  console.log(`\n${cases.length} archivos + manifest.json en ${path.relative(process.cwd(), outDir)}/`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
