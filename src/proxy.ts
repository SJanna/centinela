/**
 * Acceso a la demo. Si existe `DEMO_ACCESS_CODE`, exige la cookie `centinela_access`
 * (sha256 del código):
 * - páginas → redirección a /acceso?next=<ruta pedida>
 * - /api/*  → 401 con `{ error }` en español
 * Quedan abiertos /api/access, /api/status, /acceso, /_next, el favicon y los archivos estáticos.
 * Sin la variable, todo queda abierto (desarrollo local).
 */
import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, configuredAccessCode, isPublicPath, isValidAccessCookie } from "./pipeline/access";

export async function proxy(request: NextRequest): Promise<Response> {
  const code = configuredAccessCode();
  if (code == null) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  if (isPublicPath(pathname, request.method)) return NextResponse.next();

  if (await isValidAccessCookie(request.cookies.get(ACCESS_COOKIE)?.value, code)) {
    return NextResponse.next();
  }

  if (pathname === "/api" || pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Acceso restringido: ingresa el código de la demo para continuar." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const target = request.nextUrl.clone();
  target.pathname = "/acceso";
  target.search = "";
  target.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(target);
}

export const config = {
  // Lo estático de Next y el favicon ni siquiera pasan por el proxy; el resto se filtra en isPublicPath.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
