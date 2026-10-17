import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReadingCache } from "../core/ports";
import { createCachedReader, createFileReadingCache, createMemoryReadingCache, readingCacheKey } from "./cache";
import { failResult, fakeReader, makeDoc, makeExtraction, okResult } from "./test-utils";

describe("readingCacheKey", () => {
  it("es sha256 hex, determinista y cambia con cada componente", () => {
    const k = readingCacheKey("hash", "principal", "claude-sonnet-5-5", "v1");
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(readingCacheKey("hash", "principal", "claude-sonnet-5-5", "v1")).toBe(k);
    expect(readingCacheKey("hash2", "principal", "claude-sonnet-5-5", "v1")).not.toBe(k);
    expect(readingCacheKey("hash", "segunda", "claude-sonnet-5-5", "v1")).not.toBe(k);
    expect(readingCacheKey("hash", "principal", "claude-haiku-5-5", "v1")).not.toBe(k);
    expect(readingCacheKey("hash", "principal", "claude-sonnet-5-5", "v2")).not.toBe(k);
    // Sin ambigüedad al concatenar.
    expect(readingCacheKey("ab", "c", "m", "v")).not.toBe(readingCacheKey("a", "bc", "m", "v"));
  });
});

describe("createCachedReader", () => {
  it("en fallo de caché llama al lector y guarda; en acierto no lo llama", async () => {
    const inner = fakeReader(okResult(makeExtraction(), "principal", "modelo-a"), "principal", "modelo-a");
    const cache = createMemoryReadingCache();
    const reader = createCachedReader(inner, cache);
    expect(reader).toMatchObject({ id: "principal", model: "modelo-a", promptVersion: "v1" });

    const first = await reader.read(makeDoc());
    expect(first.ok).toBe(true);
    expect(inner.calls).toBe(1);
    expect(cache.size()).toBe(1);

    const second = await reader.read(makeDoc());
    expect(inner.calls).toBe(1);
    expect(second).toEqual({
      ok: true,
      readerId: "principal",
      model: "modelo-a",
      promptVersion: "v1",
      extraction: makeExtraction(),
    });

    // Otro archivo: otra clave.
    await reader.read(makeDoc({ fileHash: "b".repeat(64) }));
    expect(inner.calls).toBe(2);
  });

  it("no guarda lecturas fallidas", async () => {
    const inner = fakeReader(failResult("refusal"));
    const cache = createMemoryReadingCache();
    const reader = createCachedReader(inner, cache);
    expect((await reader.read(makeDoc())).ok).toBe(false);
    expect((await reader.read(makeDoc())).ok).toBe(false);
    expect(inner.calls).toBe(2);
    expect(cache.size()).toBe(0);
  });

  it("si la caché falla, lee igual", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const broken: ReadingCache = {
      get: async () => {
        throw new Error("disco roto");
      },
      set: async () => {
        throw new Error("solo lectura");
      },
    };
    const inner = fakeReader(okResult(makeExtraction()));
    const result = await createCachedReader(inner, broken).read(makeDoc());
    expect(result.ok).toBe(true);
    expect(inner.calls).toBe(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("createFileReadingCache", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  async function tempDir(): Promise<string> {
    const d = await mkdtemp(path.join(os.tmpdir(), "centinela-cache-"));
    dirs.push(d);
    return d;
  }

  it("crea el directorio si falta y guarda un JSON por clave", async () => {
    const base = await tempDir();
    const dir = path.join(base, "anidado", "lecturas");
    const cache = createFileReadingCache(dir);
    const key = readingCacheKey("h", "r", "m", "v1");

    expect(await cache.get(key)).toBeNull();
    await cache.set(key, makeExtraction());
    expect(await cache.get(key)).toEqual(makeExtraction());
    expect(await readdir(dir)).toEqual([`${key}.json`]);

    // Otra instancia sobre el mismo directorio ve lo guardado.
    expect(await createFileReadingCache(dir).get(key)).toEqual(makeExtraction());
  });

  it("un archivo corrupto o que no cumple el esquema cuenta como fallo de caché", async () => {
    const dir = await tempDir();
    const cache = createFileReadingCache(dir);
    await writeFile(path.join(dir, "roto.json"), "{no json");
    await writeFile(path.join(dir, "otro.json"), JSON.stringify({ documentType: "invoice" }));
    expect(await cache.get("roto")).toBeNull();
    expect(await cache.get("otro")).toBeNull();
  });

  it("no escribe fuera del directorio con claves raras", async () => {
    const dir = await tempDir();
    const cache = createFileReadingCache(dir);
    await cache.set("../../fuera", makeExtraction());
    const files = await readdir(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[0-9a-f]{64}\.json$/);
    expect(await cache.get("../../fuera")).toEqual(makeExtraction());
  });

  it("funciona con el lector en caché de punta a punta", async () => {
    const dir = await tempDir();
    const inner = fakeReader(okResult(makeExtraction()));
    const reader = createCachedReader(inner, createFileReadingCache(dir));
    await reader.read(makeDoc());
    const again = createCachedReader(inner, createFileReadingCache(dir));
    const result = await again.read(makeDoc());
    expect(result.ok).toBe(true);
    expect(inner.calls).toBe(1);
  });
});
