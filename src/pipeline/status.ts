/**
 * Modo de lectura y estado de la aplicación (lo que muestra la pantalla y `GET /api/status`).
 */
import { PROMPT_VERSION, SIMULATED_MODEL, profileModels, type ReaderProfile } from "../extract";
import { getCompany } from "../store";
import { loadDatasetCompany } from "./dataset";
import { liveReaderSpecs, PRIMARY_READER_ID, readerProfile, SECONDARY_READER_ID } from "./readers";

export type ReadingMode = "live" | "simulated";

/** Un lector tal como lo usa la aplicación: id, modelo y versión de prompt. */
export interface StatusReader {
  id: string;
  model: string;
  promptVersion: string;
}

export interface AppStatus {
  readingMode: ReadingMode;
  /** Perfil de lectura (`READER_PROFILE`). null en modo simulado: no se llama a ningún modelo. */
  readerProfile: ReaderProfile | null;
  /** Modelos que leen las facturas en este modo (sin repetir). */
  models: string[];
  /** Versión del prompt del lector principal (cada lector trae la suya en `readers`). */
  promptVersion: string;
  /** Los dos lectores en orden principal → segunda lectura. */
  readers: StatusReader[];
  /** true si la demo exige el código de acceso (`DEMO_ACCESS_CODE`). */
  accessProtected: boolean;
  companyName: string;
}

/**
 * `READING_MODE` = `live` | `simulated` | `auto` (por defecto `auto`).
 * `auto` → `live` si hay `ANTHROPIC_API_KEY`, si no `simulated`. Un valor desconocido cuenta como `auto`.
 */
export function readingMode(env: Record<string, string | undefined> = process.env): ReadingMode {
  const requested = env.READING_MODE?.trim().toLowerCase();
  if (requested === "live") return "live";
  if (requested === "simulated") return "simulated";
  return env.ANTHROPIC_API_KEY?.trim() ? "live" : "simulated";
}

/**
 * Modelos de cada modo, en el orden lector principal → segundo lector, sin repetir. En vivo dependen
 * del perfil (por defecto el de `READER_PROFILE`).
 */
export function modelsFor(mode: ReadingMode, profile: ReaderProfile = readerProfile()): string[] {
  return mode === "live" ? profileModels(profile) : [SIMULATED_MODEL];
}

/** Lectores de cada modo (id, modelo, versión de prompt), en el orden principal → segunda lectura. */
export function readersFor(mode: ReadingMode, profile: ReaderProfile = readerProfile()): StatusReader[] {
  if (mode === "simulated") {
    return [PRIMARY_READER_ID, SECONDARY_READER_ID].map((id) => ({ id, model: SIMULATED_MODEL, promptVersion: PROMPT_VERSION }));
  }
  const { primary, secondary } = liveReaderSpecs(profile);
  return [primary, secondary].map(({ id, model, promptVersion }) => ({ id, model, promptVersion }));
}

/** true si `DEMO_ACCESS_CODE` está definida (y no vacía). */
export function isAccessProtected(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.DEMO_ACCESS_CODE?.trim());
}

export async function getAppStatus(): Promise<AppStatus> {
  const mode = readingMode();
  const profile = readerProfile();
  const readers = readersFor(mode, profile);
  let companyName: string;
  try {
    companyName = (await getCompany())?.name ?? loadDatasetCompany().name;
  } catch {
    // El estado no debe fallar porque la base no responda: se muestra el nombre del dataset.
    companyName = loadDatasetCompany().name;
  }
  return {
    readingMode: mode,
    readerProfile: mode === "live" ? profile : null,
    models: modelsFor(mode, profile),
    promptVersion: readers[0].promptVersion,
    readers,
    accessProtected: isAccessProtected(),
    companyName,
  };
}
