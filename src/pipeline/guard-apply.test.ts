import { describe, expect, it } from "vitest";
import { CHECK_CATALOG } from "../core/checks";
import type { Decision } from "../core/schemas";
import { applyGuard } from "./guard-apply";

function decision(outcome: Decision["outcome"]): Decision {
  return {
    invoiceId: "inv_1",
    outcome,
    checks: CHECK_CATALOG.map((c) => ({
      code: c.code,
      status: "pass",
      outcomeIfFail: c.outcomeIfFail,
      explanation: "ok",
      params: {},
    })),
    summary: "Se paga a Proveedor: USD 1.000,00. Cumple las 15 comprobaciones.",
    humanAction: null,
    vendorId: "v-uno",
    agreementId: "a-uno",
    agreementPeriod: "2026-10",
    amountUsd: 1000,
    guard: null,
    guardOverride: false,
  };
}

describe("applyGuard", () => {
  it("si la guardia aprueba, guarda su resultado y no cambia la decisión", () => {
    const d = decision("PAGAR");
    const out = applyGuard(d, { approved: true, violations: [] });
    expect(out).toEqual({ ...d, guard: { approved: true, violations: [] }, guardOverride: false });
    expect(d.guard).toBeNull(); // no muta la entrada
  });

  it("si la guardia no aprueba, escala con guardOverride y explica las violaciones", () => {
    const d = decision("PAGAR");
    const guard = { approved: false, violations: ["el monto supera el umbral de aprobación", "el fondo no alcanza."] };
    const out = applyGuard(d, guard);
    expect(out.outcome).toBe("ESCALAR");
    expect(out.guardOverride).toBe(true);
    expect(out.guard).toEqual(guard);
    expect(out.summary).toBe(
      "Se escala a una persona: la guardia independiente no confirmó el pago (el monto supera el umbral de aprobación; el fondo no alcanza).",
    );
    expect(out.humanAction).toMatch(/^Revisar la discrepancia/);
    expect(out.humanAction).toContain("el monto supera el umbral de aprobación");
    // Las comprobaciones y los datos del motor se conservan para la auditoría.
    expect(out.checks).toEqual(d.checks);
    expect(out.amountUsd).toBe(1000);
  });

  it("sin violaciones listadas igual escala con un texto claro", () => {
    const out = applyGuard(decision("PAGAR"), { approved: false, violations: [] });
    expect(out.outcome).toBe("ESCALAR");
    expect(out.summary).toContain("(sin detalle de la guardia)");
  });

  it("un resultado contradictorio (aprueba pero lista violaciones) no deja pagar", () => {
    const out = applyGuard(decision("PAGAR"), { approved: true, violations: ["el fondo no alcanza"] });
    expect(out.outcome).toBe("ESCALAR");
    expect(out.guardOverride).toBe(true);
    expect(out.summary).toBe("Se escala a una persona: la guardia independiente no confirmó el pago (el fondo no alcanza).");
  });

  it("no toca decisiones que no son PAGAR", () => {
    for (const outcome of ["FRENAR", "ESCALAR"] as const) {
      const d = decision(outcome);
      expect(applyGuard(d, { approved: false, violations: ["la decisión no es un pago"] })).toBe(d);
    }
  });
});
