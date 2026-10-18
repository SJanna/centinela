import { describe, expect, it } from "vitest";
import type { DecisionRecord } from "@/core/schemas";
import { makeRecord } from "@/store/test-helpers";
import { buildTrace, traceToText } from "./trace";

function withSignals(signals: Partial<DecisionRecord["reading"]["signals"]>): DecisionRecord {
  const record = makeRecord({ id: "d1", decidedAt: "2026-10-17T10:00:00Z", outcome: "ESCALAR" });
  return { ...record, reading: { ...record.reading, signals: { ...record.reading.signals, ...signals } } };
}

function verification(record: DecisionRecord): string {
  const step = buildTrace(record).find((s) => s.label === "Verificación");
  expect(step).toBeDefined();
  return traceToText(record, [step!]);
}

describe("buildTrace: verificación", () => {
  it("cuenta y detalla las marcas de documento ya pagado y los avisos de entrada", () => {
    const text = verification(
      withSignals({
        paidDocumentMarkers: [
          { text: "Payment received on 2026-08-10", source: "heuristic", reason: "dice que ya se pagó" },
          { text: "lectura primary: receipt", source: "model", reason: "el lector lo clasificó como recibo" },
        ],
        ingestWarnings: ["El correo trae un adjunto que no se pudo leer: comprobante.docx."],
      }),
    );
    expect(text).toContain("ya pagado 2");
    expect(text).toContain("avisos de entrada 1");
    expect(text).toContain("documento ya pagado: «Payment received on 2026-08-10» · detectado por regla de texto · no se paga");
    expect(text).toContain("documento ya pagado: «lectura primary: receipt» · detectado por lector · no se paga");
    expect(text).toContain("aviso de entrada: El correo trae un adjunto que no se pudo leer: comprobante.docx.");
  });

  it("un registro guardado antes de estas señales las muestra en cero", () => {
    const text = verification(
      withSignals({ paidDocumentMarkers: undefined, ingestWarnings: undefined, voidDocumentMarkers: undefined, currencyOnlyDollarSign: undefined }),
    );
    expect(text).toContain("ya pagado 0");
    expect(text).toContain("avisos de entrada 0");
    expect(text).toContain("no cobrable 0");
    expect(text).not.toContain("documento ya pagado:");
    expect(text).not.toContain("documento no cobrable:");
    expect(text).not.toContain("moneda escrita solo con «$»");
  });

  it("cuenta y detalla las marcas de documento no cobrable", () => {
    const text = verification(
      withSignals({
        voidDocumentMarkers: [
          { text: "ANULADA", reason: "Dice que el documento está anulado o cancelado" },
          { text: "PROFORMA INVOICE", reason: "Es un borrador, una proforma o un documento de muestra, no una factura definitiva" },
        ],
      }),
    );
    expect(text).toContain("no cobrable 2");
    expect(text).toContain("documento no cobrable: «ANULADA» · Dice que el documento está anulado o cancelado · no se paga");
    expect(text).toContain("documento no cobrable: «PROFORMA INVOICE»");
  });

  it("muestra la moneda escrita solo con «$» aunque el motor la haya dado por buena", () => {
    const record = withSignals({ currencyOnlyDollarSign: true });
    const text = verification(record);
    expect(text).toContain(`moneda escrita solo con «$» (leída como ${record.reading.data?.currency}) · la revisa ACU-2 con el país del proveedor`);
    expect(verification(withSignals({ currencyOnlyDollarSign: false }))).not.toContain("moneda escrita solo con «$»");
  });
});
