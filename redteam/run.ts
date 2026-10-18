/**
 * Corre el red team: genera las facturas de redteam/cases.ts, las procesa con el mismo pipeline
 * del banco de pruebas (normalizeFile → readInvoice → decideWithGuard) y escribe un reporte.
 *
 *   npx tsx redteam/run.ts            # «doc» con lectura perfecta, «engañado» con lecturas torcidas (sin costo)
 *   npx tsx redteam/run.ts --live     # «doc» leído con Claude (necesita ANTHROPIC_API_KEY)
 */
import fs from "node:fs";
import path from "node:path";
import { generateAll } from "../dataset/generator/build";
import { parseSpec } from "../dataset/generator/spec";
import type { ManifestEntry } from "../src/core/ports";
import type { Company, Extraction, HistoryEntry, Outcome } from "../src/core/schemas";
import { createSimulatedReader, readInvoice } from "../src/extract";
import { normalizeFile } from "../src/ingest";
import { companyForScenario, loadDatasetCompany } from "../src/pipeline/dataset";
import { decideWithGuard } from "../src/pipeline/guard-apply";
import { PRIMARY_READER_ID, SECONDARY_READER_ID } from "../src/pipeline/reader-ids";
import { buildEvalReaders } from "../eval/lib";
import { CASES, SCENARIOS, type RedCase } from "./cases";

const live = process.argv.includes("--live");
const OUT = path.join(process.cwd(), "redteam");

interface Result {
  id: string;
  scenario: string;
  track: RedCase["track"];
  attack: string;
  accept: Outcome[];
  severity: RedCase["severity"];
  outcome: Outcome;
  ok: boolean;
  guardOverride: boolean;
  failCodes: string[];
  notEvaluable: string[];
  summary: string;
  paid: { vendorId: string | null; amountUsd: number | null; period: string | null } | null;
  readers: string;
}

function manifestEntry(caseId: string, sha256: string, gt: Extraction): ManifestEntry {
  return { caseId, file: `${caseId}`, sha256, mediaType: "", groundTruth: gt } as ManifestEntry;
}

