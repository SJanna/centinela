/** POST /api/demo/reset — borra facturas y decisiones y vuelve a cargar la empresa del dataset. */
import { resetDemo } from "@/pipeline";
import { json, serverError } from "../../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  try {
    return json({ company: await resetDemo() });
  } catch (err) {
    return serverError("No se pudo reiniciar la demostración", err);
  }
}
