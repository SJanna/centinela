import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { proxy } from "../proxy";
import { ACCESS_COOKIE, constantTimeEqual, isPublicPath, isValidAccessCookie, sha256HexOf } from "./access";

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

describe("access", () => {
  it("sha256HexOf coincide con node:crypto", async () => {
    expect(await sha256HexOf("código-secreto")).toBe(sha("código-secreto"));
  });

  it("constantTimeEqual", async () => {
    expect(await constantTimeEqual("abc", "abc")).toBe(true);
    expect(await constantTimeEqual("abc", "abd")).toBe(false);
    expect(await constantTimeEqual("abc", "abcd")).toBe(false);
    expect(await constantTimeEqual("", "")).toBe(true);
  });

  it("isValidAccessCookie", async () => {
    expect(await isValidAccessCookie(sha("1234"), "1234")).toBe(true);
    expect(await isValidAccessCookie(sha("1234").toUpperCase(), "1234")).toBe(true);
    expect(await isValidAccessCookie("1234", "1234")).toBe(false);
    expect(await isValidAccessCookie(undefined, "1234")).toBe(false);
  });

  it("rutas públicas", () => {
    for (const p of ["/api/access", "/api/status", "/api/status/", "/acceso", "/acceso/", "/_next/static/x.js", "/favicon.ico", "/logo.svg"]) {
      expect(isPublicPath(p), p).toBe(true);
    }
    for (const p of ["/", "/registro", "/api/decisions", "/api/samples/B01", "/api/export", "/api/x.json", "/accesorios", "/api/accessx"]) {
      expect(isPublicPath(p), p).toBe(false);
    }
  });
});

describe("proxy", () => {
  afterEach(() => vi.unstubAllEnvs());

  const req = (path: string, cookie?: string) =>
    new NextRequest(new URL(path, "http://localhost:3000"), cookie ? { headers: { cookie: `${ACCESS_COOKIE}=${cookie}` } } : undefined);

  it("sin DEMO_ACCESS_CODE deja pasar todo", async () => {
    vi.stubEnv("DEMO_ACCESS_CODE", "");
    const res = await proxy(req("/api/decisions"));
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("con código: API sin cookie → 401 JSON en español", async () => {
    vi.stubEnv("DEMO_ACCESS_CODE", "1234");
    const res = await proxy(req("/api/decisions?limit=5"));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toMatch(/código/);
  });

  it("con código: página sin cookie → redirección a /acceso?next=…", async () => {
    vi.stubEnv("DEMO_ACCESS_CODE", "1234");
    const res = await proxy(req("/registro?x=1"));
    expect([302, 307]).toContain(res.status);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/acceso");
    expect(location.searchParams.get("next")).toBe("/registro?x=1");
  });

  it("con código: cookie correcta pasa; cookie incorrecta no", async () => {
    vi.stubEnv("DEMO_ACCESS_CODE", "1234");
    expect((await proxy(req("/api/decisions", sha("1234")))).headers.get("x-middleware-next")).toBe("1");
    expect((await proxy(req("/api/decisions", sha("9999")))).status).toBe(401);
  });

  it("con código: la excepción de archivos estáticos solo vale para GET/HEAD (no para acciones de servidor)", async () => {
    vi.stubEnv("DEMO_ACCESS_CODE", "1234");
    // Una página con segmento dinámico (p. ej. /decisiones/[id]) también responde en /decisiones/x.png;
    // una acción de servidor llega como POST a la ruta de la página con la cabecera Next-Action.
    const action = new NextRequest(new URL("/decisiones/x.png", "http://localhost:3000"), {
      method: "POST",
      headers: { "next-action": "abc123" },
    });
    const res = await proxy(action);
    expect(res.headers.get("x-middleware-next")).toBeNull();
    expect([302, 307]).toContain(res.status);
    // Los archivos estáticos se siguen sirviendo sin cookie.
    for (const method of ["GET", "HEAD"]) {
      const asset = new NextRequest(new URL("/next.svg", "http://localhost:3000"), { method });
      expect((await proxy(asset)).headers.get("x-middleware-next"), method).toBe("1");
    }
    // Las rutas públicas explícitas aceptan cualquier método (el formulario de /acceso envía POST).
    const login = new NextRequest(new URL("/api/access", "http://localhost:3000"), { method: "POST" });
    expect((await proxy(login)).headers.get("x-middleware-next")).toBe("1");
  });

  it("con código: rutas públicas pasan sin cookie", async () => {
    vi.stubEnv("DEMO_ACCESS_CODE", "1234");
    for (const p of ["/api/access", "/api/status", "/acceso?next=%2F"]) {
      expect((await proxy(req(p))).headers.get("x-middleware-next"), p).toBe("1");
    }
  });
});
