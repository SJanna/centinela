/**
 * POST /api/access — cuerpo `{ code }`. Si coincide con DEMO_ACCESS_CODE (comparación en tiempo
 * constante), pone la cookie `centinela_access` (sha256 del código) y responde `{ ok: true }`.
 * Público (el proxy no lo protege).
 */
import { ACCESS_COOKIE, ACCESS_COOKIE_MAX_AGE, configuredAccessCode, constantTimeEqual, sha256HexOf } from "@/pipeline/access";
import { json, jsonError, readJsonBody } from "../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CODE_LENGTH = 200;

export async function POST(request: Request): Promise<Response> {
  const code = configuredAccessCode();
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const value = body.value as { code?: unknown } | null;
  const given = value && typeof value === "object" && typeof value.code === "string" ? value.code.trim() : null;
  if (given == null || given.length > MAX_CODE_LENGTH) {
    return jsonError("Envía el código de acceso en el campo «code».", 400);
  }
  // Sin código configurado la demo está abierta: no hace falta cookie.
  if (code == null) return json({ ok: true });
  if (!(await constantTimeEqual(given, code))) {
    return jsonError("El código de acceso no es correcto.", 401);
  }
  const secure = process.env.NODE_ENV === "production" && new URL(request.url).protocol === "https:";
  const cookie = [
    `${ACCESS_COOKIE}=${await sha256HexOf(code)}`,
    "Path=/",
    `Max-Age=${ACCESS_COOKIE_MAX_AGE}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
  return json({ ok: true }, { headers: { "Set-Cookie": cookie } });
}
