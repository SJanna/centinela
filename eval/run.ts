/**
 * CLI del banco de pruebas.
 *
 *   npm run eval                      # lector simulado (sin costo)
 *   npm run eval:cache                # lecturas guardadas en dataset/reading-cache
 *   npm run eval:live                 # API de Anthropic (requiere ANTHROPIC_API_KEY; cuesta dinero)
 *   npm run eval -- --split=holdout --case=H01,H03
 *   npm run eval:stress               # set de estrés (2000 casos), lector simulado
 *   npm run eval:stress:live -- --sample=100   # piloto con lectura real sobre una muestra
 *   npm run eval:live -- --profile=calidad --out=live-calidad
 *
 * Lee ANTHROPIC_API_KEY y READER_PROFILE del entorno o de .env.local / .env. En cache y live el
 * perfil de lectura (--profile, o READER_PROFILE; por defecto «economico») elige modelo y prompt de
 * cada lector, igual que en la aplicación.
 * Escribe eval/reports/latest.md y latest.json (dataset base) o eval/reports/stress-<lector>[-<perfil>].md
 * y .json (set de estrés; con --sample, …-muestra<N>.*). --out=<nombre> cambia el nombre.
 * Sale con código 1 si hay algún pago indebido (2 si la configuración es inválida).
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs, USAGE, UsageError } from "./args";
import { readersLine, renderMarkdown, reportBaseName, runEval, summaryLine, type CaseResult, type EvalOptions } from "./lib";
import { buildStressSummary, renderStressMarkdown, stressJson } from "./stress-report";

/** Carga .env.local y .env si existen (lo ya definido en el entorno manda), como hace Next. */
function loadEnvFiles(): void {
  for (const file of [".env.local", ".env"]) {
    const full = path.join(process.cwd(), file);
    if (existsSync(full)) process.loadEnvFile(full);
  }
}

function caseLine(r: CaseResult): string {
  const mark = r.error ? "ERROR" : r.improperPayment ? "PAGO INDEBIDO" : r.correct ? "ok" : "FALLO";
  return `  ${r.caseId.padEnd(5)} ${r.escenario.padEnd(11)} esperado ${r.expected.padEnd(7)} obtenido ${(r.outcome ?? "—").padEnd(7)} ${mark}`;
}

async function main(): Promise<number> {
  loadEnvFiles();
  let opts: EvalOptions;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof UsageError) {
      if (err.message) console.error(err.message);
      console.error(USAGE);
      return err.message ? 2 : 0;
    }
    throw err;
  }

  const stress = opts.dataset === "stress";
  const extra = [
    stress ? "conjunto stress" : null,
    opts.sample ? `muestra de ${opts.sample}` : null,
    opts.concurrency && opts.concurrency > 1 ? `${opts.concurrency} escenarios en paralelo` : null,
  ].filter(Boolean);
  console.log(`Banco de pruebas · lector ${opts.reader} · casos ${opts.split}${opts.cases ? ` (${opts.cases.join(", ")})` : ""}${extra.length ? ` · ${extra.join(" · ")}` : ""}`);

  let report;
  let done = 0;
  try {
    report = await runEval({
      ...opts,
      onCase: (r) => {
        done++;
        // En el set de estrés solo se muestran los fallos y el avance (son miles de casos).
        if (!stress || !r.correct) console.log(caseLine(r));
        if (stress && done % 100 === 0) console.log(`  … ${done} casos`);
      },
    });
  } catch (err) {
    console.error(`\nNo se pudo correr el banco de pruebas: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }

  const dir = path.join(process.cwd(), "eval", "reports");
  await mkdir(dir, { recursive: true });
  const base = reportBaseName(report, opts.out);
  const mdFile = path.join(dir, `${base}.md`);
  if (stress) {
    const summary = buildStressSummary(report);
    await writeFile(mdFile, renderStressMarkdown(report, summary), "utf8");
    await writeFile(path.join(dir, `${base}.json`), stressJson(report, summary), "utf8");
  } else {
    await writeFile(mdFile, renderMarkdown(report), "utf8");
    await writeFile(path.join(dir, `${base}.json`), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  for (const w of report.warnings) console.log(`Aviso: ${w}`);
  const profileLine = readersLine(report);
  if (profileLine) console.log(`\nPerfil de lectura: ${profileLine}`);
  console.log(`\n${summaryLine(report)}`);
  if (report.reader === "cache" && report.cacheMisses > 0) {
    console.log(`Aviso: ${report.cacheMisses} lectura(s) no estaban en la caché; esos casos escalan por LEC-1.`);
  }
  console.log(`Reporte: ${path.relative(process.cwd(), mdFile)}`);

  if (report.metrics.total.improperPayments > 0) {
    console.error(`\n${report.metrics.total.improperPayments} PAGO(S) INDEBIDO(S): el banco de pruebas falla.`);
    return 1;
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(2);
  },
);
