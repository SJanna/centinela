/** PUT /api/company/rules — reemplaza las reglas. Cuerpo: Rules. */
import { ensureCompany, withProcessingLock } from "@/pipeline";
import { saveRules } from "@/store";
import { RulesInputSchema } from "../../_lib/company";
import { json, readJsonBody, serverError, validate } from "../../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const rules = validate(RulesInputSchema, body.value, "Las reglas no son válidas");
  if (!rules.ok) return rules.response;
  try {
    // Con el candado: una factura en curso se decide con las reglas con que empezó.
    const company = await withProcessingLock(async () => {
      await ensureCompany();
      await saveRules(rules.value);
      return ensureCompany();
    });
    return json({ company });
  } catch (err) {
    return serverError("No se pudieron guardar las reglas", err);
  }
}
