/** GET /api/samples — facturas de ejemplo del dataset (casos.csv + manifiesto). */
import { listSamples } from "@/pipeline";
import { json, serverError } from "../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    return json({ samples: listSamples() });
  } catch (err) {
    return serverError("No se pudieron listar las facturas de ejemplo", err);
  }
}
