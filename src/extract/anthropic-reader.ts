/**
 * Lector con la API de Anthropic y salida estructurada (`output_config.format`).
 *
 * Usa `messages.create` + el `parse` del helper `zodOutputFormat` en vez de `messages.parse`:
 * `parse` interpreta el contenido dentro de la llamada y lanza si el texto es un JSON a medias,
 * así que una negativa a mitad de respuesta llegaría como error de parseo. Aquí se revisa
 * `stop_reason` ANTES de leer el contenido y después se valida con el mismo esquema zod.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { ExtractionSchema, type Extraction, type NormalizedDoc, type Reader, type ReaderResult } from "../core/schemas";
import { PROMPT_VERSION, buildReaderMessages } from "./prompt";

export const PRIMARY_MODEL = "claude-sonnet-5-5";
export const SECONDARY_MODEL = "claude-haiku-5-5";
export const DEFAULT_MAX_TOKENS = 8000;
/** Beta de reintento en el servidor con `fallbacks: "default"` (solo Sonnet 5.5). */
export const SERVER_FALLBACK_BETA = "server-side-fallback-2026-07-01";

export interface AnthropicReaderOptions {
  id: string;
  model: string;
  /** Cliente inyectable (pruebas). Si falta se crea al primer uso con las credenciales del entorno. */
  client?: Anthropic;
  effort?: "low" | "medium" | "high";
  /**
   * Reintento del servidor en otro modelo si el principal se niega (`fallbacks: "default"`).
   * Solo aplica a claude-sonnet-5-5; por defecto activado para ese modelo e ignorado para los demás.
   */
  serverFallback?: boolean;
  maxTokens?: number;
}

type ExtractionFormat = ReturnType<typeof zodOutputFormat<typeof ExtractionSchema>>;
let cachedFormat: ExtractionFormat | null = null;

/** Formato de salida estructurada para `Extraction` (se construye una sola vez). */
export function extractionOutputFormat(): ExtractionFormat {
  cachedFormat ??= zodOutputFormat(ExtractionSchema);
  return cachedFormat;
}

export function supportsServerFallback(model: string): boolean {
  return model === PRIMARY_MODEL || model.startsWith(`${PRIMARY_MODEL}-`);
}

type ModelResponse = Anthropic.Message | Anthropic.Beta.BetaMessage;

function firstText(blocks: ReadonlyArray<{ type: string }>): string | null {
  for (const block of blocks) {
    if (block.type === "text" && "text" in block && typeof block.text === "string") return block.text;
  }
  return null;
}

/** Mensaje en español para un error lanzado por el SDK (clases tipadas, sin mirar el texto). */
export function describeApiError(err: unknown, model: string): string {
  if (err instanceof Anthropic.AuthenticationError) {
    return "La API de Anthropic rechazó la credencial (401). Revisa ANTHROPIC_API_KEY.";
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return `La cuenta no tiene permiso para usar ${model} (403).`;
  }
  if (err instanceof Anthropic.NotFoundError) {
    return `El modelo ${model} no existe o no está disponible para esta cuenta (404).`;
  }
  if (err instanceof Anthropic.RateLimitError) {
    return "Se alcanzó el límite de uso de la API de Anthropic (429). Intenta de nuevo en unos minutos.";
  }
  if (err instanceof Anthropic.BadRequestError) {
    return `La API de Anthropic rechazó la petición (400): ${err.message}`;
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return "La API de Anthropic no respondió a tiempo.";
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return "No se pudo conectar con la API de Anthropic.";
  }
  if (err instanceof Anthropic.InternalServerError) {
    return `El servicio de Anthropic falló o está saturado (${err.status}). Intenta de nuevo.`;
  }
  if (err instanceof Anthropic.APIError) {
    return `Error de la API de Anthropic${err.status ? ` (${err.status})` : ""}: ${err.message}`;
  }
  if (err instanceof Anthropic.AnthropicError) {
    return `Error del cliente de Anthropic: ${err.message}`;
  }
  return `Error inesperado al llamar al modelo: ${err instanceof Error ? err.message : String(err)}`;
}

export function createAnthropicReader(opts: AnthropicReaderOptions): Reader {
  const effort = opts.effort ?? "low";
  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
  let client: Anthropic | null = opts.client ?? null;
  let useFallback = (opts.serverFallback ?? true) && supportsServerFallback(opts.model);

  const meta = { readerId: opts.id, model: opts.model, promptVersion: PROMPT_VERSION };
  const fail = (error: "refusal" | "api_error" | "parse_error", message: string): ReaderResult => ({
    ok: false,
    ...meta,
    error,
    message,
  });

  async function send(api: Anthropic, doc: NormalizedDoc): Promise<ModelResponse> {
    const { system, content } = buildReaderMessages(doc);
    const format = extractionOutputFormat();
    const params = {
      model: opts.model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user" as const, content }],
      output_config: { effort, format: { type: format.type, schema: format.schema } },
    };

    if (useFallback) {
      try {
        return await api.beta.messages.create({ ...params, betas: [SERVER_FALLBACK_BETA], fallbacks: "default" });
      } catch (err) {
        if (!(err instanceof Anthropic.BadRequestError)) throw err;
        // 400: o la cuenta no acepta la beta, o la petición tiene otro problema (p. ej. un PDF inválido).
        // Se reintenta sin la beta; solo si así funciona se deja de usar (era la beta). Si también
        // falla, el problema era este documento y la beta sigue activa para los siguientes.
        // Sin reintento del servidor, una negativa del modelo termina en ESCALAR, que es seguro.
        const response = await api.messages.create(params);
        useFallback = false;
        return response;
      }
    }
    return await api.messages.create(params);
  }

  return {
    id: opts.id,
    model: opts.model,
    promptVersion: PROMPT_VERSION,
    async read(doc: NormalizedDoc): Promise<ReaderResult> {
      let response: ModelResponse;
      try {
        client ??= new Anthropic();
        response = await send(client, doc);
      } catch (err) {
        return fail("api_error", describeApiError(err, opts.model));
      }

      // 1) La negativa se revisa antes de mirar el contenido.
      if (response.stop_reason === "refusal") {
        const details = response.stop_details;
        const category = details?.category ? ` (categoría: ${details.category})` : "";
        const explanation = details?.explanation ? ` ${details.explanation}` : "";
        return fail("refusal", `El modelo se negó a leer el documento${category}.${explanation}`);
      }
      if (response.stop_reason === "max_tokens") {
        return fail("parse_error", `La respuesta del modelo se cortó al llegar al máximo de ${maxTokens} tokens.`);
      }
      if (response.stop_reason === "model_context_window_exceeded") {
        return fail("parse_error", "El documento es demasiado largo para la ventana de contexto del modelo.");
      }

      // 2) Contenido: JSON que cumpla ExtractionSchema.
      const text = firstText(response.content);
      if (text == null || text.trim() === "") {
        return fail("parse_error", "La respuesta del modelo no trae contenido para leer.");
      }
      let extraction: Extraction;
      try {
        const parsed = ExtractionSchema.safeParse(extractionOutputFormat().parse(text));
        if (!parsed.success) {
          return fail("parse_error", `La respuesta del modelo no cumple el esquema: ${parsed.error.message}`);
        }
        extraction = parsed.data;
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        return fail("parse_error", `La respuesta del modelo no se pudo interpretar: ${detail}`);
      }

      return {
        ok: true,
        ...meta,
        extraction,
        usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
      };
    },
  };
}
