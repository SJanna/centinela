/**
 * CLI del banco de pruebas.
 *
 *   npm run eval                      # lector simulado (sin costo)
 *   npm run eval:cache                # lecturas guardadas en dataset/reading-cache
 *   npm run eval:live                 # API de Anthropic (requiere ANTHROPIC_API_KEY; cuesta dinero)
 *   npm run eval -- --split=holdout --case=H01,H03
 *
 * Lee ANTHROPIC_API_KEY del entorno o de .env.local / .env.
 * Escribe eval/reports/latest.md y eval/reports/latest.json.
 * Sale con código 1 si hay algún pago indebido (2 si la configuración es inválida).
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs, USAGE, UsageError } from "./args";
import { renderMarkdown, runEval, summaryLine, type EvalOptions } from "./lib";

/** Carga .env.local y .env si existen (lo ya definido en el entorno manda), como hace Next. */
function loadEnvFiles(): void {
  for (const file of [".env.local", ".env"]) {
    const full = path.join(process.cwd(), file);
    if (existsSync(full)) process.loadEnvFile(full);
  }
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

  console.log(`Banco de pruebas · lector ${opts.reader} · casos ${opts.split}${opts.cases ? ` (${opts.cases.join(", ")})` : ""}`);
  let report;
  try {
    report = await runEval({
      ...opts,
      onCase: (r) => {
        const mark = r.error ? "ERROR" : r.improperPayment ? "PAGO INDEBIDO" : r.correct ? "ok" : "FALLO";
        console.log(`  ${r.caseId.padEnd(4)} ${r.escenario.padEnd(11)} esperado ${r.expected.padEnd(7)} obtenido ${(r.outcome ?? "—").padEnd(7)} ${mark}`);
      },
    });
  } catch (err) {
    console.error(`\nNo se pudo correr el banco de pruebas: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }

  const dir = path.join(process.cwd(), "eval", "reports");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "latest.md"), renderMarkdown(report), "utf8");
  await writeFile(path.join(dir, "latest.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(`\n${summaryLine(report)}`);
  if (report.reader === "cache" && report.cacheMisses > 0) {
    console.log(`Aviso: ${report.cacheMisses} lectura(s) no estaban en la caché; esos casos escalan por LEC-1.`);
  }
  console.log(`Reporte: ${path.relative(process.cwd(), path.join(dir, "latest.md"))}`);

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
