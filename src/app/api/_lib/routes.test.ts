/**
 * Rutas de la API llamadas directamente (sin servidor), con base en memoria y lectura simulada.
 */
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readSample, resetDemo } from "@/pipeline";
import { resetDbForTests } from "@/store";
import { POST as uploadInvoice } from "../invoices/route";
import { GET as invoiceFile } from "../invoices/[id]/file/route";
import { GET as invoicePreview } from "../invoices/[id]/preview/route";
import { GET as listDecisionsRoute } from "../decisions/route";
import { GET as decisionRoute } from "../decisions/[id]/route";
import { GET as statsRoute } from "../stats/route";
import { GET as statusRoute } from "../status/route";
import { GET as companyRoute } from "../company/route";
import { PUT as putRules } from "../company/rules/route";
import { POST as postVendor, PUT as putVendors } from "../company/vendors/route";
import { DELETE as deleteVendorRoute } from "../company/vendors/[id]/route";
import { POST as resetRoute } from "../demo/reset/route";
import { GET as samplesRoute } from "../samples/route";
import { GET as sampleRoute } from "../samples/[caseId]/route";
import { GET as exportRoute } from "../export/route";
import { POST as accessRoute } from "../access/route";
import * as unknownApiRoute from "../[[...path]]/route";

const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const url = (path: string) => new NextRequest(new URL(path, "http://localhost"));

async function upload(caseId: string): Promise<Response> {
  const sample = await readSample(caseId);
  const form = new FormData();
  form.set("file", new File([new Uint8Array(sample!.bytes)], sample!.filename, { type: sample!.mediaType }));
  return uploadInvoice(new Request("http://localhost/api/invoices", { method: "POST", body: form }));
}

