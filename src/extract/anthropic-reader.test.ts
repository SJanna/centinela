import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { describe, expect, it, vi } from "vitest";
import { ExtractionSchema } from "../core/schemas";
import {
  DEFAULT_MAX_TOKENS,
  SERVER_FALLBACK_BETA,
  createAnthropicReader,
  extractionOutputFormat,
  supportsServerFallback,
} from "./anthropic-reader";
import { PROMPT_VERSION, PROMPT_VERSION_B, READER_SYSTEM_PROMPT, READER_SYSTEM_PROMPT_B } from "./prompt";
import { makeDoc, makeExtraction } from "./test-utils";
import { extractionToWire } from "./wire";

interface FakeResponse {
  stop_reason: string | null;
  stop_details?: { category: string | null; explanation: string | null; type: "refusal" } | null;
  content: Array<{ type: string; text?: string }>;
  usage: { input_tokens: number; output_tokens: number };
}

function response(overrides: Partial<FakeResponse> = {}): FakeResponse {
  return {
    stop_reason: "end_turn",
    stop_details: null,
    content: [{ type: "text", text: JSON.stringify(extractionToWire(makeExtraction())) }],
    usage: { input_tokens: 1234, output_tokens: 567 },
    ...overrides,
  };
}

function fakeClient(opts: {
  create?: (params: Record<string, unknown>) => Promise<FakeResponse>;
  betaCreate?: (params: Record<string, unknown>) => Promise<FakeResponse>;
}) {
  const create = vi.fn(opts.create ?? (async () => response()));
  const betaCreate = vi.fn(opts.betaCreate ?? (async () => response()));
  const client = { messages: { create }, beta: { messages: { create: betaCreate } } } as unknown as Anthropic;
  return { client, create, betaCreate };
}

const HEADERS = new Headers();

describe("formato de salida estructurada", () => {
  it("se construye sin error y el helper acepta el esquema de cable", () => {
    expect(() => zodOutputFormat(ExtractionSchema)).not.toThrow();
    const format = extractionOutputFormat();
    expect(format.type).toBe("json_schema");
    expect(format.schema).toMatchObject({ type: "object" });
    const sample = extractionToWire(makeExtraction());
    expect(format.parse(JSON.stringify(sample))).toEqual(sample);
    expect(() => format.parse('{"documentType":"invoice"}')).toThrow();
  });
});

