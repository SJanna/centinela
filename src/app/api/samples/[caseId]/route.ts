/** GET /api/samples/[caseId] — bytes del archivo de ejemplo de un caso. */
import { readSample } from "@/pipeline";
import { fileResponse, jsonError, serverError } from "../../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ caseId: string }> }): Promise<Response> {
  const { caseId } = await params;
  try {
    const sample = await readSample(caseId);
    if (!sample) return jsonError(`No existe la factura de ejemplo «${caseId}».`, 404);
    return fileResponse(sample.bytes, sample.filename, sample.mediaType, "inline");
  } catch (err) {
    return serverError("No se pudo leer la factura de ejemplo", err);
  }
}
