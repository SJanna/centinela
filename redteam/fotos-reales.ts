/**
 * EQUIPO ROJO · fotos reales de celular con tope de gasto.
 *
 *   npx tsx redteam/fotos-reales.ts --dir <carpeta con fotos> --list <archivo con nombres> \
 *     --budget-usd 0.2 --out <resultado.json> [--profile economico]
 *
 * Para cada foto de la lista (un nombre o una ruta por línea; se usa el nombre del archivo): normaliza
 * la imagen (mide la nitidez), la lee con los dos lectores del perfil y verifica las lecturas sin
 * modelo (assessReadings). No decide nada: guarda, por foto y por lectura, el total leído, si la
 * lectura lo marca ilegible, su cita, la del subtotal, las notas y si saltan totalNotConfirmedByQuote
 * y totalDoubtedInNotes; y de la verificación, los campos ilegibles, en qué no coinciden las lecturas
 * (LEC-2), las sumas (LEC-3) y los avisos de la entrada. Sirve para ver si la lectura sola deja pasar
 * un total equivocado o dudoso.
 *
 * Caché de lecturas en redteam/.cache (la misma de redteam/run.ts): repetir una foto no vuelve a
 * costar. Antes de cada lectura nueva comprueba que el gasto acumulado más una cota por par no pase
 * del tope; el ledger va junto al resultado (<out>.ledger.json).
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import type { Extraction, ReaderResult } from "../src/core/schemas";
import { normalizeFile } from "../src/ingest";
import { createFileReadingCache, readingCacheKey, readInvoice, totalDoubtedInNotes, totalNotConfirmedByQuote } from "../src/extract";
import { createLiveReaders, liveReaderSpecs, type ReaderProfile } from "../src/pipeline/readers";

const ROOT = path.resolve(__dirname, "..");
const CACHE_DIR = path.join(ROOT, "redteam", ".cache");
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
};
/** Cota superior de lo que cuesta un par de lecturas nuevas de una foto (margen de seguridad). */
const PAIR_COST_UPPER: Record<string, number> = { economico: 0.01, calidad: 0.05 };

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

function cost(model: string, inTok: number, outTok: number): number {
  const p = PRICES[model] ?? { input: 0, output: 0 };
  return (inTok * p.input + outTok * p.output) / 1_000_000;
}

interface Ledger {
  spentUsd: number;
  runs: { file: string; costUsd: number; at: string }[];
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

function readingOf(doc: Parameters<typeof totalNotConfirmedByQuote>[0], r: ReaderResult | null) {
  if (!r) return null;
  if (!r.ok) return { readerId: r.readerId, ok: false as const, error: r.error, message: r.message };
  const e: Extraction = r.extraction;
  return {
    readerId: r.readerId,
    ok: true as const,
    documentType: e.documentType,
    vendor: e.vendorName.value,
    currency: e.currency.value,
    total: e.total.value,
    totalLegible: e.total.legible,
    totalEvidence: e.total.evidence,
    subtotal: e.subtotal.value,
    subtotalEvidence: e.subtotal.evidence,
    notes: e.readerNotes ?? "",
    totalNotConfirmedByQuote: totalNotConfirmedByQuote(doc, e),
    totalDoubtedInNotes: totalDoubtedInNotes(doc, e),
  };
}

async function main(): Promise<number> {
  loadEnv();
  const dir = path.resolve(arg("--dir") ?? ".");
  const listFile = arg("--list");
  const out = path.resolve(arg("--out") ?? "fotos-reales.json");
  const budget = Number(arg("--budget-usd", "0.2"));
  const profile = (arg("--profile", "economico") as ReaderProfile) ?? "economico";
  if (!listFile) {
    console.error("Falta --list (un nombre de foto por línea).");
    return 2;
  }
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    console.error("Falta ANTHROPIC_API_KEY (en .env.local).");
    return 2;
  }

