/**
 * Perfiles de lectura: qué modelo y qué variante de prompt usa cada una de las dos lecturas.
 *
 * - «economico» (por defecto): Haiku 5.5 en las dos lecturas. Para que no sean dos copias de la
 *   misma lectura, la segunda usa el prompt «b» (otra formulación y otro orden de los campos).
 * - «calidad»: Sonnet 5.5 con el prompt «a» + Haiku 5.5 con el prompt «a» (el comportamiento
 *   anterior; reutiliza las lecturas ya guardadas en la caché).
 *
 * Los dos perfiles usan esfuerzo «low». El modelo nunca decide: con cualquier perfil, monto, cuenta
 * y acuerdo se comparan después en código.
 */
import { HAIKU_MODEL, SONNET_MODEL } from "./anthropic-reader";
import { promptVersionOf, type PromptVariant } from "./prompt";

export type ReaderProfile = "economico" | "calidad";

export const READER_PROFILE_NAMES: readonly ReaderProfile[] = ["economico", "calidad"];

export const DEFAULT_READER_PROFILE: ReaderProfile = "economico";

export interface ReaderSlotSpec {
  model: string;
  promptVariant: PromptVariant;
}

export interface ReaderProfileSpec {
  primary: ReaderSlotSpec;
  secondary: ReaderSlotSpec;
}

export const READER_PROFILES: Readonly<Record<ReaderProfile, ReaderProfileSpec>> = {
  economico: {
    primary: { model: HAIKU_MODEL, promptVariant: "a" },
    secondary: { model: HAIKU_MODEL, promptVariant: "b" },
  },
  calidad: {
    primary: { model: SONNET_MODEL, promptVariant: "a" },
    secondary: { model: HAIKU_MODEL, promptVariant: "a" },
  },
};

/**
 * Interpreta el valor de `READER_PROFILE`. Acepta mayúsculas, espacios y la tilde («económico»).
 * Vacío o desconocido → el perfil por defecto («economico»).
 */
export function parseReaderProfile(raw: string | undefined | null): ReaderProfile {
  const value = (raw ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  return value === "calidad" ? "calidad" : value === "economico" ? "economico" : DEFAULT_READER_PROFILE;
}

/** Modelos de un perfil en orden lectura principal → segunda lectura, sin repetir. */
export function profileModels(profile: ReaderProfile): string[] {
  const { primary, secondary } = READER_PROFILES[profile];
  return [...new Set([primary.model, secondary.model])];
}

/** Versión de prompt de cada lectura de un perfil. */
export function profilePromptVersions(profile: ReaderProfile): { primary: string; secondary: string } {
  const { primary, secondary } = READER_PROFILES[profile];
  return { primary: promptVersionOf(primary.promptVariant), secondary: promptVersionOf(secondary.promptVariant) };
}
