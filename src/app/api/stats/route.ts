/** GET /api/stats — cifras del registro para la fecha actual. */
import { ensureCompany } from "@/pipeline";
import { getStats } from "@/store";
import { json, serverError } from "../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    await ensureCompany();
    return json(await getStats(new Date().toISOString()));
  } catch (err) {
    return serverError("No se pudieron calcular las cifras", err);
  }
}
