/**
 * GET /api/invoices/[id]/preview — vuelve a normalizar el archivo guardado y devuelve lo que se
 * puede mostrar sin el modelo: tipo, texto plano y metadatos.
 */
import type { DocKind } from "@/core/schemas";
import { IngestError, normalizeFile } from "@/ingest";
import { getInvoiceFile } from "@/store";
import { json, jsonError, serverError } from "../../../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface InvoicePreview {
  kind: DocKind;
  mediaType: string;
  filename: string;
  plainText: string | null;
  meta: Record<string, string>;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  try {
    const file = await getInvoiceFile(id);
    if (!file) return jsonError(`No existe la factura «${id}».`, 404);
    const doc = await normalizeFile(file.bytes, file.filename, file.mediaType);
    const preview: InvoicePreview = {
      kind: doc.kind,
      mediaType: doc.mediaType,
      filename: doc.filename,
      plainText: doc.plainText,
      meta: doc.meta,
    };
    return json(preview);
  } catch (err) {
    if (err instanceof IngestError) return jsonError(err.message, 422);
    return serverError("No se pudo preparar la vista previa de la factura", err);
  }
}
