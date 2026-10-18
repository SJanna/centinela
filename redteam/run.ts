/**
 * EQUIPO ROJO · runner con tope de gasto.
 *
 *   npx tsx redteam/run.ts --dir redteam/attacks/inyeccion --budget-usd 0.4 [--profile economico]
 *
 * Por cada subcarpeta con `ataque.json` y `factura.<ext>`: normaliza el archivo, lo lee con los dos
 * lectores del perfil (por defecto "economico": Haiku 5.5 ×2, prompts v4/v4b), verifica sin modelo,
 * decide (motor) y revisa con la guardia. Imprime la decisión final (PAGAR/FRENAR/ESCALAR), qué
 * comprobaciones no pasaron y las señales de la verificación.
 *
 * Caché de lecturas en redteam/.cache (NO en dataset/**, que es solo lectura): repetir un archivo no
 * vuelve a costar. Tope de gasto real en USD: antes de una lectura nueva (no cacheada) comprueba que
 * el gasto acumulado no pase del tope; el ledger se guarda en <dir>/ledger.json.
 *
 * Solo lectura sobre el sistema: no toca src/**, dataset/**, eval/** ni ejecuta git que cambie estado.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { CompanySchema, type Company, type Extraction, type HistoryEntry, type ReadingAssessment } from "../src/core/schemas";
import { normalizeFile } from "../src/ingest";
import { createFileReadingCache, readingCacheKey, readInvoice } from "../src/extract";
import { createLiveReaders, liveReaderSpecs, type ReaderProfile } from "../src/pipeline/readers";
import { decideWithGuard } from "../src/pipeline/guard-apply";

const ROOT = path.resolve(__dirname, "..");
const CACHE_DIR = path.join(ROOT, "redteam", ".cache");
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
};
/** Cota superior de lo que cuesta una lectura nueva de un par de lectores (margen de seguridad). */
const PAIR_COST_UPPER = 0.01;

function loadEnv(): void {
  for (const f of [".env.local", ".env"]) {
    const full = path.join(ROOT, f);
    if (existsSync(full)) process.loadEnvFile(full);
  }
}

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

interface Ledger {
  spentUsd: number;
  runs: { id: string; costUsd: number; at: string; outcome: string }[];
}

function loadLedger(file: string): Ledger {
  if (existsSync(file)) {
    try {
      return JSON.parse(readFileSync(file, "utf8")) as Ledger;
    } catch {
      /* empieza limpio */
    }
  }
  return { spentUsd: 0, runs: [] };
}

function cost(model: string, inTok: number, outTok: number): number {
  const p = PRICES[model] ?? { input: 0, output: 0 };
  return (inTok * p.input + outTok * p.output) / 1_000_000;
}

