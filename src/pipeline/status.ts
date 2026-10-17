/**
 * Modo de lectura y estado de la aplicación (lo que muestra la pantalla y `GET /api/status`).
 */
import { PRIMARY_MODEL, PROMPT_VERSION, SECONDARY_MODEL, SIMULATED_MODEL } from "../extract";
import { getCompany } from "../store";
import { loadDatasetCompany } from "./dataset";

export type ReadingMode = "live" | "simulated";

export interface AppStatus {
  readingMode: ReadingMode;
  /** Modelos que leen las facturas en este modo (sin repetir). */
  models: string[];
  promptVersion: string;
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

/** Modelos de cada modo, en el orden lector principal → segundo lector, sin repetir. */
export function modelsFor(mode: ReadingMode): string[] {
  return mode === "live" ? [PRIMARY_MODEL, SECONDARY_MODEL] : [SIMULATED_MODEL];
}

/** true si `DEMO_ACCESS_CODE` está definida (y no vacía). */
export function isAccessProtected(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.DEMO_ACCESS_CODE?.trim());
}

export async function getAppStatus(): Promise<AppStatus> {
  const mode = readingMode();
  let companyName: string;
  try {
    companyName = (await getCompany())?.name ?? loadDatasetCompany().name;
  } catch {
    // El estado no debe fallar porque la base no responda: se muestra el nombre del dataset.
    companyName = loadDatasetCompany().name;
  }
  return {
    readingMode: mode,
    models: modelsFor(mode),
    promptVersion: PROMPT_VERSION,
    accessProtected: isAccessProtected(),
    companyName,
  };
}
