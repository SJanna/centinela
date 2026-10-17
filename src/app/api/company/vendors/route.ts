/**
 * PUT  /api/company/vendors — reemplaza todos los proveedores (importación). Cuerpo: Vendor[].
 * POST /api/company/vendors — crea o actualiza un proveedor. Cuerpo: Vendor.
 */
import { ensureCompany, withProcessingLock } from "@/pipeline";
import { replaceVendors, upsertVendor } from "@/store";
import { VendorInputSchema, VendorListInputSchema } from "../../_lib/company";
import { json, readJsonBody, serverError, validate } from "../../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const vendors = validate(VendorListInputSchema, body.value, "La lista de proveedores no es válida");
  if (!vendors.ok) return vendors.response;
  try {
    const company = await withProcessingLock(async () => {
      await ensureCompany();
      await replaceVendors(vendors.value);
      return ensureCompany();
    });
    return json({ company });
  } catch (err) {
    return serverError("No se pudieron guardar los proveedores", err);
  }
}

export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const vendor = validate(VendorInputSchema, body.value, "El proveedor no es válido");
  if (!vendor.ok) return vendor.response;
  try {
    const company = await withProcessingLock(async () => {
      await ensureCompany();
      await upsertVendor(vendor.value);
      return ensureCompany();
    });
    return json({ company });
  } catch (err) {
    return serverError("No se pudo guardar el proveedor", err);
  }
}
