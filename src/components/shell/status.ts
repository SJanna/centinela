/**
 * Estado que muestra el header: modo de lectura y nombre de la empresa.
 * Solo servidor (lee variables de entorno y la base).
 */
import { connection } from "next/server";
import { cache } from "react";
import { getCompany } from "@/store";
import type { ReadingMode } from "./config";

export type { ReadingMode } from "./config";

/** Nombre que se muestra si la base todavía no tiene empresa. */
export const FALLBACK_COMPANY_NAME = "Andes Labs Inc.";

/**
 * READING_MODE = live | simulated | auto (por defecto auto).
 * auto → live si hay ANTHROPIC_API_KEY; si no, simulated. Igual que /api/status.
 */
export function resolveReadingMode(env: Record<string, string | undefined> = process.env): ReadingMode {
  const raw = (env.READING_MODE ?? "auto").trim().toLowerCase();
  if (raw === "live") return "live";
  if (raw === "simulated") return "simulated";
  return env.ANTHROPIC_API_KEY?.trim() ? "live" : "simulated";
}

export interface ShellStatus {
  readingMode: ReadingMode;
  companyName: string;
}

/** Una vez por petición (React cache). Nunca falla: si la base no responde, usa el nombre por defecto. */
export const getShellStatus = cache(async (): Promise<ShellStatus> => {
  // Depende del entorno y de la base: no se prerenderiza.
  await connection();
  const readingMode = resolveReadingMode();
  let companyName = FALLBACK_COMPANY_NAME;
  try {
    const company = await getCompany();
    const name = company?.name?.trim();
    if (name) companyName = name;
  } catch {
    // Base sin preparar o sin conexión: el header sigue funcionando con el nombre por defecto.
  }
  return { readingMode, companyName };
});
