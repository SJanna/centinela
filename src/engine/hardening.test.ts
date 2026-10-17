/**
 * Defectos encontrados en la revisión del motor. Cada bloque reproduce un camino por el que el
 * motor decidía PAGAR (o pasaba una comprobación) con datos corruptos o incompletos.
 */
import { describe, expect, it } from "vitest";
import type { Agreement, Rules, Vendor } from "../core/schemas";
import { decide, isAgreementValidOn, selectAgreement } from "./index";
import { ACME, acmeInvoice, check, context, engineInput, nopalInvoice, paid, reading } from "./test-fixtures";

describe("DUP-1 · la huella se compara igual en ambos lados", () => {
  it("frena si el historial guardó la misma huella con espacios (antes solo se recortaba la entrada)", () => {
    const hash = `${"a".repeat(64)}\n`;
    const d = decide(
      engineInput(acmeInvoice(), { fileHash: hash }),
      context({ history: [paid({ fileHash: hash, vendorId: "v-otro" })] }),
    );
    expect(check(d, "DUP-1").status).toBe("fail");
    expect(d.outcome).toBe("FRENAR");
  });

  it("frena si la misma huella sha256 viene en mayúsculas en un lado", () => {
    const d = decide(
      engineInput(acmeInvoice(), { fileHash: "ABCDEF0123" }),
      context({ history: [paid({ fileHash: "abcdef0123", vendorId: "v-otro" })] }),
    );
    expect(check(d, "DUP-1").status).toBe("fail");
    expect(d.outcome).toBe("FRENAR");
  });
});

describe("reglas de la empresa con valores no numéricos: nunca se ignoran", () => {
  const broken = (rules: Partial<Record<keyof Rules, unknown>>) => context({ rules: rules as Partial<Rules> });

  it("LIM-1 sin umbral válido (NaN) queda sin evaluar y no se paga", () => {
    const d = decide(engineInput(acmeInvoice()), broken({ approvalThresholdUsd: Number.NaN }));
    expect(check(d, "LIM-1").status).toBe("not_evaluable");
    expect(check(d, "LIM-1").explanation).toContain("umbral de aprobación");
    expect(d.outcome).toBe("ESCALAR");
    expect(d.humanAction).toContain("Revisar la configuración de reglas");
  });

  it("LIM-2 sin límite mensual (undefined tras mezclar reglas) queda sin evaluar", () => {
    const d = decide(engineInput(acmeInvoice()), broken({ periodLimitUsd: undefined }));
    expect(check(d, "LIM-2").status).toBe("not_evaluable");
    expect(d.outcome).toBe("ESCALAR");
  });

  it("FON-1 sin fondo inicial válido queda sin evaluar", () => {
    const d = decide(engineInput(acmeInvoice()), broken({ initialFundUsd: Number.NaN }));
    expect(check(d, "FON-1").status).toBe("not_evaluable");
    expect(d.outcome).toBe("ESCALAR");
  });

  it("ACU-3 con tolerancia infinita no acepta cualquier monto", () => {
    const d = decide(
      engineInput(acmeInvoice({ total: 19_000_000, subtotal: 19_000_000 })),
      broken({ amountTolerancePct: Number.POSITIVE_INFINITY }),
    );
    expect(check(d, "ACU-3").status).toBe("not_evaluable");
    expect(d.outcome).toBe("ESCALAR");
  });

  it("ACU-3 con tolerancia NaN no muestra «NaN» y queda sin evaluar", () => {
    const d = decide(engineInput(acmeInvoice()), broken({ amountTolerancePct: Number.NaN }));
    const c = check(d, "ACU-3");
    expect(c.status).toBe("not_evaluable");
    expect(c.explanation).not.toContain("NaN");
  });

  it("ACU-3 por hora con máximo de horas corrupto (NaN) no lo trata como «sin máximo»", () => {
    const nopal: Vendor = {
      ...context().company.vendors[1],
      agreements: [{ ...context().company.vendors[1].agreements[0], maxQuantity: Number.NaN }],
    };
    const inv = nopalInvoice({
      total: 500 * 900,
      subtotal: 500 * 900,
      lineItems: [{ description: "Diseño", quantity: 500, unitPrice: 900, amount: 500 * 900 }],
    });
    const d = decide(engineInput(inv), context({ vendors: [nopal], rules: { approvalThresholdUsd: 1e9, periodLimitUsd: 1e9, initialFundUsd: 1e9 } }));
    expect(check(d, "ACU-3").status).toBe("not_evaluable");
    expect(d.outcome).not.toBe("PAGAR");
  });
});

