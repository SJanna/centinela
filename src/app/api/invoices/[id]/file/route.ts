/** GET /api/invoices/[id]/file — bytes del archivo original, `Content-Disposition: inline`. */
import { getInvoiceFile } from "@/store";
import { fileResponse, jsonError, serverError } from "../../../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  try {
    const file = await getInvoiceFile(id);
    if (!file) return jsonError(`No existe la factura «${id}».`, 404);
    return fileResponse(file.bytes, file.filename, file.mediaType, "inline");
  } catch (err) {
    return serverError("No se pudo leer el archivo de la factura", err);
  }
}
