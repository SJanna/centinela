/** GET /api/status — modo de lectura, modelos, versión del prompt, acceso y empresa. Público. */
import { getAppStatus } from "@/pipeline";
import { json, serverError } from "../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    return json(await getAppStatus());
  } catch (err) {
    return serverError("No se pudo leer el estado de la aplicación", err);
  }
}