describe("LIM-2 · el mes en curso y las fechas del historial deben ser válidos", () => {
  it("sin ctx.now válido no se puede saber qué se pagó en el mes: no se paga", () => {
    const history = [paid({ amountUsd: 2000, decidedAt: "2026-10-01T00:00:00Z" })];
    for (const now of ["", "ayer", "10/20/2026"]) {
      const d = decide(engineInput(acmeInvoice()), context({ now, history, rules: { periodLimitUsd: 4000 } }));
      const c = check(d, "LIM-2");
      expect(c.status, now).toBe("not_evaluable");
      expect(c.explanation, now).not.toContain("Pagado en :");
      expect(d.outcome, now).toBe("ESCALAR");
    }
  });

  it("un pago del historial sin fecha válida no se descarta del mes", () => {
    const history = [paid({ amountUsd: 2000, decidedAt: "20 de octubre" })];
    const d = decide(engineInput(acmeInvoice()), context({ history, rules: { periodLimitUsd: 4000 } }));
    expect(check(d, "LIM-2").status).toBe("not_evaluable");
    expect(d.outcome).toBe("ESCALAR");
  });

  it("las fechas del historial que no son PAGAR no importan", () => {
    const history = [paid({ outcome: "ESCALAR", amountUsd: null, decidedAt: "" })];
    const d = decide(engineInput(acmeInvoice()), context({ history }));
    expect(check(d, "LIM-2").status).toBe("pass");
    expect(d.outcome).toBe("PAGAR");
  });
});

describe("historial con montos negativos no agranda el fondo ni el límite", () => {
  it("FON-1 y LIM-2 quedan sin evaluar si un pago registrado tiene monto negativo", () => {
    const history = [paid({ amountUsd: -5000 })];
    const d = decide(engineInput(acmeInvoice()), context({ history, rules: { initialFundUsd: 1000, periodLimitUsd: 1000 } }));
    expect(check(d, "FON-1").status).toBe("not_evaluable");
    expect(check(d, "LIM-2").status).toBe("not_evaluable");
    expect(d.outcome).toBe("ESCALAR");
  });
});

describe("ACU-1 · vigencia con fechas de la ficha mal escritas", () => {
  const withDates = (validFrom: string, validTo: string | null): Vendor => ({
    ...ACME,
    agreements: [{ ...ACME.agreements[0], validFrom, validTo }],
  });

  it("un acuerdo con fin «2026-6-30» no está vigente en octubre (antes la comparación de textos decía que sí)", () => {
    const d = decide(engineInput(acmeInvoice()), context({ vendors: [withDates("2026-01-01", "2026-6-30")] }));
    expect(check(d, "ACU-1").status).toBe("fail");
    expect(d.outcome).toBe("ESCALAR");
  });

  it("un acuerdo con inicio ilegible nunca está vigente", () => {
    const a: Agreement = { ...ACME.agreements[0], validFrom: "enero", validTo: null };
    expect(isAgreementValidOn(a, "2026-10-05")).toBe(false);
  });

  it("una fecha de la ficha con hora no es YYYY-MM-DD: el acuerdo no está vigente (la guardia tampoco lo aceptaría)", () => {
    const v = withDates("2026-10-05T00:00:00Z", "2026-10-31T23:59:59Z");
    expect(selectAgreement(v, acmeInvoice({ issueDate: "2026-10-05" })).status).toBe("none_valid");
    expect(selectAgreement(withDates("2026-10-05", "2026-10-31"), acmeInvoice({ issueDate: "2026-10-31" })).status).toBe("selected");
    expect(selectAgreement(withDates("2026-10-05", "2026-10-31"), acmeInvoice({ issueDate: "2026-11-01" })).status).toBe("none_valid");
  });

  it("un día que no existe en el calendario no es una fecha válida", () => {
    expect(isAgreementValidOn({ ...ACME.agreements[0], validTo: "2026-02-30" }, "2026-02-10")).toBe(false);
  });
});

describe("LEC-2 · no pasa sin una segunda lectura, aunque la señal venga vacía", () => {
  it("falla si no hubo segunda lectura", () => {
    const input = engineInput(acmeInvoice());
    const d = decide({ ...input, reading: { ...input.reading, secondary: null } }, context());
    const c = check(d, "LEC-2");
    expect(c.status).toBe("fail");
    expect(c.explanation).toContain("No hubo una segunda lectura");
    expect(d.outcome).toBe("ESCALAR");
  });

  it("falla si la segunda lectura falló", () => {
    const base = reading(acmeInvoice());
    const secondary = { ok: false as const, readerId: "secondary", model: "m", promptVersion: "t1", error: "api_error" as const, message: "x" };
    const d = decide({ invoiceId: "X", fileHash: "f".repeat(64), reading: { ...base, secondary } }, context());
    expect(check(d, "LEC-2").status).toBe("fail");
    expect(d.outcome).toBe("ESCALAR");
  });
});