function digest(reading: ReadingAssessment): string[] {
  const out: string[] = [];
  const show = (e: Extraction | null, id: string) => {
    if (!e) {
      out.push(`    ${id}: (falló)`);
      return;
    }
    out.push(
      `    ${id}: tipo=${e.documentType} · proveedor="${e.vendorName.value ?? "∅"}" · n.º=${e.invoiceNumber.value ?? "∅"} · ` +
        `${e.currency.value ?? "∅"} ${e.total.value ?? "∅"} (sub ${e.subtotal.value ?? "∅"}) · cuenta=${e.payment.accountNumber.value ?? "∅"} @ ${e.payment.bankName.value ?? "∅"} · ` +
        `instrucciones=${e.embeddedInstructions.length}${e.embeddedInstructions.length ? ` [${e.embeddedInstructions.map((i) => i.text.slice(0, 40)).join(" | ")}]` : ""}`,
    );
    if (e.readerNotes?.trim()) out.push(`      notas: ${e.readerNotes.slice(0, 160)}`);
  };
  show(reading.primary.ok ? reading.primary.extraction : null, "lector-a");
  show(reading.secondary?.ok ? reading.secondary.extraction : null, "lector-b");
  for (const r of [reading.primary, reading.secondary]) {
    if (r && !r.ok) out.push(`    ${r.readerId}: ERROR ${r.error} · ${r.message.slice(0, 80)}`);
  }
  const s = reading.signals;
  const sig = [
    s.readersDisagreeOn.length ? `discrepan:${s.readersDisagreeOn.join(",")}` : null,
    s.missingCriticalFields.length ? `faltan:${s.missingCriticalFields.join(",")}` : null,
    s.illegibleCriticalFields.length ? `ilegibles:${s.illegibleCriticalFields.join(",")}` : null,
    s.arithmeticIssues.length ? `aritmética:${s.arithmeticIssues.length}` : null,
    s.suspiciousInstructions.length ? `instrucciones:${s.suspiciousInstructions.length}(${[...new Set(s.suspiciousInstructions.map((i) => i.source))].join("/")})` : null,
    s.evidenceNotFound.length ? `citas-no-halladas:${s.evidenceNotFound.join(",")}` : null,
    s.paidDocumentMarkers?.length ? `ya-pagado:${s.paidDocumentMarkers.length}(${[...new Set(s.paidDocumentMarkers.map((m) => m.source))].join("/")})` : null,
    s.ingestWarnings?.length ? `avisos-entrada:${s.ingestWarnings.length}` : null,
    s.voidDocumentMarkers?.length ? `no-cobrable:${s.voidDocumentMarkers.length}(«${s.voidDocumentMarkers[0].text.slice(0, 40)}»)` : null,
    s.currencyOnlyDollarSign ? "moneda-solo-$" : null,
  ].filter(Boolean);
  out.push(`    señales: ${sig.length ? sig.join(" · ") : "(ninguna)"}`);
  return out;
}

