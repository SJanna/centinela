/**
 * Escribe la extensión del escenario base (dataset/generator/base-extension.ts): dataset/specs/B24.json…
 * y sus filas de dataset/casos.csv, justo después de B23. Las demás filas y specs no se tocan.
 * Uso: npm run dataset:extend   (después: npm run dataset:generate)
 */
import fs from "node:fs";
import path from "node:path";
import type { Outcome } from "../../src/core/schemas";
import { buildExtension, casesCsvWithExtension, isExtensionId, specJson } from "./base-extension";
import { datasetDir } from "./spec";

function main(): void {
  const dir = datasetDir();
  const { specs, rows } = buildExtension();
  const specsDir = path.join(dir, "specs");
  const keep = new Set(specs.map((s) => `${s.id}.json`));
  for (const f of fs.readdirSync(specsDir)) {
    if (isExtensionId(f.replace(/\.json$/, "")) && !keep.has(f)) fs.rmSync(path.join(specsDir, f));
  }
  for (const s of specs) fs.writeFileSync(path.join(specsDir, `${s.id}.json`), specJson(s));
  const csvPath = path.join(dir, "casos.csv");
  fs.writeFileSync(csvPath, casesCsvWithExtension(fs.readFileSync(csvPath, "utf8"), rows));
  const count = (o: Outcome) => rows.filter((r) => r.decision_esperada === o).length;
  console.log(`${specs.length} specs (${rows[0].id}–${rows[rows.length - 1].id}): PAGAR ${count("PAGAR")} · FRENAR ${count("FRENAR")} · ESCALAR ${count("ESCALAR")}`);
  console.log("Escribí dataset/specs/ y las filas de dataset/casos.csv. Ahora: npm run dataset:generate");
}

try {
  main();
} catch (err: unknown) {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exitCode = 1;
}
