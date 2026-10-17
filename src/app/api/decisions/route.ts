/** GET /api/decisions?limit=N — decisiones, de la más reciente a la más antigua. */
import type { NextRequest } from "next/server";
import { listDecisions } from "@/store";
import { json, jsonError, serverError } from "../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_LIMIT = 1000;

export async function GET(request: NextRequest): Promise<Response> {
  const raw = request.nextUrl.searchParams.get("limit");
  let limit: number | undefined;
  if (raw != null && raw.trim() !== "") {
    if (!/^\d+$/.test(raw.trim())) {
      return jsonError(`El parámetro «limit» debe ser un número entero entre 1 y ${MAX_LIMIT}.`, 400);
    }
    limit = Number(raw.trim());
    if (limit < 1 || limit > MAX_LIMIT) {
      return jsonError(`El parámetro «limit» debe ser un número entero entre 1 y ${MAX_LIMIT}.`, 400);
    }
  }
  try {
    return json({ decisions: await listDecisions(limit != null ? { limit } : undefined) });
  } catch (err) {
    return serverError("No se pudieron leer las decisiones", err);
  }
}
