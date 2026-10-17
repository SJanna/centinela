import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DecisionRecord } from "@/core/schemas";
import { IDEMPOTENCY_NAMESPACE, uuidv5 } from "@/pipeline/idempotency";
import { makeRecord } from "@/store/test-helpers";
import { ContextPanel } from "./context-panel";

const HELP = "La misma factura produce siempre la misma clave. Quien ejecute el pago puede usarla para no pagarla dos veces.";

/** Texto visible de la sección «Clave de idempotencia» (sin etiquetas ni entidades). */
function idempotencySection(record: DecisionRecord): string {
  const html = renderToStaticMarkup(createElement(ContextPanel, { record }));
  const start = html.indexOf('aria-labelledby="clave-idempotencia-titulo"');
  expect(start).toBeGreaterThan(-1);
  const end = html.indexOf("</section>", start);
  return html
    .slice(start, end)
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

describe("ContextPanel: clave de idempotencia", () => {
  it("muestra la clave, la clave de factura de la que sale y la línea de ayuda", () => {
    const text = idempotencySection(makeRecord({ id: "d1", decidedAt: "2026-10-17T10:00:00Z", invoiceNumber: "F-001" }));
    expect(text).toContain("Clave de idempotencia");
    expect(text).toContain(uuidv5("v-uno|F1", IDEMPOTENCY_NAMESPACE));
    expect(text).toContain("v-uno|F1");
    expect(text).toContain(HELP);
  });

  it("sin proveedor emparejado no hay clave y dice por qué", () => {
    const text = idempotencySection(makeRecord({ id: "d1", decidedAt: "2026-10-17T10:00:00Z", vendorId: null, outcome: "ESCALAR" }));
    expect(text).toContain("Sin clave: no se identificó al proveedor en la ficha.");
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-/);
    expect(text).toContain(HELP);
  });
});
