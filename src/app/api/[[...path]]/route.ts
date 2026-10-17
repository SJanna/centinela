/**
 * Cualquier ruta /api/* que no existe: 404 con `{ error }` en español, como el resto de la API
 * (sin esta ruta Next responde su página HTML de 404, en inglés). Las rutas concretas tienen
 * prioridad sobre esta.
 */
import { jsonError } from "../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function notFound(request: Request): Response {
  const path = new URL(request.url).pathname;
  const shown = path.length > 120 ? `${path.slice(0, 119)}…` : path;
  return jsonError(`No existe esa ruta de la API: ${shown}.`, 404);
}

export async function GET(request: Request): Promise<Response> {
  return notFound(request);
}
export async function POST(request: Request): Promise<Response> {
  return notFound(request);
}
export async function PUT(request: Request): Promise<Response> {
  return notFound(request);
}
export async function PATCH(request: Request): Promise<Response> {
  return notFound(request);
}
export async function DELETE(request: Request): Promise<Response> {
  return notFound(request);
}
