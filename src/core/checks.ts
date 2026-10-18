/**
 * Catálogo de comprobaciones. El orden de este arreglo es el orden en que se evalúan,
 * se registran y se muestran. Regla de decisión:
 *   alguna FRENAR → FRENAR · si no, alguna ESCALAR → ESCALAR · si no → PAGAR.
 * Una comprobación "fail" produce su outcomeIfFail. Una "not_evaluable" (faltan datos)
 * produce SIEMPRE ESCALAR: nunca se paga sin evaluar, y una persona puede completar el dato.
 */
import type { CheckCode, Outcome } from "./schemas";

export interface CheckDefinition {
  code: CheckCode;
  group: "Lectura" | "Duplicados" | "Proveedor" | "Acuerdo" | "Límites" | "Fondo";
  /** Nombre corto para la pantalla. */
  title: string;
  /** Qué revisa, en una frase para cualquier persona. */
  description: string;
  outcomeIfFail: Exclude<Outcome, "PAGAR">;
}

export const CHECK_CATALOG: readonly CheckDefinition[] = [
  { code: "LEC-1", group: "Lectura", title: "Datos completos y legibles", description: "Es un cobro, no un recibo de algo ya pagado; trae legibles el proveedor, el número, la moneda, el total y la cuenta destino; y del correo se leyó todo lo que ve una persona (la versión HTML dice lo mismo que el texto, no hay adjuntos sin leer ni texto que se vea distinto de como se lee).", outcomeIfFail: "ESCALAR" },
  { code: "LEC-2", group: "Lectura", title: "Dos lecturas coinciden", description: "Dos lecturas independientes de la factura coinciden en los datos críticos.", outcomeIfFail: "ESCALAR" },
  { code: "LEC-3", group: "Lectura", title: "Las cuentas cuadran", description: "Las líneas suman el subtotal y subtotal más impuestos da el total.", outcomeIfFail: "ESCALAR" },
  { code: "LEC-4", group: "Lectura", title: "Sin instrucciones escondidas", description: "El documento no contiene texto que intente dar órdenes al sistema o a quien paga.", outcomeIfFail: "ESCALAR" },
  { code: "DUP-1", group: "Duplicados", title: "Archivo nuevo", description: "Este mismo archivo no se había procesado antes.", outcomeIfFail: "FRENAR" },
  { code: "DUP-2", group: "Duplicados", title: "Número de factura nuevo", description: "No hay otra factura pagada del mismo proveedor con el mismo número.", outcomeIfFail: "FRENAR" },
  { code: "DUP-3", group: "Duplicados", title: "Periodo no pagado", description: "El periodo de este acuerdo no se ha pagado ya.", outcomeIfFail: "FRENAR" },
  { code: "PRV-1", group: "Proveedor", title: "Proveedor registrado", description: "Quien cobra está en la ficha de proveedores de la empresa.", outcomeIfFail: "ESCALAR" },
  { code: "PRV-2", group: "Proveedor", title: "Cuenta destino registrada", description: "La cuenta a la que se pide pagar es la registrada para ese proveedor.", outcomeIfFail: "ESCALAR" },
  { code: "ACU-1", group: "Acuerdo", title: "Acuerdo vigente", description: "Hay un acuerdo vigente entre el proveedor y nuestra empresa para la fecha de la factura, y la factura está dirigida a nuestra empresa (si dice a quién va dirigida: razón social e id tributario).", outcomeIfFail: "ESCALAR" },
  { code: "ACU-2", group: "Acuerdo", title: "Moneda pactada", description: "La factura viene en la moneda del acuerdo.", outcomeIfFail: "ESCALAR" },
  { code: "ACU-3", group: "Acuerdo", title: "Monto pactado", description: "El monto está dentro de lo pactado (con la tolerancia definida, o tarifa × cantidad).", outcomeIfFail: "ESCALAR" },
  { code: "LIM-1", group: "Límites", title: "Bajo el umbral de aprobación", description: "El monto no supera el umbral a partir del cual decide una persona.", outcomeIfFail: "ESCALAR" },
  { code: "LIM-2", group: "Límites", title: "Dentro del límite del mes", description: "Lo pagado este mes más este monto no supera el límite mensual.", outcomeIfFail: "ESCALAR" },
  { code: "FON-1", group: "Fondo", title: "Hay fondo disponible", description: "El fondo disponible del agente alcanza para este pago.", outcomeIfFail: "FRENAR" },
] as const;

export const CHECK_BY_CODE: Record<CheckCode, CheckDefinition> = Object.fromEntries(
  CHECK_CATALOG.map((c) => [c.code, c]),
) as Record<CheckCode, CheckDefinition>;

export const OUTCOME_LABEL: Record<Outcome, string> = {
  PAGAR: "Pagar",
  FRENAR: "Frenar",
  ESCALAR: "Escalar",
};
