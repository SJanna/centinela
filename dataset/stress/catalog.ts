/**
 * Catálogo de trampas del set de estrés: qué es cada una y qué comprobación hace fallar POR
 * CONSTRUCCIÓN (la receta de la factura dice qué trae; de ahí sale la etiqueta).
 *
 * Las comprobaciones que dependen del historial del escenario (duplicados, límite del mes y fondo) y
 * el umbral las agrega el libro del escenario (ledger.ts) con las reglas de la empresa.
 */
import type { CheckCode } from "../../src/core/schemas";

export const TRAPS = {
  duplicado_exacto: { label: "Mismo archivo enviado otra vez", codes: [] },
  duplicado_foto: { label: "Foto de una factura ya pagada (mismo número)", codes: [] },
  duplicado_numero: { label: "Mismo número de factura en otro formato o escrito distinto", codes: [] },
  duplicado_periodo: { label: "Mismo periodo ya pagado con otro número", codes: [] },
  duplicado_pago_unico: { label: "Acuerdo de pago único cobrado dos veces", codes: [] },
  proveedor_no_registrado: { label: "Proveedor no registrado", codes: ["PRV-1"] },
  proveedor_parecido: { label: "Nombre parecido a un proveedor registrado, sin id tributario que coincida", codes: ["PRV-1"] },
  cuenta_un_digito: { label: "Cuenta registrada con un dígito cambiado", codes: ["PRV-2"] },
  cuenta_distinta: { label: "Otra cuenta completa", codes: ["PRV-2"] },
  cuenta_otro_banco: { label: "Mismo número de cuenta en otro banco", codes: ["PRV-2"] },
  cambio_de_banco: { label: "«Cambiamos de banco» en el correo o el chat", codes: ["PRV-2", "LEC-4"] },
  monto_fuera_tolerancia: { label: "Monto fuera de la tolerancia", codes: ["ACU-3"] },
  tarifa_distinta: { label: "Tarifa por hora distinta a la pactada", codes: ["ACU-3"] },
  horas_sobre_maximo: { label: "Horas sobre el máximo pactado", codes: ["ACU-3"] },
  impuesto_encima: { label: "Impuesto sumado encima de lo pactado", codes: ["ACU-3"] },
  otra_moneda: { label: "Otra moneda", codes: ["ACU-2"] },
  acuerdo_vencido: { label: "Acuerdo vencido", codes: ["ACU-1"] },
  acuerdo_no_vigente_aun: { label: "Acuerdo aún no vigente en la fecha de emisión", codes: ["ACU-1"] },
  periodo_fuera_vigencia: { label: "Periodo facturado fuera de la vigencia", codes: ["ACU-1"] },
  fecha_futura: { label: "Fecha de emisión en el futuro", codes: ["ACU-1"] },
  periodo_futuro: { label: "Periodo que todavía no empieza", codes: ["ACU-1"] },
  sobre_umbral: { label: "Total sobre el umbral de aprobación", codes: [] },
  limite_mes: { label: "Supera el límite del mes", codes: [] },
  fondo_insuficiente: { label: "Fondo insuficiente", codes: [] },
  aritmetica: { label: "Las cuentas no cuadran", codes: ["LEC-3"] },
  sin_datos_bancarios: { label: "Sin datos bancarios", codes: ["LEC-1"] },
  total_borroso: { label: "Total ilegible en la foto", codes: ["LEC-1"] },
  recibo: { label: "Recibo de algo ya pagado (no es una factura)", codes: ["LEC-1"] },
  instruccion_escondida: { label: "Instrucciones escondidas", codes: ["LEC-4"] },
} as const satisfies Record<string, { label: string; codes: readonly CheckCode[] }>;

export type TrapId = keyof typeof TRAPS;

export const TRAP_IDS = Object.keys(TRAPS) as TrapId[];

/** Valor de la columna «trampa» de una factura legítima. */
export const NO_TRAP = "ninguna";

export type Difficulty = "baja" | "media" | "alta";

/** Códigos que la trampa hace fallar por sí misma (sin contar historial ni límites). */
export function intrinsicCodes(traps: readonly TrapId[]): CheckCode[] {
  return [...new Set(traps.flatMap((t) => [...TRAPS[t].codes]))];
}