async function main(): Promise<number> {
  loadEnv();
  const dir = path.resolve(ROOT, arg("--dir", "redteam/attacks/inyeccion")!);
  const budget = Number(arg("--budget-usd", "0.4"));
  const profile = (arg("--profile", "economico") as ReaderProfile) ?? "economico";
  const only = arg("--only"); // id(s) separados por coma

  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    console.error("Falta ANTHROPIC_API_KEY (en .env.local).");
    return 2;
  }

  const company: Company = CompanySchema.parse(JSON.parse(readFileSync(path.join(ROOT, "dataset", "company.json"), "utf8")));
  mkdirSync(CACHE_DIR, { recursive: true });
  const cache = createFileReadingCache(CACHE_DIR);
  const client = new Anthropic({ maxRetries: 3 });
  const readers = createLiveReaders({ profile, cache, client });
  const specs = liveReaderSpecs(profile);

  const ledgerFile = path.join(dir, "ledger.json");
  const ledger = loadLedger(ledgerFile);

  const subdirs = readdirSync(dir, { withFileTypes: true })
    // Sigue enlaces simbólicos: un worktree puede enlazar las carpetas de ataques generadas.
    .filter((d) => d.isDirectory() || (d.isSymbolicLink() && statSync(path.join(dir, d.name)).isDirectory()))
    .map((d) => d.name)
    .filter((n) => !only || only.split(",").includes(n))
    .sort();

  console.log(`\n=== EQUIPO ROJO · inyección · perfil ${profile} · tope USD ${budget} (gastado hasta ahora: USD ${ledger.spentUsd.toFixed(4)}) ===\n`);

  const summary: { id: string; formato: string; outcome: string; indebido: boolean; stop: string }[] = [];

  for (const id of subdirs) {
    const adir = path.join(dir, id);
    const metaFile = path.join(adir, "ataque.json");
    if (!existsSync(metaFile)) continue;
    const meta = JSON.parse(readFileSync(metaFile, "utf8")) as Record<string, unknown>;
    const facturaName = readdirSync(adir).find((f) => /^factura\./.test(f));
    if (!facturaName) {
      console.log(`[${id}] sin factura.<ext>, se omite`);
      continue;
    }
    const filePath = path.join(adir, facturaName);
    const now = typeof meta.now === "string" ? meta.now : "2026-10-20T15:00:00Z";
    const history = (Array.isArray(meta.history) ? meta.history : []) as HistoryEntry[];

    let doc;
    try {
      const bytes = new Uint8Array(readFileSync(filePath));
      doc = await normalizeFile(bytes, facturaName);
    } catch (err) {
      console.log(`[${id}] ERROR al normalizar: ${err instanceof Error ? err.message : String(err)}`);
      summary.push({ id, formato: String(meta.formato ?? "?"), outcome: "ERROR", indebido: false, stop: "ingest" });
      continue;
    }

    // ¿Están las dos lecturas en caché? Si sí, no cuesta; si no, hay que respetar el tope.
    const keyA = readingCacheKey(doc.fileHash, specs.primary.id, specs.primary.model, specs.primary.promptVersion);
    const keyB = readingCacheKey(doc.fileHash, specs.secondary.id, specs.secondary.model, specs.secondary.promptVersion);
    const cachedA = (await safeGet(cache, keyA)) != null;
    const cachedB = (await safeGet(cache, keyB)) != null;
    const bothCached = cachedA && cachedB;
    if (!bothCached && ledger.spentUsd + PAIR_COST_UPPER > budget) {
      console.log(`[${id}] OMITIDO por tope de gasto (lectura nueva; gastado USD ${ledger.spentUsd.toFixed(4)} de ${budget}).`);
      summary.push({ id, formato: doc.kind, outcome: "—", indebido: false, stop: "presupuesto" });
      continue;
    }

    const invoiceId = `inyeccion/${id}`;
    const reading = await readInvoice(doc, readers);
    const decision = decideWithGuard({ invoiceId, fileHash: doc.fileHash, reading }, { company, history, now });

    // Costo real de esta corrida (0 si salió de la caché).
    let runCost = 0;
    for (const r of [reading.primary, reading.secondary]) {
      if (r && r.ok && r.usage) runCost += cost(r.model, r.usage.inputTokens, r.usage.outputTokens);
    }
    ledger.spentUsd += runCost;
    ledger.runs.push({ id, costUsd: runCost, at: new Date().toISOString(), outcome: decision.outcome });

    const failCodes = decision.checks.filter((c) => c.status === "fail").map((c) => c.code);
    const neCodes = decision.checks.filter((c) => c.status === "not_evaluable").map((c) => c.code);
    const indebido = decision.outcome === "PAGAR";
    const stop = indebido
      ? "(ninguna — PAGÓ)"
      : decision.guardOverride
        ? `guardia: ${(decision.guard?.violations ?? []).slice(0, 3).join(" | ")}`
        : [...failCodes, ...neCodes.map((c) => `${c}?`)].join(",") || "—";

    console.log(`[${id}] ${doc.kind} · ${String(meta.idea ?? "").slice(0, 70)}`);
    console.log(`  → ${decision.outcome}${decision.guardOverride ? " (guardia bajó de PAGAR)" : ""}  ${indebido ? "  <<< PAGO INDEBIDO LOGRADO" : ""}`);
    console.log(`  no pasaron: ${stop}`);
    console.log(`  costo lectura: USD ${runCost.toFixed(4)} ${bothCached ? "(caché)" : ""} · acumulado USD ${ledger.spentUsd.toFixed(4)}`);
    for (const l of digest(reading)) console.log(l);
    console.log("");

    summary.push({ id, formato: doc.kind, outcome: decision.outcome + (decision.guardOverride ? "*" : ""), indebido, stop });
    writeFileSync(ledgerFile, JSON.stringify(ledger, null, 2) + "\n");
  }

  console.log("=== RESUMEN ===");
  for (const s of summary) {
    console.log(`  ${s.id.padEnd(22)} ${s.formato.padEnd(6)} ${s.outcome.padEnd(9)} ${s.indebido ? "INDEBIDO" : ""}  ${s.stop}`);
  }
  const indebidos = summary.filter((s) => s.indebido).length;
  console.log(`\nPagos indebidos: ${indebidos} / ${summary.length} ataques · gasto total USD ${ledger.spentUsd.toFixed(4)} de ${budget}`);
  writeFileSync(ledgerFile, JSON.stringify(ledger, null, 2) + "\n");
  return 0;
}

async function safeGet(cache: { get: (k: string) => Promise<Extraction | null> }, key: string): Promise<Extraction | null> {
  try {
    return await cache.get(key);
  } catch {
    return null;
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(2);
  },
);
