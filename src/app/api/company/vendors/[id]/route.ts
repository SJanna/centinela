/** DELETE /api/company/vendors/[id] — borra un proveedor. */
import { ensureCompany, withProcessingLock } from "@/pipeline";
import { deleteVendor } from "@/store";
import { json, jsonError, serverError } from "../../../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  try {
    const result = await withProcessingLock(async () => {
      await ensureCompany();
      const existed = await deleteVendor(id);
      return { existed, company: await ensureCompany() };
    });
    if (!result.existed) return jsonError(`No existe el proveedor «${id}».`, 404);
    return json({ company: result.company });
  } catch (err) {
    return serverError("No se pudo borrar el proveedor", err);
  }
}
