import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MAX_UPLOAD_BYTES } from "@/app/api/_lib/limits";
import { Button } from "./button";
import { DROP_ZONE_DEFAULT_HINT } from "./drop-zone";

const html = (props: Parameters<typeof Button>[0]) => renderToStaticMarkup(createElement(Button, props));

describe("Button", () => {
  it("variante danger: rojo lavado", () => {
    const out = html({ variant: "danger", children: "Borrar proveedor" });
    expect(out).toMatch(/^<button type="button"/);
    expect(out).toContain("bg-danger-wash");
    expect(out).toContain("text-danger");
  });

  it("con download es un <a download> simple, sin otra pestaña", () => {
    const named = html({ href: "/api/invoices/inv_1/file", download: "factura.pdf", external: true, children: "Descargar" });
    expect(named).toMatch(/^<a href="\/api\/invoices\/inv_1\/file" download="factura.pdf"/);
    expect(named).not.toContain("target=");
    const unnamed = html({ href: "/api/export?format=csv", download: true, children: "Exportar CSV" });
    expect(unnamed).toMatch(/^<a href="\/api\/export\?format=csv" download=""/);
  });

  it("un enlace externo sin download abre en otra pestaña", () => {
    const out = html({ href: "https://example.com", children: "Ver" });
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noreferrer"');
    expect(out).not.toContain("download");
  });
});

describe("DropZone", () => {
  it("el texto por defecto dice el límite de POST /api/invoices", () => {
    const mb = MAX_UPLOAD_BYTES / (1024 * 1024);
    expect(DROP_ZONE_DEFAULT_HINT.replace(/\u00a0/g, " ")).toContain(`hasta ${mb} MB por factura`);
  });
});