describe("createAnthropicReader", () => {
  it("devuelve la lectura y el uso de tokens (Haiku: llamada normal, sin beta)", async () => {
    const { client, create, betaCreate } = fakeClient({});
    const reader = createAnthropicReader({ id: "segunda", model: "claude-haiku-5-5", client });
    expect(reader).toMatchObject({ id: "segunda", model: "claude-haiku-5-5", promptVersion: PROMPT_VERSION });

    const result = await reader.read(makeDoc());
    expect(result).toEqual({
      ok: true,
      readerId: "segunda",
      model: "claude-haiku-5-5",
      promptVersion: PROMPT_VERSION,
      extraction: makeExtraction(),
      usage: { inputTokens: 1234, outputTokens: 567 },
    });
    expect(betaCreate).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(1);

    const params = create.mock.calls[0][0];
    expect(params.model).toBe("claude-haiku-5-5");
    expect(params.max_tokens).toBe(DEFAULT_MAX_TOKENS);
    expect(params).not.toHaveProperty("temperature");
    expect(params).not.toHaveProperty("thinking");
    expect(params).not.toHaveProperty("fallbacks");
    expect(params.output_config).toMatchObject({ effort: "low", format: { type: "json_schema" } });
    expect(typeof params.system).toBe("string");
    expect(params.messages).toHaveLength(1);
  });

  it("prompt «b»: manda su propio prompt y declara su versión (Haiku 5.5: esfuerzo low, sin thinking, temperature ni fallbacks)", async () => {
    const { client, create, betaCreate } = fakeClient({});
    const reader = createAnthropicReader({ id: "lector-b", model: "claude-haiku-5-5", client, promptVariant: "b" });
    expect(reader).toMatchObject({ id: "lector-b", model: "claude-haiku-5-5", promptVersion: PROMPT_VERSION_B });

    const result = await reader.read(makeDoc());
    expect(result).toMatchObject({ ok: true, readerId: "lector-b", model: "claude-haiku-5-5", promptVersion: PROMPT_VERSION_B });
    expect(betaCreate).not.toHaveBeenCalled();
    const params = create.mock.calls[0][0];
    expect(params.system).toBe(READER_SYSTEM_PROMPT_B);
    expect(params.output_config).toMatchObject({ effort: "low", format: { type: "json_schema" } });
    expect(params.output_config).toEqual({ effort: "low", format: expect.objectContaining({ schema: extractionOutputFormat().schema }) });
    for (const key of ["temperature", "top_p", "top_k", "thinking", "fallbacks", "betas"]) expect(params).not.toHaveProperty(key);
  });

  it("sin variante usa el prompt «a»", async () => {
    const { client, create } = fakeClient({});
    const reader = createAnthropicReader({ id: "lector-a", model: "claude-haiku-5-5", client });
    expect(reader.promptVersion).toBe(PROMPT_VERSION);
    await reader.read(makeDoc());
    expect(create.mock.calls[0][0].system).toBe(READER_SYSTEM_PROMPT);
  });

  it("Sonnet 5.5 usa el reintento del servidor (beta + fallbacks: default)", async () => {
    const { client, create, betaCreate } = fakeClient({});
    const reader = createAnthropicReader({ id: "principal", model: "claude-sonnet-5-5", client });
    const result = await reader.read(makeDoc());
    expect(result.ok).toBe(true);
    expect(create).not.toHaveBeenCalled();
    const params = betaCreate.mock.calls[0][0];
    expect(params.betas).toEqual([SERVER_FALLBACK_BETA]);
    expect(params.fallbacks).toBe("default");
    expect(params.output_config).toMatchObject({ effort: "low" });
  });

  it("si la API rechaza la beta (400) reintenta sin ella y no vuelve a usarla", async () => {
    const { client, create, betaCreate } = fakeClient({
      betaCreate: async () => {
        throw new Anthropic.BadRequestError(400, { type: "error" }, "Unexpected value(s) for the anthropic-beta header", HEADERS);
      },
    });
    const reader = createAnthropicReader({ id: "principal", model: "claude-sonnet-5-5", client });
    expect((await reader.read(makeDoc())).ok).toBe(true);
    expect((await reader.read(makeDoc())).ok).toBe(true);
    expect(betaCreate).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][0]).not.toHaveProperty("fallbacks");
  });

  it("serverFallback: false desactiva la beta incluso con Sonnet 5.5; effort configurable", async () => {
    const { client, create, betaCreate } = fakeClient({});
    const reader = createAnthropicReader({ id: "p", model: "claude-sonnet-5-5", client, serverFallback: false, effort: "medium" });
    await reader.read(makeDoc());
    expect(betaCreate).not.toHaveBeenCalled();
    expect(create.mock.calls[0][0].output_config).toMatchObject({ effort: "medium" });
    expect(supportsServerFallback("claude-haiku-5-5")).toBe(false);
  });

  it("stop_reason refusal → error refusal, aunque el contenido sea un JSON a medias", async () => {
    const { client } = fakeClient({
      create: async () =>
        response({
          stop_reason: "refusal",
          stop_details: { category: "general_harms", explanation: null, type: "refusal" },
          content: [{ type: "text", text: '{"documentType":"inv' }],
        }),
    });
    const result = await createAnthropicReader({ id: "s", model: "claude-haiku-5-5", client }).read(makeDoc());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("refusal");
    expect(result.message).toContain("general_harms");
  });

  it("errores tipados del SDK → api_error con mensaje en español", async () => {
    const cases: Array<[unknown, string]> = [
      [new Anthropic.RateLimitError(429, { type: "error" }, "rate", HEADERS), "límite de uso"],
      [new Anthropic.AuthenticationError(401, { type: "error" }, "auth", HEADERS), "ANTHROPIC_API_KEY"],
      [new Anthropic.NotFoundError(404, { type: "error" }, "nf", HEADERS), "no existe"],
      [new Anthropic.InternalServerError(529, { type: "error" }, "over", HEADERS), "529"],
      [new Anthropic.APIConnectionError({ message: "down" }), "No se pudo conectar"],
      [new Error("boom"), "boom"],
    ];
    for (const [error, fragment] of cases) {
      const { client } = fakeClient({
        create: async () => {
          throw error;
        },
      });
      const result = await createAnthropicReader({ id: "s", model: "claude-haiku-5-5", client }).read(makeDoc());
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error).toBe("api_error");
      expect(result.message).toContain(fragment);
    }
  });

  it("parse_error si el contenido no es JSON, no cumple el esquema, viene vacío o se cortó", async () => {
    const bad: FakeResponse[] = [
      response({ content: [{ type: "text", text: "no es json" }] }),
      response({ content: [{ type: "text", text: JSON.stringify({ ...makeExtraction(), total: { value: "mil" } }) }] }),
      response({ content: [] }),
      response({ stop_reason: "max_tokens", content: [{ type: "text", text: '{"documentType":' }] }),
    ];
    for (const r of bad) {
      const { client } = fakeClient({ create: async () => r });
      const result = await createAnthropicReader({ id: "s", model: "claude-haiku-5-5", client }).read(makeDoc());
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error).toBe("parse_error");
      expect(result.message.length).toBeGreaterThan(0);
    }
  });

  it("ignora bloques que no son de texto antes del JSON", async () => {
    const { client } = fakeClient({
      create: async () =>
        response({ content: [{ type: "thinking" }, { type: "text", text: JSON.stringify(extractionToWire(makeExtraction())) }] }),
    });
    const result = await createAnthropicReader({ id: "s", model: "claude-haiku-5-5", client }).read(makeDoc());
    expect(result.ok).toBe(true);
  });
});

describe("revisión · reintento sin la beta", () => {
  it("un 400 por un documento inválido no apaga la beta para las lecturas siguientes", async () => {
    let plainCalls = 0;
    const { client, betaCreate } = fakeClient({
      betaCreate: async () => {
        throw new Anthropic.BadRequestError(400, { type: "error" }, "Could not process PDF", HEADERS);
      },
      create: async () => {
        plainCalls += 1;
        throw new Anthropic.BadRequestError(400, { type: "error" }, "Could not process PDF", HEADERS);
      },
    });
    const reader = createAnthropicReader({ id: "principal", model: "claude-sonnet-5-5", client });
    const first = await reader.read(makeDoc());
    expect(first).toMatchObject({ ok: false, error: "api_error" });
    await reader.read(makeDoc());
    // El problema era el documento, no la beta: la segunda lectura vuelve a pedir el reintento del servidor.
    expect(betaCreate).toHaveBeenCalledTimes(2);
    expect(plainCalls).toBe(2);
  });
});
