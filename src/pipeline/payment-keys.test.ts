/**
 * Las claves de pago (src/store) replican normalizaciones del motor, porque src/store no puede
 * importar src/engine. Si se apartan, la base frenaría pagos que el motor aprueba (y escalarían) o
 * dejaría pasar duplicados que el motor sí detecta con el historial al día.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { normalizeFileHash, normalizeInvoiceNumber, periodOf } from "../engine/facts";
import { normalizePaymentInvoiceNumber, normalizePaymentPeriod, paymentFileKey } from "../store/payment-keys";

const tricky = fc.constantFrom(
  "FE-0012", "fe 12", "ＦＥ－００１２", "Fé-012", "ß-1", "ﬁ-01", "İ-7", "ı-7", "Ǆ-9", "  ", "", "0000", "Á-01",
  "١٢٣", "２０２６-１０", "2026-10", "2026-1", "2026-13", "2026-02-29", "2024-02-29", " 2026-10-05 ", "2026-10-31T10:00:00Z",
);
const text = fc.oneof(tricky, fc.string(), fc.string({ unit: "grapheme" }), fc.string({ unit: "binary" }));

describe("claves de pago = normalizaciones del motor", () => {
  it("número de factura", () => {
    fc.assert(
      fc.property(text, (s) => {
        expect(normalizePaymentInvoiceNumber(s)).toBe(normalizeInvoiceNumber(s));
      }),
      { numRuns: 2000 },
    );
  });

  it("periodo", () => {
    fc.assert(
      fc.property(text, (s) => {
        expect(normalizePaymentPeriod(s)).toBe(periodOf(s));
      }),
      { numRuns: 2000 },
    );
  });

  it("huella del archivo", () => {
    fc.assert(
      fc.property(text, (s) => {
        expect(paymentFileKey(s)).toBe(normalizeFileHash(s));
      }),
      { numRuns: 500 },
    );
  });

  it("valores que no son texto", () => {
    for (const v of [null, undefined, 12, {}, []]) {
      expect(normalizePaymentInvoiceNumber(v)).toBe(normalizeInvoiceNumber(v as never));
      expect(normalizePaymentPeriod(v)).toBe(periodOf(v));
    }
    expect(paymentFileKey(null)).toBe(normalizeFileHash(null));
  });
});