  const files = readFileSync(listFile, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"))
    .map((l) => path.basename(l));

  mkdirSync(CACHE_DIR, { recursive: true });
  const cache = createFileReadingCache(CACHE_DIR);
  const readers = createLiveReaders({ profile, cache, client: new Anthropic({ maxRetries: 3 }) });
  const specs = liveReaderSpecs(profile);
  const ledgerFile = out.replace(/\.json$/, "") + ".ledger.json";
  const ledger = loadLedger(ledgerFile);
  const pairUpper = PAIR_COST_UPPER[profile] ?? 0.05;
  const results: unknown[] = [];

  console.log(`=== fotos reales · ${files.length} fotos · perfil ${profile} · tope USD ${budget} (gastado: USD ${ledger.spentUsd.toFixed(4)}) ===`);

  for (const file of files) {
    const bytes = new Uint8Array(readFileSync(path.join(dir, file)));
    const doc = await normalizeFile(bytes, file);
    const keyA = readingCacheKey(doc.fileHash, specs.primary.id, specs.primary.model, specs.primary.promptVersion);
    const keyB = readingCacheKey(doc.fileHash, specs.secondary.id, specs.secondary.model, specs.secondary.promptVersion);
    const cached = (await safeGet(cache, keyA)) != null && (await safeGet(cache, keyB)) != null;
    if (!cached && ledger.spentUsd + pairUpper > budget) {
      console.log(`[${file}] OMITIDA por tope de gasto (gastado USD ${ledger.spentUsd.toFixed(4)} de ${budget}).`);
      results.push({ file, skipped: "presupuesto" });
      continue;
    }

    const reading = await readInvoice(doc, readers);
    let runCost = 0;
    for (const r of [reading.primary, reading.secondary]) {
      if (r && r.ok && r.usage) runCost += cost(r.model, r.usage.inputTokens, r.usage.outputTokens);
    }
    ledger.spentUsd += runCost;
    ledger.runs.push({ file, costUsd: runCost, at: new Date().toISOString() });
    writeFileSync(ledgerFile, JSON.stringify(ledger, null, 2) + "\n");

    const s = reading.signals;
    const row = {
      file,
      sharpness: doc.meta?.sharpness != null ? Number(doc.meta.sharpness) : null,
      ingestWarningCodes: s.ingestWarningCodes ?? [],
      illegibleCriticalFields: s.illegibleCriticalFields,
      missingCriticalFields: s.missingCriticalFields,
      readersDisagreeOn: s.readersDisagreeOn,
      arithmeticIssues: s.arithmeticIssues,
      data: reading.data ? { total: reading.data.total, currency: reading.data.currency } : null,
      readings: [readingOf(doc, reading.primary), readingOf(doc, reading.secondary)],
      costUsd: runCost,
      cached,
    };
    results.push(row);
    const [a, b] = row.readings;
    const short = (x: typeof a) =>
      x == null ? "∅" : x.ok ? `${x.total ?? "∅"}${x.totalLegible ? "" : "(ilegible)"}${x.totalNotConfirmedByQuote ? "[cita]" : ""}${x.totalDoubtedInNotes ? "[nota]" : ""}` : `ERROR ${x.error}`;
    console.log(
      `[${file}] nitidez ${row.sharpness ?? "?"} · A ${short(a)} · B ${short(b)} · ilegibles: ${s.illegibleCriticalFields.join(",") || "—"} · discrepan: ${s.readersDisagreeOn.join(",") || "—"} · USD ${runCost.toFixed(4)}${cached ? " (caché)" : ""} · acumulado USD ${ledger.spentUsd.toFixed(4)}`,
    );
    writeFileSync(out, JSON.stringify(results, null, 2) + "\n");
  }

  writeFileSync(out, JSON.stringify(results, null, 2) + "\n");
  console.log(`\nGasto total USD ${ledger.spentUsd.toFixed(4)} de ${budget}. Resultado en ${out}`);
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
