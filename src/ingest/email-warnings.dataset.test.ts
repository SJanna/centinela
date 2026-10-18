/**
 * Falsos positivos de los avisos de la entrada sobre los correos del dataset: ningún .eml de
 * dataset/generated ni de dataset/stress/generated cuya decision_esperada es PAGAR debe dar avisos
 * (versión HTML distinta del texto o adjunto sin leer). Solo lectura sobre dataset/**.
 * El set de estrés no se versiona: esa parte corre solo si ya se generó (npm run stress:generate).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { describe, expect, it } from "vitest";
import { normalizeFile } from "./index";

const root = process.cwd();

interface Entry {
  caseId: string;
  file: string;
  mediaType?: string;
}

function payableEmails(dir: string, csv: string): Entry[] {
  const rows = parse(readFileSync(path.join(root, csv), "utf8"), { columns: true, skip_empty_lines: true }) as {
    id: string;
    decision_esperada: string;
  }[];
  const expected = new Map(rows.map((r) => [r.id, r.decision_esperada]));
  const manifest = JSON.parse(readFileSync(path.join(root, dir, "manifest.json"), "utf8")) as Entry[];
  return manifest.filter((e) => e.file.toLowerCase().endsWith(".eml") && expected.get(e.caseId) === "PAGAR");
}

async function warningsOf(dir: string, entries: Entry[]): Promise<string[]> {
  const out: string[] = [];
  for (const e of entries) {
    const doc = await normalizeFile(new Uint8Array(readFileSync(path.join(root, dir, e.file))), e.file, e.mediaType);
    for (const w of doc.warnings ?? []) out.push(`${e.caseId}: ${w.code} · ${w.message}`);
  }
  return out;
}

describe("avisos de la entrada · correos legítimos del dataset", () => {
  it("0 avisos en los .eml de dataset/generated con decision_esperada PAGAR", async () => {
    const dir = path.join("dataset", "generated");
    const entries = payableEmails(dir, path.join("dataset", "casos.csv"));
    expect(entries.length).toBeGreaterThan(0);
    expect(await warningsOf(dir, entries)).toEqual([]);
  });

  const stressDir = path.join("dataset", "stress", "generated");
  it.skipIf(!existsSync(path.join(root, stressDir, "manifest.json")))(
    "0 avisos en los .eml de dataset/stress/generated con decision_esperada PAGAR",
    async () => {
      const entries = payableEmails(stressDir, path.join("dataset", "stress", "casos.csv"));
      expect(entries.length).toBeGreaterThan(100);
      expect(await warningsOf(stressDir, entries)).toEqual([]);
    },
    60_000,
  );
});
