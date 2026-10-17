/**
 * Opciones de la línea de comandos del banco de pruebas (eval/run.ts).
 */
import { parseReaderProfile, READER_PROFILE_NAMES } from "../src/extract";
import { DATASET_NAMES, type DatasetName } from "./datasets";
import { REPORT_NAME, type EvalOptions, type EvalReader, type EvalSplit } from "./lib";

const READERS: readonly EvalReader[] = ["simulated", "cache", "live"];
const SPLITS: readonly EvalSplit[] = ["train", "holdout", "all"];

export const USAGE = `Uso: tsx eval/run.ts [--reader=simulated|cache|live] [--profile=economico|calidad] [--dataset=base|stress]
                    [--split=train|holdout|all] [--case=B01,B02 ...] [--concurrency=N] [--sample=N] [--seed=N]
                    [--out=nombre]

  --reader       simulated (por defecto): lectura «perfecta» del manifiesto, sin costo.
                 cache: solo lecturas guardadas (no llama a la API).
                 live: API de Anthropic con esa caché (requiere ANTHROPIC_API_KEY; cuesta dinero).
  --profile      perfil de lectura de cache y live (por defecto READER_PROFILE, o economico):
                 economico = Haiku 5.5 (prompt a) + Haiku 5.5 (prompt b);
                 calidad = Sonnet 5.5 (prompt a) + Haiku 5.5 (prompt a).
  --dataset      base (por defecto): dataset/ (41 casos) · stress: dataset/stress/ (2000 casos,
                 se generan con npm run stress:generate). Caché: dataset/reading-cache o
                 dataset/stress/reading-cache.
  --split        train, holdout o all (por defecto).
  --case         uno o más casos (separados por coma o repitiendo la opción). Los casos anteriores
                 de su escenario se procesan igual, solo como historial.
  --concurrency  escenarios en paralelo (por defecto 1). Los casos de un escenario van en orden.
  --sample       evalúa una muestra estratificada (trampa × formato) de N casos, para pilotos. Los
                 casos anteriores de cada escenario se procesan como historial con la lectura
                 simulada (sin costo).
  --seed         semilla de la muestra (por defecto 17).
  --out          nombre de los archivos del reporte en eval/reports (sin extensión). Por defecto
                 latest (dataset base) o stress-<lector>[-<perfil>][-muestraN] (set de estrés).`;

export class UsageError extends Error {}

function positiveInt(name: string, value: string): number {
  const n = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(n) || n < 1) throw new UsageError(`--${name} debe ser un entero positivo.`);
  return n;
}

export function parseArgs(argv: readonly string[]): EvalOptions {
  const opts: EvalOptions = { reader: "simulated", split: "all" };
  const cases: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") throw new UsageError("");
    const m = /^--(reader|profile|split|case|dataset|concurrency|sample|seed|out)(?:=(.*))?$/.exec(arg);
    if (!m) throw new UsageError(`Opción desconocida: ${arg}`);
    const value = m[2] ?? argv[++i];
    if (value == null || value === "") throw new UsageError(`Falta el valor de --${m[1]}.`);
    switch (m[1]) {
      case "reader":
        if (!READERS.includes(value as EvalReader)) throw new UsageError(`--reader debe ser ${READERS.join(", ")}.`);
        opts.reader = value as EvalReader;
        break;
      case "split":
        if (!SPLITS.includes(value as EvalSplit)) throw new UsageError(`--split debe ser ${SPLITS.join(", ")}.`);
        opts.split = value as EvalSplit;
        break;
      case "dataset":
        if (!DATASET_NAMES.includes(value as DatasetName)) throw new UsageError(`--dataset debe ser ${DATASET_NAMES.join(", ")}.`);
        opts.dataset = value as DatasetName;
        break;
      case "concurrency":
        opts.concurrency = positiveInt("concurrency", value);
        break;
      case "sample":
        opts.sample = positiveInt("sample", value);
        break;
      case "profile": {
        const profile = parseReaderProfile(value);
        const typed = value.trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
        if (typed !== profile) throw new UsageError(`--profile debe ser ${READER_PROFILE_NAMES.join(", ")}.`);
        opts.profile = profile;
        break;
      }
      case "out":
        if (!REPORT_NAME.test(value) || value.includes("..")) {
          throw new UsageError("--out debe ser un nombre simple (letras, números, «-», «_» o «.»), sin carpetas.");
        }
        opts.out = value;
        break;
      case "seed":
        if (!/^\d+$/.test(value)) throw new UsageError("--seed debe ser un entero.");
        opts.sampleSeed = Number(value);
        break;
      default:
        cases.push(...value.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean));
    }
  }
  if (cases.length > 0) opts.cases = [...new Set(cases)];
  return opts;
}
