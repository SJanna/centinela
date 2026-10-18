/**
 * Escanea los documentos del dataset (base y estrés) con los detectores sin modelo y lista las
 * coincidencias, para medir falsos positivos.  npx tsx redteam/scan-markers.ts
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { normalizeFile } from "../src/ingest";
import { detectVoidDocumentMarkers } from "../src/extract/void-markers";

const ROOT = path.resolve(__dirname, "..");
const DIRS = [path.join(ROOT, "dataset", "generated"), path.join(ROOT, "dataset", "stress", "generated")];

async function main(): Promise<void> {
  let scanned = 0;
  let withText = 0;
  const hits: string[] = [];
  for (const dir of DIRS) {
    for (const name of readdirSync(dir).sort()) {
      if (!/\.(pdf|eml|txt|png|jpg|jpeg|html?)$/i.test(name)) continue;
      scanned++;
      const doc = await normalizeFile(new Uint8Array(readFileSync(path.join(dir, name))), name);
      if (!doc.plainText) continue;
      withText++;
      for (const m of detectVoidDocumentMarkers(doc.plainText)) hits.push(`${name}\t${m.reason}\t${m.text.slice(0, 120)}`);
    }
  }
  console.log(`escaneados ${scanned} · con texto ${withText} · marcas ${hits.length}`);
  for (const h of hits) console.log(h);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
