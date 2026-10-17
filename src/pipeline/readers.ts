/**
 * Lectores de la aplicación según el modo de lectura.
 *
 * - live: dos lectores de Anthropic («lector-a» y «lector-b»), cada uno con la caché de la base.
 *   El perfil (`READER_PROFILE`) elige modelo y prompt de cada uno:
 *     economico (por defecto) → Haiku 5.5 con el prompt «a» + Haiku 5.5 con el prompt «b»;
 *     calidad                 → Sonnet 5.5 con el prompt «a» + Haiku 5.5 con el prompt «a».
 * - simulated: lectura «perfecta» de dataset/generated/manifest.json para los dos lectores.
 *   Cualquier archivo que no esté en el manifiesto no tiene lectura y escala por LEC-1.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { ReadingCache } from "../core/ports";
import type { NormalizedDoc, Reader, ReaderResult } from "../core/schemas";
import {
  createAnthropicReader,
  createCachedReader,
  createSimulatedReader,
  parseReaderProfile,
  promptVersionOf,
  READER_PROFILES,
  type PromptVariant,
  type ReaderProfile,
} from "../extract";
import { createDbReadingCache } from "../store";
import { loadManifest } from "./dataset";
import { PRIMARY_READER_ID, SECONDARY_READER_ID } from "./reader-ids";
import type { ReadingMode } from "./status";

export interface ReaderPair {
  primary: Reader;
  secondary: Reader;
}

export { PRIMARY_READER_ID, SECONDARY_READER_ID };
export type { ReaderProfile };

/**
 * `READER_PROFILE` = `economico` | `calidad` (por defecto `economico`; acepta «económico»).
 * Un valor desconocido cuenta como `economico`.
 */
export function readerProfile(env: Record<string, string | undefined> = process.env): ReaderProfile {
  return parseReaderProfile(env.READER_PROFILE);
}

/** Lo que identifica a un lector en vivo (y su clave de caché): id, modelo y versión de prompt. */
export interface LiveReaderSpec {
  id: string;
  model: string;
  promptVariant: PromptVariant;
  promptVersion: string;
}

/** Lectores en vivo de un perfil, con los ids de siempre («lector-a» y «lector-b»). */
export function liveReaderSpecs(profile: ReaderProfile = readerProfile()): { primary: LiveReaderSpec; secondary: LiveReaderSpec } {
  const spec = READER_PROFILES[profile];
  const make = (id: string, slot: { model: string; promptVariant: PromptVariant }): LiveReaderSpec => ({
    id,
    model: slot.model,
    promptVariant: slot.promptVariant,
    promptVersion: promptVersionOf(slot.promptVariant),
  });
  return { primary: make(PRIMARY_READER_ID, spec.primary), secondary: make(SECONDARY_READER_ID, spec.secondary) };
}

export interface LiveReadersOptions {
  /** Perfil de lectura. Si falta, el de `READER_PROFILE` (por defecto «economico»). */
  profile?: ReaderProfile;
  /** Caché de lecturas (clave = archivo + lector + modelo + versión de prompt). */
  cache: ReadingCache;
  /** Cliente compartido por los dos lectores. Si falta, cada lector crea uno con las credenciales del entorno. */
  client?: Anthropic;
  /** Si se indica, cada lectura que tarde más se corta como no disponible (ver `withReadTimeout`). */
  timeoutMs?: number;
}

/**
 * Los dos lectores en vivo de un perfil, cada uno envuelto con la caché. Lo usan la aplicación
 * (`getReaders`) y el banco de pruebas, así comparten lecturas guardadas. Esfuerzo «low»; Haiku 5.5
 * va sin reintento del servidor (Sonnet 5.5, en el perfil «calidad», lo conserva).
 */
export function createLiveReaders(opts: LiveReadersOptions): ReaderPair {
  const specs = liveReaderSpecs(opts.profile ?? readerProfile());
  const build = (spec: LiveReaderSpec): Reader => {
    const reader = createCachedReader(
      createAnthropicReader({ id: spec.id, model: spec.model, promptVariant: spec.promptVariant, effort: "low", client: opts.client }),
      opts.cache,
    );
    return opts.timeoutMs != null ? withReadTimeout(reader, opts.timeoutMs) : reader;
  };
  return { primary: build(specs.primary), secondary: build(specs.secondary) };
}

const byKey = new Map<string, ReaderPair>();

/** Lectores del modo pedido (se crean una vez por proceso, modo y perfil). */
export function getReaders(mode: ReadingMode, profile: ReaderProfile = readerProfile()): ReaderPair {
  const key = mode === "live" ? `live:${profile}` : mode;
  const existing = byKey.get(key);
  if (existing) return existing;
  const pair = mode === "live" ? liveReaders(profile) : simulatedReaders();
  byKey.set(key, pair);
  return pair;
}

/**
 * Tiempo máximo de una lectura en vivo (las dos van en paralelo). Las facturas se procesan de a una
 * con un candado: sin este tope, una llamada colgada (el SDK espera hasta 10 min y reintenta) dejaría
 * en fila todas las facturas siguientes. Queda por debajo del `maxDuration` de POST /api/invoices.
 */
export const LIVE_READ_TIMEOUT_MS = 45_000;

/**
 * Corta una lectura que tarda más de `ms`: devuelve un fallo «unavailable» (la factura escala por
 * LEC-1, nunca se paga sin lectura). La llamada de fondo no se cancela; si termina, la caché la guarda.
 */
export function withReadTimeout(inner: Reader, ms: number): Reader {
  return {
    id: inner.id,
    model: inner.model,
    promptVersion: inner.promptVersion,
    read(doc: NormalizedDoc): Promise<ReaderResult> {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<ReaderResult>((resolve) => {
        timer = setTimeout(
          () =>
            resolve({
              ok: false,
              readerId: inner.id,
              model: inner.model,
              promptVersion: inner.promptVersion,
              error: "unavailable",
              message: `La lectura tardó más de ${Math.round(ms / 1000)} s y se dejó de esperar. Vuelve a subir la factura más tarde.`,
            }),
          ms,
        );
      });
      return Promise.race([inner.read(doc), timeout]).finally(() => clearTimeout(timer));
    },
  };
}

function liveReaders(profile: ReaderProfile): ReaderPair {
  // Un intento más como máximo y cada intento acotado: la llamada de fondo tampoco queda colgada.
  const client = new Anthropic({ timeout: LIVE_READ_TIMEOUT_MS, maxRetries: 1 });
  return createLiveReaders({ profile, cache: createDbReadingCache(), client, timeoutMs: LIVE_READ_TIMEOUT_MS });
}

function simulatedReaders(): ReaderPair {
  const manifest = loadManifest();
  return {
    primary: createSimulatedReader({ id: PRIMARY_READER_ID, manifest }),
    secondary: createSimulatedReader({ id: SECONDARY_READER_ID, manifest }),
  };
}
