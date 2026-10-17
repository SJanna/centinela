/**
 * Lectores de la aplicación: tiempo máximo de una lectura en vivo (el candado de procesamiento no
 * puede quedar tomado por una llamada colgada) y los ids que forman la clave de caché.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NormalizedDoc, Reader, ReaderResult } from "../core/schemas";
import {
  createMemoryReadingCache,
  PROMPT_VERSION,
  PROMPT_VERSION_B,
  READER_SYSTEM_PROMPT,
  READER_SYSTEM_PROMPT_B,
  readingCacheKey,
} from "../extract";
import { makeExtraction } from "../extract/test-utils";
import { extractionToWire } from "../extract/wire";
import { maxDuration } from "../app/api/invoices/route";
import {
  createLiveReaders,
  getReaders,
  LIVE_READ_TIMEOUT_MS,
  liveReaderSpecs,
  readerProfile,
  withReadTimeout,
  type ReaderProfile,
} from "./readers";

const doc: NormalizedDoc = {
  fileHash: "a".repeat(64),
  filename: "f.txt",
  mediaType: "text/plain",
  kind: "text",
  parts: [{ type: "text", text: "Factura 1" }],
  plainText: "Factura 1",
  meta: {},
};

function fakeReader(read: () => Promise<ReaderResult>): Reader {
  return { id: "lector-a", model: "modelo-x", promptVersion: "v9", read };
}

describe("withReadTimeout", () => {
  it("una lectura que no termina se corta como no disponible (y escala)", async () => {
    const started = Date.now();
    const result = await withReadTimeout(fakeReader(() => new Promise<ReaderResult>(() => undefined)), 30).read(doc);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(result).toMatchObject({ ok: false, error: "unavailable", readerId: "lector-a", model: "modelo-x", promptVersion: "v9" });
    expect(!result.ok && result.message).toMatch(/^La lectura tardó más de /);
  });

  it("una lectura a tiempo pasa tal cual", async () => {
    const ok: ReaderResult = { ok: false, readerId: "lector-a", model: "modelo-x", promptVersion: "v9", error: "refusal", message: "no" };
    const reader = withReadTimeout(fakeReader(async () => ok), 1000);
    expect(await reader.read(doc)).toBe(ok);
    expect({ id: reader.id, model: reader.model, promptVersion: reader.promptVersion }).toEqual({
      id: "lector-a",
      model: "modelo-x",
      promptVersion: "v9",
    });
  });

  it("un error del lector se propaga (lo convierte en fallo la verificación de lecturas)", async () => {
    const reader = withReadTimeout(fakeReader(async () => Promise.reject(new Error("x"))), 1000);
    await expect(reader.read(doc)).rejects.toThrow("x");
  });
});

/** Cliente falso: registra las peticiones y responde una lectura válida. */
function fakeClient() {
  const reply = async () => ({
    stop_reason: "end_turn",
    stop_details: null,
    content: [{ type: "text", text: JSON.stringify(extractionToWire(makeExtraction())) }],
    usage: { input_tokens: 100, output_tokens: 50 },
  });
  const create = vi.fn(async (params: Record<string, unknown>) => {
    void params;
    return reply();
  });
  const betaCreate = vi.fn(async (params: Record<string, unknown>) => {
    void params;
    return reply();
  });
  const client = { messages: { create }, beta: { messages: { create: betaCreate } } } as unknown as Anthropic;
  return { client, create, betaCreate };
}

const ids = (pair: { primary: Reader; secondary: Reader }) =>
  [pair.primary, pair.secondary].map((r) => ({ id: r.id, model: r.model, promptVersion: r.promptVersion }));

describe("readerProfile", () => {
  it("READER_PROFILE: económico por defecto; calidad si se pide", () => {
    expect(readerProfile({})).toBe("economico");
    expect(readerProfile({ READER_PROFILE: "calidad" })).toBe("calidad");
    expect(readerProfile({ READER_PROFILE: "económico" })).toBe("economico");
    expect(readerProfile({ READER_PROFILE: "otro" })).toBe("economico");
  });
});

