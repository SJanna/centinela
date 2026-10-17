/**
 * Guardia de pagos: segunda implementación independiente de las reglas duras.
 * Toda decisión PAGAR del motor pasa por aquí antes de registrarse; si no aprueba, el pipeline
 * baja la decisión a ESCALAR con `guardOverride: true`.
 */
export { guardPayment, GUARD_MESSAGES } from "./guard";
