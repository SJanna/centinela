/** GET /api/decisions/[id] — registro completo de una decisión. */
import { getDecision } from "@/store";
import { json, jsonError, serverError } from "../../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  try {
    const record = await getDecision(id);
    if (!record) return jsonError(`No existe la decisión «${id}».`, 404);
    return json({ record });
  } catch (err) {
    return serverError("No se pudo leer la decisión", err);
  }
}
