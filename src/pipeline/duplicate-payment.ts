/**
 * Pago doble entre instancias. El candado de `processInvoice` es por proceso; si otro proceso registra
 * un pago equivalente entre la lectura del historial y la inserción, la base lo rechaza
 * (DuplicatePaymentError). `processInvoice` vuelve a decidir una vez con el historial fresco; si la
 * base vuelve a rechazar el pago, la decisión se baja a ESCALAR con esta plantilla.
 */
import type { CheckCode, CheckResult, Decision } from "../core/schemas";
import type { DuplicatePaymentError, PaymentKeyKind } from "../store";

/** Comprobación del motor que cubre cada clave de pago. */
const CHECK_FOR_KEY: Record<PaymentKeyKind, CheckCode> = { file: "DUP-1", invoice: "DUP-2", period: "DUP-3" };

const SAME_WHAT: Record<PaymentKeyKind | "unknown", string> = {
  file: "el mismo archivo",
  invoice: "el mismo proveedor y número de factura",
  period: "el mismo acuerdo y periodo",
  unknown: "los mismos datos de pago",
};

/**
 * Decisión ESCALAR para un PAGAR que la base rechazó por pago doble. La comprobación que cubre esa
 * clave queda «not_evaluable» con la explicación (así la decisión cumple la invariante 2: no todas
 * pasan); las demás quedan como las dejó el motor. No es un desacuerdo de la guardia.
 */
export function escalateDuplicatePayment(decision: Decision, err: Pick<DuplicatePaymentError, "kind" | "conflictingInvoiceId">): Decision {
  const what = SAME_WHAT[err.kind ?? "unknown"];
  const other = err.conflictingInvoiceId ? ` (factura ${err.conflictingInvoiceId})` : "";
  const code = err.kind ? CHECK_FOR_KEY[err.kind] : null;
  const checks = decision.checks.map(
    (c): CheckResult =>
      c.code !== code
        ? c
        : {
            ...c,
            status: "not_evaluable",
            explanation:
              `Al registrar el pago, la base de datos encontró otro pago con ${what}${other} que el historial ` +
              "leído no mostraba; no se puede descartar un pago doble.",
            params: { ...c.params, registryConflict: true, conflictingInvoiceId: err.conflictingInvoiceId ?? null },
          },
  );
  return {
    ...decision,
    outcome: "ESCALAR",
    checks,
    guardOverride: false,
    summary: `Se escala a una persona: la base de datos rechazó el pago porque ya hay otro registrado con ${what}${other}.`,
    humanAction:
      `Comparar esta factura con el pago ya registrado${other}: tienen ${what}. ` +
      "Si es la misma factura, no pagarla; si no lo es, confirmarlo con el proveedor antes de pagar.",
  };
}

/** Comprobaciones que suman pagos distintos: las que quedan sin base si entró otro pago mientras se decidía. */
const SUM_CHECKS: readonly CheckCode[] = ["LIM-2", "FON-1"];

/**
 * Decisión ESCALAR para un PAGAR que la base rechazó dos veces porque, entre la lectura del historial
 * y la inserción, se registró otro pago. El límite del mes (LIM-2) y el fondo (FON-1) quedan
 * «not_evaluable» con la explicación; las demás quedan como las dejó el motor. No es un desacuerdo de
 * la guardia.
 */
export function escalatePaymentHistoryChanged(decision: Decision): Decision {
  const checks = decision.checks.map(
    (c): CheckResult =>
      !SUM_CHECKS.includes(c.code)
        ? c
        : {
            ...c,
            status: "not_evaluable",
            explanation:
              "Al registrar el pago, la base de datos encontró pagos registrados mientras se decidía que el historial " +
              "leído no mostraba; no se puede confirmar el límite del mes ni el fondo disponible.",
            params: { ...c.params, registryConflict: true },
          },
  );
  return {
    ...decision,
    outcome: "ESCALAR",
    checks,
    guardOverride: false,
    summary: "Se escala a una persona: mientras se decidía se registraron otros pagos y no se pudo confirmar el límite del mes ni el fondo.",
    humanAction: "Revisar los pagos registrados del mes y el fondo disponible antes de aprobar esta factura.",
  };
}