async function main(): Promise<void> {
  const specs = CASES.map((c) => parseSpec(c.spec, c.id));
  const generated = await generateAll(specs);
  const byId = new Map(generated.map((g) => [g.caseId, g]));
  const genDir = path.join(OUT, "generated");
  fs.mkdirSync(genDir, { recursive: true });
  for (const g of generated) fs.writeFileSync(path.join(genDir, g.file), g.bytes);

  const company: Company = loadDatasetCompany();
  const liveReaders = live ? buildEvalReaders("live", { cacheDir: path.join("redteam", "reading-cache") }) : null;

  // Escenarios: los casos con escenario «rt» corren solos (historial vacío); los demás, en grupo y en orden.
  const groups = new Map<string, RedCase[]>();
  for (const c of CASES) {
    const key = c.scenario === "rt" ? `rt:${c.id}` : c.scenario;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }

  const results: Result[] = [];
  for (const [key, cases] of groups) {
    const scen = SCENARIOS.find((s) => s.id === key.split(":")[0])!;
    const comp = companyForScenario(company, { id: key, now: scen.now, rulesOverride: scen.rulesOverride });
    const history: HistoryEntry[] = [];
    for (const c of cases) {
      const g = byId.get(c.id)!;
      const doc = await normalizeFile(new Uint8Array(g.bytes), g.file, g.mediaType);
      let readers;
      let readersLabel: string;
      if (c.track === "engañado") {
        const fooled = c.fool!(structuredClone(g.groundTruth));
        const a = createSimulatedReader({ id: PRIMARY_READER_ID, manifest: [manifestEntry(c.id, g.sha256, fooled)] });
        const b = createSimulatedReader({ id: SECONDARY_READER_ID, manifest: [manifestEntry(c.id, g.sha256, c.foolOnlyA ? g.groundTruth : fooled)] });
        readers = { primary: a, secondary: b };
        readersLabel = c.foolOnlyA ? "A engañado, B perfecto" : "A y B engañados igual";
      } else if (liveReaders) {
        readers = liveReaders;
        readersLabel = "Claude (live)";
      } else {
        const m = [manifestEntry(c.id, g.sha256, g.groundTruth)];
        readers = { primary: createSimulatedReader({ id: PRIMARY_READER_ID, manifest: m }), secondary: createSimulatedReader({ id: SECONDARY_READER_ID, manifest: m }) };
        readersLabel = "lectura perfecta";
      }
      const reading = await readInvoice(doc, readers);
      const invoiceId = `${key}/${c.id}`;
      const d = decideWithGuard({ invoiceId, fileHash: doc.fileHash, reading }, { company: comp, history, now: scen.now });
      history.push({
        invoiceId, fileHash: doc.fileHash, outcome: d.outcome, vendorId: d.vendorId,
        invoiceNumber: reading.data?.invoiceNumber ?? null, agreementId: d.agreementId,
        agreementPeriod: d.agreementPeriod, amountUsd: d.amountUsd, decidedAt: scen.now,
      });
      results.push({
        id: c.id, scenario: key, track: c.track, attack: c.attack, accept: c.accept, severity: c.severity,
        outcome: d.outcome, ok: c.accept.includes(d.outcome), guardOverride: d.guardOverride,
        failCodes: d.checks.filter((x) => x.status === "fail").map((x) => x.code),
        notEvaluable: d.checks.filter((x) => x.status === "not_evaluable").map((x) => x.code),
        summary: d.summary,
        paid: d.outcome === "PAGAR" ? { vendorId: d.vendorId, amountUsd: d.amountUsd, period: d.agreementPeriod } : null,
        readers: readersLabel,
      });
    }
  }

  results.sort((a, b) => a.id.localeCompare(b.id));
  const bad = results.filter((r) => !r.ok);
  const money = bad.filter((r) => r.severity === "dinero");
  const lines: string[] = [];
  lines.push(`# Red team de Centinela`, "");
  lines.push(`${results.length} ataques · ${results.filter((r) => r.ok).length} resueltos como se esperaba · **${money.length} pagos indebidos** · ${bad.filter((r) => r.severity === "politica").length} fallos de política sin pérdida de dinero · ${bad.filter((r) => r.severity === "autonomia").length} escaladas de más`, "");
  lines.push(`Lectura de los casos «doc»: ${live ? "Claude (live)" : "perfecta (simulada)"}.`, "");
  lines.push("| Caso | Tipo | Ataque | Esperado | Obtenido | Comprobaciones | Veredicto |", "|---|---|---|---|---|---|---|");
  for (const r of results) {
    const verdict = r.ok ? "ok" : r.severity === "dinero" ? "**PAGO INDEBIDO**" : r.severity === "politica" ? "política (sin pérdida)" : "escaló de más";
    const codes = [...r.failCodes, ...r.notEvaluable.map((c) => `${c}?`)].join(" ") + (r.guardOverride ? " · guardia" : "");
    lines.push(`| ${r.id} | ${r.track} | ${r.attack.replace(/\|/g, "/")} | ${r.accept.join(" o ")} | ${r.outcome} | ${codes || "—"} | ${verdict} |`);
  }
  lines.push("", "## Resumen de cada decisión", "");
  for (const r of results) lines.push(`- **${r.id}** (${r.readers}) → ${r.outcome}: ${r.summary.replace(/\n/g, " ")}`);
  fs.mkdirSync(path.join(OUT, "reports"), { recursive: true });
  const base = live ? "live" : "simulated";
  fs.writeFileSync(path.join(OUT, "reports", `${base}.md`), lines.join("\n") + "\n");
  fs.writeFileSync(path.join(OUT, "reports", `${base}.json`), JSON.stringify(results, null, 2) + "\n");

  for (const r of results) {
    const mark = r.ok ? "ok " : r.severity === "dinero" ? "XXX" : r.severity === "politica" ? "pol" : "aut";
    console.log(`${mark} ${r.id} ${r.track.padEnd(8)} ${r.outcome.padEnd(7)} [${r.failCodes.join(" ")}${r.notEvaluable.length ? " ?" + r.notEvaluable.join(" ?") : ""}]${r.guardOverride ? " guardia" : ""}  ${r.attack}`);
  }
  console.log(`\n${results.length} ataques · pagos indebidos ${money.length} · fallos de política ${bad.filter((r) => r.severity === "politica").length} · escaladas de más ${bad.filter((r) => r.severity === "autonomia").length}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
