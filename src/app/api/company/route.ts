/** GET /api/company — empresa activa (reglas y proveedores). */
import { ensureCompany } from "@/pipeline";
import { json, serverError } from "../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    return json({ company: await ensureCompany() });
  } catch (err) {
    return serverError("No se pudo leer la empresa", err);
  }
}
