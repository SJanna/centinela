/**
 * Lectores de la aplicación según el modo de lectura.
 *
 * - live: Sonnet 5.5 («lector-a») y Haiku 5.5 («lector-b»), cada uno con la caché de la base.
 * - simulated: lectura «perfecta» de dataset/generated/manifest.json para los dos lectores.
 *   Cualquier archivo que no esté en el manifiesto no tiene lectura y escala por LEC-1.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { NormalizedDoc, Reader, ReaderResult } from "../core/schemas";
import {
  createAnthropicReader,
  createCachedReader,
  createSimulatedReader,
  PRIMARY_MODEL,
  SECONDARY_MODEL,
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

const byMode: Partial<Record<ReadingMode, ReaderPair>> = {};

/** Lectores del modo pedido (se crean una vez por proceso y modo). */
export function getReaders(mode: ReadingMode): ReaderPair {
  const existing = byMode[mode];
  if (existing) return existing;
  const pair = mode === "live" ? liveReaders() : simulatedReaders();
  byMode[mode] = pair;
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

function liveReaders(): ReaderPair {
  const cache = createDbReadingCache();
  // Un intento más como máximo y cada intento acotado: la llamada de fondo tampoco queda colgada.
  const client = new Anthropic({ timeout: LIVE_READ_TIMEOUT_MS, maxRetries: 1 });
  const live = (id: string, model: string) =>
    withReadTimeout(createCachedReader(createAnthropicReader({ id, model, client }), cache), LIVE_READ_TIMEOUT_MS);
  return {
    primary: live(PRIMARY_READER_ID, PRIMARY_MODEL),
    secondary: live(SECONDARY_READER_ID, SECONDARY_MODEL),
  };
}

function simulatedReaders(): ReaderPair {
  const manifest = loadManifest();
  return {
    primary: createSimulatedReader({ id: PRIMARY_READER_ID, manifest }),
    secondary: createSimulatedReader({ id: SECONDARY_READER_ID, manifest }),
  };
}
