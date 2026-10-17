/**
 * Caché de lecturas: repetir una evaluación no vuelve a llamar al modelo.
 * Clave = sha256 de (huella del archivo, lector, modelo, versión de prompt).
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { ExtractionSchema, type Extraction, type NormalizedDoc, type Reader, type ReaderResult } from "../core/schemas";
import type { ReadingCache } from "../core/ports";

/** sha256 hex de los cuatro componentes (serializados sin ambigüedad). */
export function readingCacheKey(fileHash: string, readerId: string, model: string, promptVersion: string): string {
  return createHash("sha256").update(JSON.stringify([fileHash, readerId, model, promptVersion])).digest("hex");
}

/**
 * Envuelve un lector con la caché. En acierto devuelve la lectura guardada sin llamar al lector
 * interno (el resultado no trae `usage`: no se gastaron tokens). Solo se guardan lecturas exitosas.
 * Si la caché falla, se comporta como un fallo de caché: nunca bloquea la lectura.
 */
export function createCachedReader(inner: Reader, cache: ReadingCache): Reader {
  return {
    id: inner.id,
    model: inner.model,
    promptVersion: inner.promptVersion,
    async read(doc: NormalizedDoc): Promise<ReaderResult> {
      const key = readingCacheKey(doc.fileHash, inner.id, inner.model, inner.promptVersion);

      let cached: Extraction | null = null;
      try {
        cached = await cache.get(key);
      } catch {
        cached = null;
      }
      if (cached) {
        const parsed = ExtractionSchema.safeParse(cached);
        if (parsed.success) {
          return {
            ok: true,
            readerId: inner.id,
            model: inner.model,
            promptVersion: inner.promptVersion,
            extraction: parsed.data,
          };
        }
      }

      const result = await inner.read(doc);
      if (result.ok) {
        try {
          await cache.set(key, result.extraction);
        } catch (err) {
          console.warn(`No se pudo guardar la lectura en caché: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      return result;
    },
  };
}

const SAFE_KEY = /^[A-Za-z0-9_-]{1,128}$/;

function fileNameFor(key: string): string {
  const safe = SAFE_KEY.test(key) ? key : createHash("sha256").update(key).digest("hex");
  return `${safe}.json`;
}

/** Caché en disco: un JSON por clave dentro de `dir` (se crea si falta). */
export function createFileReadingCache(dir: string): ReadingCache {
  return {
    async get(key: string): Promise<Extraction | null> {
      let raw: string;
      try {
        raw = await readFile(path.join(dir, fileNameFor(key)), "utf8");
      } catch {
        return null;
      }
      try {
        const parsed = ExtractionSchema.safeParse(JSON.parse(raw));
        return parsed.success ? parsed.data : null;
      } catch {
        return null;
      }
    },
    async set(key: string, value: Extraction): Promise<void> {
      await mkdir(dir, { recursive: true });
      const target = path.join(dir, fileNameFor(key));
      const tmp = `${target}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
      await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
      await rename(tmp, target);
    },
  };
}

/** Caché en memoria (pruebas y procesos de una sola corrida). */
export function createMemoryReadingCache(): ReadingCache & { size(): number } {
  const store = new Map<string, Extraction>();
  return {
    async get(key) {
      const value = store.get(key);
      return value ? structuredClone(value) : null;
    },
    async set(key, value) {
      store.set(key, structuredClone(value));
    },
    size: () => store.size,
  };
}
