/**
 * Utilidades de los Route Handlers: errores JSON en español, lectura y validación de cuerpos,
 * y cabeceras seguras para servir archivos subidos.
 * Carpeta privada (`_lib`): no genera rutas.
 */
import { z } from "zod";

/** Sin caché en ninguna respuesta de la API. */
export const NO_STORE = { "Cache-Control": "no-store" } as const;

export function json<T>(body: T, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return Response.json(body, { status: init.status ?? 200, headers: { ...NO_STORE, ...init.headers } });
}

/** `{ error: "<mensaje en español>" }` con el código dado. */
export function jsonError(message: string, status: number): Response {
  return json({ error: message }, { status });
}

/** 500 con un mensaje en español; el detalle técnico va solo al registro del servidor. */
export function serverError(context: string, err: unknown): Response {
  console.error(`[api] ${context}:`, err);
  return jsonError(`${context}. Intenta de nuevo; si sigue fallando, revisa el registro del servidor.`, 500);
}

/** Lee el cuerpo JSON. Devuelve un Response 400 si no es JSON válido. */
export async function readJsonBody(request: Request): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  try {
    return { ok: true, value: await request.json() };
  } catch {
    return { ok: false, response: jsonError("El cuerpo de la petición debe ser JSON válido.", 400) };
  }
}

const spanishZodErrors = z.locales.es().localeError;

/** Valida con zod; si falla, Response 400 con los problemas en español (ruta: mensaje). */
export function validate<T>(
  schema: z.ZodType<T>,
  value: unknown,
  label: string,
): { ok: true; value: T } | { ok: false; response: Response } {
  const result = schema.safeParse(value, { error: spanishZodErrors });
  if (result.success) return { ok: true, value: result.data };
  const issues = result.error.issues;
  const shown = issues.slice(0, 5).map((i) => (i.path.length > 0 ? `${i.path.join(".")}: ${i.message}` : i.message));
  const more = issues.length > shown.length ? ` (y ${issues.length - shown.length} problema(s) más)` : "";
  return { ok: false, response: jsonError(`${label}: ${shown.join("; ")}${more}.`, 400) };
}

// ───────────────────────── Archivos ─────────────────────────

const INLINE_SAFE_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif"]);

/**
 * Content-Type con que se sirve un archivo subido. PDF e imágenes van tal cual; correo, chat,
 * HTML y cualquier texto se sirven como texto plano (un HTML subido nunca se ejecuta en el origen
 * de la aplicación); lo demás, como binario.
 */
export function safeContentType(mediaType: string): string {
  const mt = mediaType.split(";")[0].trim().toLowerCase();
  if (INLINE_SAFE_TYPES.has(mt)) return mt;
  if (mt.startsWith("text/") || mt === "message/rfc822") return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

/** `inline; filename="…"; filename*=UTF-8''…` (RFC 6266 / 5987). */
export function contentDisposition(type: "inline" | "attachment", filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_") || "archivo";
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** Respuesta con los bytes de un archivo, con cabeceras seguras y sin caché. */
export function fileResponse(bytes: Uint8Array, filename: string, mediaType: string, disposition: "inline" | "attachment" = "inline"): Response {
  const body = new Uint8Array(bytes.byteLength);
  body.set(bytes);
  return new Response(body, {
    status: 200,
    headers: {
      ...NO_STORE,
      "Content-Type": safeContentType(mediaType),
      "Content-Disposition": contentDisposition(disposition, filename),
      "Content-Length": String(bytes.byteLength),
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** `YYYY-MM-DD` de hoy (UTC), para nombres de descarga. */
export function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}
