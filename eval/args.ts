/**
 * Opciones de la línea de comandos del banco de pruebas (eval/run.ts).
 */
import type { EvalOptions, EvalReader, EvalSplit } from "./lib";

const READERS: readonly EvalReader[] = ["simulated", "cache", "live"];
const SPLITS: readonly EvalSplit[] = ["train", "holdout", "all"];

export const USAGE = `Uso: tsx eval/run.ts [--reader=simulated|cache|live] [--split=train|holdout|all] [--case=B01,B02 ...]

  --reader  simulated (por defecto): lectura «perfecta» del manifiesto, sin costo.
            cache: solo lecturas guardadas en dataset/reading-cache (no llama a la API).
            live: API de Anthropic con esa caché (requiere ANTHROPIC_API_KEY; cuesta dinero).
  --split   train, holdout o all (por defecto).
  --case    uno o más casos (separados por coma o repitiendo la opción). Los casos anteriores
            de su escenario se procesan igual, solo como historial.`;

export class UsageError extends Error {}

export function parseArgs(argv: readonly string[]): EvalOptions {
  const opts: EvalOptions = { reader: "simulated", split: "all" };
  const cases: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") throw new UsageError("");
    const m = /^--(reader|split|case)(?:=(.*))?$/.exec(arg);
    if (!m) throw new UsageError(`Opción desconocida: ${arg}`);
    const value = m[2] ?? argv[++i];
    if (value == null || value === "") throw new UsageError(`Falta el valor de --${m[1]}.`);
    if (m[1] === "reader") {
      if (!READERS.includes(value as EvalReader)) throw new UsageError(`--reader debe ser ${READERS.join(", ")}.`);
      opts.reader = value as EvalReader;
    } else if (m[1] === "split") {
      if (!SPLITS.includes(value as EvalSplit)) throw new UsageError(`--split debe ser ${SPLITS.join(", ")}.`);
      opts.split = value as EvalSplit;
    } else {
      cases.push(...value.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean));
    }
  }
  if (cases.length > 0) opts.cases = [...new Set(cases)];
  return opts;
}
