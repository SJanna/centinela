/**
 * Doble control de pagos (invariante 3 de CLAUDE.md): toda decisión PAGAR del motor pasa por la
 * guardia; si la guardia no aprueba, la decisión final es ESCALAR con `guardOverride: true`.
 */
import { guardPayment } from "../guard";
import { decide } from "../engine";
import type { Decision, DecisionContext, EngineInput, GuardResult } from "../core/schemas";

function violationsText(guard: GuardResult): string {
  const list = (Array.isArray(guard?.violations) ? guard.violations : []).map((v) => String(v).trim().replace(/\.+$/, "")).filter(Boolean);
  return list.length > 0 ? list.join("; ") : "sin detalle de la guardia";
}

/**
 * Aplica el resultado de la guardia a una decisión PAGAR del motor.
 * - Si la guardia no aprueba: ESCALAR, `guardOverride: true`, resumen y acción con las violaciones.
 * - Si aprueba: la misma decisión con el resultado de la guardia guardado.
 * Aprobar exige `approved: true` y ninguna violación: un resultado contradictorio (aprueba pero
 * lista violaciones) cuenta como no aprobado. Por defecto no se paga.
 * Una decisión que no es PAGAR se devuelve sin cambios (la guardia solo revisa pagos).
 */
export function applyGuard(decision: Decision, guard: GuardResult): Decision {
  if (decision.outcome !== "PAGAR") return decision;
  const approved = guard?.approved === true && Array.isArray(guard.violations) && guard.violations.length === 0;
  if (approved) return { ...decision, guard, guardOverride: false };
  const violations = violationsText(guard);
  return {
    ...decision,
    outcome: "ESCALAR",
    guard,
    guardOverride: true,
    summary: `Se escala a una persona: la guardia independiente no confirmó el pago (${violations}).`,
    humanAction:
      `Revisar la discrepancia entre el motor y la guardia: el motor aprobaba el pago, pero la guardia encontró: ${violations}. ` +
      "Confirmar a mano esos datos de la factura, el proveedor y los límites antes de pagar.",
  };
}

/** Motor + guardia: la decisión final de una factura (función pura). */
export function decideWithGuard(input: EngineInput, ctx: DecisionContext): Decision {
  const decision = decide(input, ctx);
  if (decision.outcome !== "PAGAR") return decision;
  return applyGuard(decision, guardPayment(input, ctx, decision));
}
