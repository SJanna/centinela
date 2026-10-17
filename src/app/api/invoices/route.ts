/**
 * POST /api/invoices — multipart/form-data con el campo `file`.
 * Procesa la factura en el momento (de a una por proceso) y devuelve la decisión.
 */
import { IngestError } from "@/ingest";
import { formatBytes } from "@/ingest/limits";
import { processInvoice } from "@/pipeline";
import { toDecisionSummary } from "@/store";
import { jsonError, json, serverError } from "../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** La lectura con modelos puede tardar (dos lecturas en paralelo, más la cola de facturas). */
export const maxDuration = 60;

/** Máximo del archivo subido (límite del cuerpo de las funciones de Vercel: 4,5 MB). */
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
/** Margen para las cabeceras multipart al revisar Content-Length antes de leer el cuerpo. */
const MULTIPART_OVERHEAD = 64 * 1024;

function tooLarge(name: string | null, size: number | null): Response {
  const what = name ? `El archivo «${name}»` : "El archivo";
  const weight = size != null ? ` pesa ${formatBytes(size)} y` : "";
  return jsonError(`${what}${weight} supera el máximo de ${formatBytes(MAX_UPLOAD_BYTES)} por factura.`, 413);
}

function ingestStatus(err: IngestError): number {
  if (err.code === "too_large") return 413;
  if (err.code === "unsupported") return 415;
  return 422;
}

export async function POST(request: Request): Promise<Response> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD) {
    return tooLarge(null, null);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError("La petición debe ser multipart/form-data con el archivo en el campo «file».", 400);
  }

  const file = form.get("file");
  if (file == null) return jsonError("Falta el archivo: envíalo en el campo «file».", 400);
  if (typeof file === "string") return jsonError("El campo «file» debe ser un archivo, no un texto.", 400);
  if (file.size > MAX_UPLOAD_BYTES) return tooLarge(file.name, file.size);

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const record = await processInvoice({ bytes, filename: file.name || "archivo", mediaType: file.type || undefined });
    return json({ decision: toDecisionSummary(record), recordId: record.id });
  } catch (err) {
    if (err instanceof IngestError) return jsonError(err.message, ingestStatus(err));
    return serverError("No se pudo procesar la factura", err);
  }
}