function jsonRequest(method: string, body: unknown): Request {
  return new Request("http://localhost/x", {
    method,
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeAll(() => {
  // Las rutas usan la fecha actual: se fija para que el resultado no dependa del día en que corre la prueba.
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-20T15:00:00Z") });
  vi.stubEnv("PGLITE_DIR", "memory");
  vi.stubEnv("READING_MODE", "simulated");
  vi.stubEnv("DEMO_ACCESS_CODE", "");
});

afterAll(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  await resetDbForTests();
});

beforeEach(async () => {
  await resetDbForTests();
  await resetDemo();
});

describe("facturas", () => {
  it("POST /api/invoices procesa y devuelve el resumen; luego se listan, se leen y se exportan", async () => {
    const res = await upload("B02");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recordId).toMatch(/^dec_/);
    expect(body.decision).toMatchObject({ id: body.recordId, outcome: "PAGAR", filename: "B02.pdf", readingMode: "simulated" });

    const again = await (await upload("B02")).json();
    expect(again.decision.outcome).toBe("FRENAR");

    const list = await (await listDecisionsRoute(url("/api/decisions?limit=1"))).json();
    expect(list.decisions).toHaveLength(1);
    expect(list.decisions[0].id).toBe(again.recordId);
    expect((await listDecisionsRoute(url("/api/decisions?limit=abc"))).status).toBe(400);

    const detail = await decisionRoute(url("/x"), params({ id: body.recordId }));
    const { record } = await detail.json();
    expect(record.decision.checks).toHaveLength(15);
    expect((await decisionRoute(url("/x"), params({ id: "dec_nope" }))).status).toBe(404);

    const file = await invoiceFile(url("/x"), params({ id: record.invoiceId }));
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("application/pdf");
    expect(file.headers.get("content-disposition")).toMatch(/^inline; filename="B02.pdf"/);
    expect((await file.arrayBuffer()).byteLength).toBe((await readSample("B02"))!.bytes.byteLength);

    const preview = await (await invoicePreview(url("/x"), params({ id: record.invoiceId }))).json();
    expect(preview).toMatchObject({ kind: "pdf", mediaType: "application/pdf", filename: "B02.pdf" });
    expect(typeof preview.plainText).toBe("string");
    expect((await invoicePreview(url("/x"), params({ id: "inv_nope" }))).status).toBe(404);

    const stats = await (await statsRoute()).json();
    expect(stats.total).toBe(2);
    expect(stats.byOutcome).toEqual({ PAGAR: 1, FRENAR: 1, ESCALAR: 0 });

    const json = await exportRoute(url("/api/export?format=json"));
    expect(json.headers.get("content-disposition")).toMatch(/^attachment; filename="centinela-registro-2026-10-20\.json"/);
    expect(await json.json()).toHaveLength(2);
    const csv = await exportRoute(url("/api/export?format=csv"));
    expect(csv.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    const csvText = new TextDecoder("utf-8", { ignoreBOM: true }).decode(await csv.arrayBuffer());
    expect(csvText.startsWith("﻿id_decision,")).toBe(true);
    expect(csvText.trim().split("\r\n")).toHaveLength(3);
    expect((await exportRoute(url("/api/export?format=xml"))).status).toBe(400);
  });

  it("POST /api/invoices: errores en español", async () => {
    const noFile = await uploadInvoice(new Request("http://localhost/api/invoices", { method: "POST", body: new FormData() }));
    expect(noFile.status).toBe(400);
    expect((await noFile.json()).error).toMatch(/campo «file»/);

    const notMultipart = await uploadInvoice(jsonRequest("POST", { file: "x" }));
    expect(notMultipart.status).toBe(400);

    const empty = new FormData();
    empty.set("file", new File([], "vacia.pdf", { type: "application/pdf" }));
    const emptyRes = await uploadInvoice(new Request("http://localhost/api/invoices", { method: "POST", body: empty }));
    expect(emptyRes.status).toBe(422);
    expect((await emptyRes.json()).error).toBe("El archivo «vacia.pdf» está vacío.");

    const big = new FormData();
    big.set("file", new File([new Uint8Array(4 * 1024 * 1024 + 1)], "grande.pdf", { type: "application/pdf" }));
    const bigRes = await uploadInvoice(new Request("http://localhost/api/invoices", { method: "POST", body: big }));
    expect(bigRes.status).toBe(413);
    expect((await bigRes.json()).error).toMatch(/«grande.pdf».*máximo de 4,0 MB/);
  });

  it("un HTML subido se sirve como texto plano", async () => {
    const form = new FormData();
    form.set("file", new File(["<html><body><script>alert(1)</script>Factura 1</body></html>"], "f.html", { type: "text/html" }));
    const res = await uploadInvoice(new Request("http://localhost/api/invoices", { method: "POST", body: form }));
    expect(res.status).toBe(200);
    const { recordId } = await res.json();
    const { record } = await (await decisionRoute(url("/x"), params({ id: recordId }))).json();
    const file = await invoiceFile(url("/x"), params({ id: record.invoiceId }));
    expect(file.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(file.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("empresa", () => {
  it("GET /api/company y PUT /api/company/rules", async () => {
    const { company } = await (await companyRoute()).json();
    expect(company.vendors.length).toBeGreaterThan(0);

    const ok = await putRules(jsonRequest("PUT", { ...company.rules, approvalThresholdUsd: 8000 }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).company.rules.approvalThresholdUsd).toBe(8000);

    const bad = await putRules(jsonRequest("PUT", { ...company.rules, periodLimitUsd: -1 }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/^Las reglas no son válidas: .*límite del mes/);

    const notJson = await putRules(jsonRequest("PUT", "{nope"));
    expect(notJson.status).toBe(400);
    expect((await notJson.json()).error).toBe("El cuerpo de la petición debe ser JSON válido.");
  });

  it("proveedores: crear, importar, borrar", async () => {
    const { company } = await (await companyRoute()).json();
    const base = company.vendors[0];
    const created = await postVendor(jsonRequest("POST", { ...base, id: "v-nuevo", name: "Nuevo S.A.S." }));
    expect(created.status).toBe(200);
    expect((await created.json()).company.vendors.at(-1).id).toBe("v-nuevo");

    const dup = await putVendors(jsonRequest("PUT", [base, base]));
    expect(dup.status).toBe(400);
    expect((await dup.json()).error).toMatch(/aparece más de una vez/);

    const replaced = await putVendors(jsonRequest("PUT", [base]));
    expect((await replaced.json()).company.vendors).toHaveLength(1);

    const del = await deleteVendorRoute(url("/x"), params({ id: base.id }));
    expect((await del.json()).company.vendors).toHaveLength(0);
    expect((await deleteVendorRoute(url("/x"), params({ id: base.id }))).status).toBe(404);

    const invalid = await postVendor(jsonRequest("POST", { id: "x" }));
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error).toMatch(/^El proveedor no es válido: /);
  });

  it("POST /api/demo/reset vuelve a la empresa del dataset y borra decisiones", async () => {
    await upload("B01");
    await putRules(jsonRequest("PUT", { ...(await (await companyRoute()).json()).company.rules, initialFundUsd: 1 }));
    const res = await resetRoute();
    const { company } = await res.json();
    expect(company.rules.initialFundUsd).toBe(40000);
    expect((await (await listDecisionsRoute(url("/api/decisions"))).json()).decisions).toEqual([]);
  });
});

describe("muestras, estado y acceso", () => {
  it("GET /api/samples y /api/samples/[caseId]", async () => {
    const { samples } = await (await samplesRoute()).json();
    expect(samples).toHaveLength(41);
    expect(samples[0]).toEqual({
      caseId: "B01",
      filename: "B01.pdf",
      formato: "pdf",
      descripcion: expect.any(String),
      split: "train",
      escenario: "base",
      decision_esperada: "PAGAR",
    });
    const file = await sampleRoute(url("/x"), params({ caseId: "B04" }));
    expect(file.headers.get("content-type")).toBe("image/png");
    expect((await sampleRoute(url("/x"), params({ caseId: "../company" }))).status).toBe(404);
  });

  it("una ruta /api desconocida responde 404 en JSON con el mensaje en español (no la página HTML de Next)", async () => {
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"] as const) {
      const handler = unknownApiRoute[method];
      expect(handler, method).toBeTypeOf("function");
      const res = await handler(new Request("http://localhost/api/nope/x", { method }));
      expect(res.status, method).toBe(404);
      expect(res.headers.get("content-type")).toMatch(/^application\/json/);
      expect((await res.json()).error).toBe("No existe esa ruta de la API: /api/nope/x.");
    }
    expect(unknownApiRoute.runtime).toBe("nodejs");
    expect(unknownApiRoute.dynamic).toBe("force-dynamic");
  });

  it("GET /api/status", async () => {
    const status = await (await statusRoute()).json();
    expect(status).toMatchObject({ readingMode: "simulated", models: ["simulado"], accessProtected: false });
    expect(status.companyName).toBeTruthy();
  });

  it("POST /api/access", async () => {
    vi.stubEnv("DEMO_ACCESS_CODE", "clave-demo");
    try {
      const wrong = await accessRoute(jsonRequest("POST", { code: "otra" }));
      expect(wrong.status).toBe(401);
      expect(wrong.headers.get("set-cookie")).toBeNull();
      const right = await accessRoute(jsonRequest("POST", { code: "clave-demo" }));
      expect(right.status).toBe(200);
      expect(await right.json()).toEqual({ ok: true });
      const cookie = right.headers.get("set-cookie")!;
      expect(cookie).toMatch(/^centinela_access=[0-9a-f]{64}; Path=\/; Max-Age=\d+; HttpOnly; SameSite=Lax/);
      expect(cookie).not.toContain("clave-demo");
      expect((await accessRoute(jsonRequest("POST", {}))).status).toBe(400);
    } finally {
      vi.stubEnv("DEMO_ACCESS_CODE", "");
    }
  });
});
