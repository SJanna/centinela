/**
 * Defectos encontrados en la revisión del motor. Cada bloque reproduce un camino por el que el
 * motor decidía PAGAR (o pasaba una comprobación) con datos corruptos o incompletos.
 */
import { describe, expect, it } from "vitest";
import type { Agreement, Rules, Vendor } from "../core/schemas";
import { decide, isAgreementValidOn, selectAgreement } from "./index";
import { bankNamesMayMatch, compareRoutingCodes } from "./facts";
import { ACME, acmeInvoice, check, context, engineInput, nopalInvoice, NOW, paid, reading } from "./test-fixtures";

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

// ───────────────────────── Revisión adversarial ─────────────────────────

describe("revisión adversarial · tolerancia absurda", () => {
  it("ACU-3 con tolerancia de 1000 % queda sin evaluar (antes aceptaba COP 19.000.000 contra 12.000.000)", () => {
    const d = decide(engineInput(acmeInvoice({ total: 19_000_000, subtotal: 19_000_000 })), context({ rules: { amountTolerancePct: 1000 } }));
    expect(check(d, "ACU-3").status).toBe("not_evaluable");
    expect(check(d, "ACU-3").explanation).toContain("entre 0 y 100");
    expect(d.outcome).toBe("ESCALAR");
  });

  it("100 % todavía es una tolerancia válida", () => {
    const d = decide(engineInput(acmeInvoice()), context({ rules: { amountTolerancePct: 100 } }));
    expect(check(d, "ACU-3").status).toBe("pass");
  });
});

describe("revisión adversarial · facturas del futuro (ACU-1)", () => {
  it("emisión posterior a hoy: falla", () => {
    const d = decide(engineInput(acmeInvoice({ issueDate: "2027-03-01", servicePeriod: "2027-03" })), context());
    const c = check(d, "ACU-1");
    expect(c.status).toBe("fail");
    expect(c.explanation).toContain("es posterior a hoy");
    expect(d.agreementId).toBeNull();
    expect(d.outcome).toBe("ESCALAR");
  });

  it("emisión de hoy por un mes que todavía no empieza: falla", () => {
    const d = decide(engineInput(acmeInvoice({ servicePeriod: "2027-01" })), context());
    const c = check(d, "ACU-1");
    expect(c.status).toBe("fail");
    expect(c.explanation).toContain("enero de 2027, todavía no empieza");
    expect(d.outcome).toBe("ESCALAR");
  });

  it("un día de margen por zona horaria; el 31 de octubre en -05:00 ya es 1 de noviembre en UTC", () => {
    expect(selectAgreement(ACME, acmeInvoice({ issueDate: "2026-10-21" }), NOW).status).toBe("selected");
    expect(selectAgreement(ACME, acmeInvoice({ issueDate: "2026-10-22" }), NOW).status).toBe("future_date");
    const nov = acmeInvoice({ issueDate: "2026-11-01", servicePeriod: "2026-11" });
    expect(selectAgreement(ACME, nov, "2026-10-31T20:00:00-05:00").status).toBe("selected");
    expect(selectAgreement(ACME, nov, "2026-10-29T20:00:00-05:00").status).toBe("future_date");
    const novFromOct = acmeInvoice({ issueDate: "2026-10-29", servicePeriod: "2026-11" });
    expect(selectAgreement(ACME, novFromOct, "2026-10-29T20:00:00-05:00").status).toBe("future_period");
  });

  it("sin `now` no se revisa (compatibilidad con quien llama sin fecha)", () => {
    expect(selectAgreement(ACME, acmeInvoice({ issueDate: "2027-03-01", servicePeriod: "2027-03" })).status).toBe("selected");
  });
});

describe("revisión adversarial · el mismo número de cuenta en otro banco (PRV-2)", () => {
  it("otro banco y otro SWIFT: falla", () => {
    const d = decide(engineInput(acmeInvoice({ bankName: "Banco Pirata", routingOrSwift: "PIRACOBB" })), context());
    const c = check(d, "PRV-2");
    expect(c.status).toBe("fail");
    expect(c.explanation).toContain("el mismo número en otro banco es otra cuenta");
    expect(d.outcome).toBe("ESCALAR");
  });

  it("el banco registrado escrito de otra forma pasa", () => {
    for (const [bankName, routingOrSwift] of [
      ["BANCOLOMBIA S.A.", "COLOCOBMXXX"],
      ["Bancolombia", null],
      [null, "COLOCOBM"],
    ] as const) {
      expect(check(decide(engineInput(acmeInvoice({ bankName, routingOrSwift })), context()), "PRV-2").status).toBe("pass");
    }
  });

  it("compareRoutingCodes y bankNamesMayMatch", () => {
    expect(compareRoutingCodes("SVBKUS6SXXX", "SVBKUS6S")).toBe("same");
    expect(compareRoutingCodes("PIRAUS33", "SVBKUS6S")).toBe("different");
    expect(compareRoutingCodes("026009593", "121140399")).toBe("different");
    expect(compareRoutingCodes("SVBKUS6S", "121140399")).toBe("unknown");
    expect(compareRoutingCodes(null, "121140399")).toBe("unknown");
    expect(bankNamesMayMatch("Banco de Crédito del Perú", "BCP")).toBe(true);
    expect(bankNamesMayMatch("SVB", "Silicon Valley Bank")).toBe(true);
    expect(bankNamesMayMatch("Banco Pirata Internacional", "Silicon Valley Bank")).toBe(false);
    expect(bankNamesMayMatch("Interbank", "BCP")).toBe(false);
  });
});

describe("revisión adversarial · acuerdo renovado a mitad de mes (DUP-3)", () => {
  it("el mes pagado con el acuerdo anterior no se paga otra vez con el nuevo", () => {
    const renewed: Vendor = {
      ...ACME,
      agreements: [
        { ...ACME.agreements[0], validTo: "2026-10-10" },
        { ...ACME.agreements[0], id: "a-acme-2", description: "Renovado", validFrom: "2026-10-11", validTo: null },
      ],
    };
    const history = [paid({ vendorId: "v-acme", invoiceNumber: "FE-0900", agreementId: "a-acme-mensual", agreementPeriod: "2026-10", amountUsd: 3000 })];
    const d = decide(engineInput(acmeInvoice({ issueDate: "2026-10-15" })), context({ vendors: [renewed], history }));
    expect(d.agreementId).toBe("a-acme-2");
    const c = check(d, "DUP-3");
    expect(c.status).toBe("not_evaluable");
    expect(c.explanation).toContain("también cuadra");
    expect(d.outcome).toBe("ESCALAR");
  });
});