describe("createLiveReaders", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("económico: Haiku 5.5 con el prompt «a» y Haiku 5.5 con el prompt «b», con los ids de siempre", () => {
    const pair = createLiveReaders({ profile: "economico", cache: createMemoryReadingCache(), client: fakeClient().client });
    expect(ids(pair)).toEqual([
      { id: "lector-a", model: "claude-haiku-5-5", promptVersion: PROMPT_VERSION },
      { id: "lector-b", model: "claude-haiku-5-5", promptVersion: PROMPT_VERSION_B },
    ]);
  });

  it("calidad: Sonnet 5.5 + Haiku 5.5, los dos con el prompt «a» (comportamiento anterior)", () => {
    const pair = createLiveReaders({ profile: "calidad", cache: createMemoryReadingCache(), client: fakeClient().client });
    expect(ids(pair)).toEqual([
      { id: "lector-a", model: "claude-sonnet-5-5", promptVersion: PROMPT_VERSION },
      { id: "lector-b", model: "claude-haiku-5-5", promptVersion: PROMPT_VERSION },
    ]);
  });

  it("sin perfil usa READER_PROFILE (por defecto económico)", () => {
    const cache = createMemoryReadingCache();
    vi.stubEnv("READER_PROFILE", "");
    expect(createLiveReaders({ cache }).primary.model).toBe("claude-haiku-5-5");
    vi.stubEnv("READER_PROFILE", "calidad");
    expect(createLiveReaders({ cache }).primary.model).toBe("claude-sonnet-5-5");
  });

  it("liveReaderSpecs coincide con los lectores creados", () => {
    for (const profile of ["economico", "calidad"] as ReaderProfile[]) {
      const specs = liveReaderSpecs(profile);
      const pair = createLiveReaders({ profile, cache: createMemoryReadingCache() });
      expect(ids(pair)).toEqual([specs.primary, specs.secondary].map(({ id, model, promptVersion }) => ({ id, model, promptVersion })));
    }
  });

  it("económico: cada lectura manda su prompt; Haiku va con esfuerzo low, sin thinking, temperature ni fallbacks", async () => {
    const { client, create, betaCreate } = fakeClient();
    const pair = createLiveReaders({ profile: "economico", cache: createMemoryReadingCache(), client });
    const [a, b] = await Promise.all([pair.primary.read(doc), pair.secondary.read(doc)]);
    expect(a).toMatchObject({ ok: true, readerId: "lector-a", promptVersion: PROMPT_VERSION });
    expect(b).toMatchObject({ ok: true, readerId: "lector-b", promptVersion: PROMPT_VERSION_B });
    expect(betaCreate).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(2);
    const systems = create.mock.calls.map(([params]) => params.system);
    expect(new Set(systems)).toEqual(new Set([READER_SYSTEM_PROMPT, READER_SYSTEM_PROMPT_B]));
    for (const [params] of create.mock.calls) {
      expect(params.model).toBe("claude-haiku-5-5");
      expect(params.output_config).toMatchObject({ effort: "low" });
      for (const key of ["temperature", "top_p", "top_k", "thinking", "fallbacks", "betas"]) expect(params).not.toHaveProperty(key);
    }
  });

  it("calidad: Sonnet 5.5 conserva el reintento del servidor; Haiku no", async () => {
    const { client, create, betaCreate } = fakeClient();
    const pair = createLiveReaders({ profile: "calidad", cache: createMemoryReadingCache(), client });
    await Promise.all([pair.primary.read(doc), pair.secondary.read(doc)]);
    expect(betaCreate).toHaveBeenCalledTimes(1);
    expect(betaCreate.mock.calls[0][0]).toMatchObject({ model: "claude-sonnet-5-5", fallbacks: "default" });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].model).toBe("claude-haiku-5-5");
    expect(create.mock.calls[0][0]).not.toHaveProperty("fallbacks");
  });

  it("las claves de caché de las lecturas A y B difieren (también con el mismo id y modelo)", async () => {
    const cache = createMemoryReadingCache();
    const { client, create } = fakeClient();
    const pair = createLiveReaders({ profile: "economico", cache, client });
    await pair.primary.read(doc);
    await pair.secondary.read(doc);
    expect(cache.size()).toBe(2);

    const keyA = readingCacheKey(doc.fileHash, "lector-a", "claude-haiku-5-5", PROMPT_VERSION);
    const keyB = readingCacheKey(doc.fileHash, "lector-b", "claude-haiku-5-5", PROMPT_VERSION_B);
    expect(keyA).not.toBe(keyB);
    expect(await cache.get(keyA)).not.toBeNull();
    expect(await cache.get(keyB)).not.toBeNull();
    // Mismo lector y modelo, otro prompt: otra clave (una lectura con el prompt «a» no sirve para el «b»).
    expect(readingCacheKey(doc.fileHash, "lector-b", "claude-haiku-5-5", PROMPT_VERSION)).not.toBe(keyB);

    // Segunda vez: las dos salen de la caché, sin llamar a la API.
    const again = createLiveReaders({ profile: "economico", cache, client });
    await again.primary.read(doc);
    await again.secondary.read(doc);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("calidad conserva las claves de antes (reutiliza las lecturas ya guardadas)", async () => {
    const cache = createMemoryReadingCache();
    await cache.set(readingCacheKey(doc.fileHash, "lector-a", "claude-sonnet-5-5", "v3"), makeExtraction());
    await cache.set(readingCacheKey(doc.fileHash, "lector-b", "claude-haiku-5-5", "v3"), makeExtraction());
    const { client, create, betaCreate } = fakeClient();
    const pair = createLiveReaders({ profile: "calidad", cache, client });
    expect((await pair.primary.read(doc)).ok).toBe(true);
    expect((await pair.secondary.read(doc)).ok).toBe(true);
    expect(create).not.toHaveBeenCalled();
    expect(betaCreate).not.toHaveBeenCalled();
  });

  it("timeoutMs corta una lectura colgada como no disponible", async () => {
    const hanging = { messages: { create: () => new Promise(() => undefined) }, beta: { messages: { create: () => new Promise(() => undefined) } } } as unknown as Anthropic;
    const pair = createLiveReaders({ profile: "economico", cache: createMemoryReadingCache(), client: hanging, timeoutMs: 30 });
    expect(await pair.secondary.read(doc)).toMatchObject({ ok: false, error: "unavailable", readerId: "lector-b", promptVersion: PROMPT_VERSION_B });
  });
});

describe("getReaders", () => {
  it("live: mismos ids, modelos y versiones de prompt que createLiveReaders (y que el banco de pruebas)", () => {
    for (const profile of ["economico", "calidad"] as ReaderProfile[]) {
      const pair = getReaders("live", profile);
      const specs = liveReaderSpecs(profile);
      expect(ids(pair)).toEqual([specs.primary, specs.secondary].map(({ id, model, promptVersion }) => ({ id, model, promptVersion })));
      expect(getReaders("live", profile)).toBe(pair);
    }
    expect(getReaders("live", "economico")).not.toBe(getReaders("live", "calidad"));
  });

  it("el tiempo máximo de lectura deja margen dentro del maxDuration de POST /api/invoices", () => {
    expect(LIVE_READ_TIMEOUT_MS).toBeGreaterThan(0);
    expect(LIVE_READ_TIMEOUT_MS).toBeLessThan(maxDuration * 1000 - 5000);
  });
});
