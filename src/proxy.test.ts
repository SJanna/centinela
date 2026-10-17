/**
 * Revisión adversarial del proxy de acceso con DEMO_ACCESS_CODE definido: intentos de llegar a la
 * API (o a una página) sin la cookie válida.
 */
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCESS_COOKIE } from "./pipeline/access";
import { proxy } from "./proxy";

const CODE = "codigo-de-la-demo";
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

function request(path: string, init: { method?: string; headers?: Record<string, string> } = {}): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3000"), init);
}

/** true si el proxy dejó pasar la petición a la ruta. */
async function passes(req: NextRequest): Promise<boolean> {
  const res = await proxy(req);
  return res.headers.get("x-middleware-next") === "1";
}

beforeEach(() => vi.stubEnv("DEMO_ACCESS_CODE", CODE));
afterEach(() => vi.unstubAllEnvs());

describe("proxy · intentos de saltarse el código de acceso", () => {
  it.each([
    "/api/status/../decisions",
    "/api/access/../export?format=json",
    "/acceso/../api/decisions",
    "/acceso/%2e%2e/api/decisions",
    "/acceso/%2E%2E/%2E%2E/api/export",
    "/_next/../api/decisions",
    "/_next/static/../../api/export",
    "/api/status;/../decisions",
    "/api/status/..%2fdecisions",
    "/api/export.json",
    "/api/decisions/x.png",
    "/api/invoices/inv_1/file.pdf",
    "/api/samples/B01.pdf",
    "/API/decisions",
    "//api/decisions",
    "/api/%73tatus",
  ])("%s no pasa sin cookie", async (path) => {
    expect(await passes(request(path))).toBe(false);
  });

  it.each(["POST", "PUT", "DELETE"])("%s a la API con extensión de archivo estático no pasa", async (method) => {
    expect(await passes(request("/api/company/rules.json", { method }))).toBe(false);
    expect(await passes(request("/api/demo/reset.png", { method }))).toBe(false);
  });

  it("la cookie con el código en claro, vacía, de otro código o duplicada no vale", async () => {
    const withCookie = (cookie: string) => request("/api/decisions", { headers: { cookie } });
    expect(await passes(withCookie(`${ACCESS_COOKIE}=${CODE}`))).toBe(false);
    expect(await passes(withCookie(`${ACCESS_COOKIE}=`))).toBe(false);
    expect(await passes(withCookie(`${ACCESS_COOKIE}=${sha("otro")}`))).toBe(false);
    expect(await passes(withCookie(`${ACCESS_COOKIE}=${sha(CODE)}x`))).toBe(false);
    expect(await passes(withCookie(`${ACCESS_COOKIE}=${sha("")}`))).toBe(false);
    expect(await passes(withCookie(`${ACCESS_COOKIE.toUpperCase()}=${sha(CODE)}`))).toBe(false);
    // Control: la cookie correcta sí pasa.
    expect(await passes(withCookie(`${ACCESS_COOKIE}=${sha(CODE)}`))).toBe(true);
  });

  it("las cabeceras internas de Next o de reenvío no dan acceso", async () => {
    const attempts: Record<string, string>[] = [
      { "x-middleware-subrequest": "proxy:proxy:proxy:proxy:proxy" },
      { "x-middleware-subrequest": "src/proxy:src/proxy:src/proxy:src/proxy:src/proxy" },
      { "x-forwarded-host": "localhost", "x-forwarded-proto": "https" },
      { "x-invoke-path": "/api/status", "x-matched-path": "/api/status" },
      { "next-action": "abc" },
    ];
    for (const headers of attempts) {
      expect(await passes(request("/api/decisions", { headers })), JSON.stringify(headers)).toBe(false);
    }
  });

  it("un código con solo espacios no cuenta como configurado (queda abierto, como sin variable)", async () => {
    vi.stubEnv("DEMO_ACCESS_CODE", "   ");
    expect(await passes(request("/api/decisions"))).toBe(true);
  });
});
