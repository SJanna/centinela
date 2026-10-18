/**
 * EQUIPO ROJO · sonda sin costo (no llama a la API). Para cada subcarpeta: normaliza el archivo e
 * imprime kind, si hay texto verificable, el plainText y lo que ven los detectores deterministas
 * (instrucciones y 'ya pagado'). Sirve para validar las trampas antes de gastar presupuesto.
 *
 *   npx tsx redteam/probe.ts --dir redteam/attacks/inyeccion [--only INY-01-...]
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { normalizeFile } from "../src/ingest";
import { detectSuspiciousInstructions, detectPaidDocumentMarkers, hasVerifiableText } from "../src/extract";

const ROOT = path.resolve(__dirname, "..");
function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

async function main(): Promise<void> {
  const dir = path.resolve(ROOT, arg("--dir", "redteam/attacks/inyeccion")!);
  const only = arg("--only");
  const subdirs = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((n) => !only || only.split(",").includes(n))
    .sort();
  for (const id of subdirs) {
    const adir = path.join(dir, id);
    const name = readdirSync(adir).find((f) => /^factura\./.test(f));
    if (!name) continue;
    const bytes = new Uint8Array(readFileSync(path.join(adir, name)));
    let doc;
    try {
      doc = await normalizeFile(bytes, name);
    } catch (err) {
      console.log(`\n### ${id}: ERROR normalizando: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    console.log(`\n### ${id} · kind=${doc.kind} · hasVerifiableText=${hasVerifiableText(doc)} · plainText ${doc.plainText ? doc.plainText.length + " chars" : "null"}`);
    if (doc.plainText) {
      console.log("--- plainText ---");
      console.log(doc.plainText.slice(0, 1600));
      const instr = detectSuspiciousInstructions(doc.plainText);
      const paid = detectPaidDocumentMarkers(doc.plainText);
      console.log(`--- detector instrucciones: ${instr.length} ---`);
      for (const i of instr) console.log(`   «${i.text.slice(0, 90)}» (${i.reason})`);
      console.log(`--- detector ya-pagado: ${paid.length} ---`);
      for (const p of paid) console.log(`   «${p.text.slice(0, 90)}» (${p.reason})`);
    }
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
