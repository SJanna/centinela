/**
 * Nitidez de fotos reales, con la entrada real (normalizeFile → meta.sharpness), sin llamar a la API.
 * Sirve para revisar MIN_IMAGE_SHARPNESS con fotos de celular (ver docs/REDTEAM.md, «Errores honestos
 * y fotos borrosas», Parte C).
 *
 * Uso: npx tsx eval/nitidez-fotos.ts <carpeta>
 * El grupo de cada foto es su primera subcarpeta (p. ej. nitidas/, movidas/, whatsapp/).
 */
import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";
import { normalizeFile } from "../src/ingest";
import { MIN_IMAGE_SHARPNESS } from "../src/ingest/limits";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif", ".tif", ".tiff"]);
const THRESHOLDS = [80, 100, MIN_IMAGE_SHARPNESS, 150, 200, 250];

interface Row {
  file: string;
  group: string;
  sharpness: number | null;
  size: string;
  error?: string;
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(path)));
    else if (IMAGE_EXTENSIONS.has(extname(entry.name).toLowerCase())) out.push(path);
  }
  return out.sort();
}

async function measure(folder: string, path: string): Promise<Row> {
  const file = relative(folder, path);
  const group = file.includes(sep) ? file.split(sep)[0] : "—";
  try {
    const doc = await normalizeFile(new Uint8Array(await readFile(path)), file.split(sep).pop() ?? file);
    const sharpness = doc.meta.sharpness != null ? Number(doc.meta.sharpness) : null;
    return { file, group, sharpness, size: doc.meta.width ? `${doc.meta.width}×${doc.meta.height}` : "" };
  } catch (error) {
    return { file, group, sharpness: null, size: "", error: (error as Error).message };
  }
}

async function main(): Promise<void> {
  const folder = process.argv[2];
  if (!folder) throw new Error("Uso: npx tsx eval/nitidez-fotos.ts <carpeta>");
  const rows: Row[] = [];
  for (const path of await walk(folder)) rows.push(await measure(folder, path));

  console.log(`Mínimo actual: ${MIN_IMAGE_SHARPNESS} · ${rows.length} fotos\n`);
  console.log(["foto", "grupo", "px", "nitidez", "aviso"].join("\t"));
  for (const r of rows) {
    const warn = r.sharpness != null && Math.round(r.sharpness) < MIN_IMAGE_SHARPNESS ? "blurry_image" : "";
    console.log([r.file, r.group, r.size, r.error ? `error: ${r.error}` : (r.sharpness ?? "sin medida"), warn].join("\t"));
  }

  const groups = [...new Set(rows.map((r) => r.group))];
  console.log(`\nAvisarían por debajo de cada umbral (por grupo):`);
  console.log(["grupo", "fotos", "nitidez", ...THRESHOLDS.map((t) => `<${t}`)].join("\t"));
  for (const group of groups) {
    const values = rows.filter((r) => r.group === group && r.sharpness != null).map((r) => r.sharpness as number);
    if (values.length === 0) continue;
    const range = `${Math.min(...values)}–${Math.max(...values)}`;
    const counts = THRESHOLDS.map((t) => values.filter((v) => Math.round(v) < t).length);
    console.log([group, values.length, range, ...counts].join("\t"));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
