/**
 * GET /api/export?format=json|csv — descarga del registro completo.
 * json: DecisionRecord[] (del más antiguo al más reciente), cada uno con el campo extra `idempotency`
 * (clave de idempotencia calculada al exportar). csv: resumen, separador coma, UTF-8 con BOM.
 */
import type { NextRequest } from "next/server";
import { decisionsToCsv, decisionsToJson } from "@/pipeline/export";
import { exportDecisions } from "@/store";
import { contentDisposition, jsonError, NO_STORE, serverError, todayStamp } from "../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  const format = (request.nextUrl.searchParams.get("format") ?? "json").trim().toLowerCase();
  if (format !== "json" && format !== "csv") {
    return jsonError("El parámetro «format» debe ser «json» o «csv».", 400);
  }
  try {
    const records = await exportDecisions();
    const name = `centinela-registro-${todayStamp()}.${format}`;
    const body = format === "json" ? decisionsToJson(records) : decisionsToCsv(records);
    return new Response(body, {
      status: 200,
      headers: {
        ...NO_STORE,
        "Content-Type": format === "json" ? "application/json; charset=utf-8" : "text/csv; charset=utf-8",
        "Content-Disposition": contentDisposition("attachment", name),
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    return serverError("No se pudo exportar el registro", err);
  }
}
