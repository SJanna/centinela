/**
 * Validación de la ficha de la empresa para las rutas /api/company/*.
 * Además del esquema (src/core/schemas), rechaza valores que no tienen sentido para las reglas.
 */
import { z } from "zod";
import { RulesSchema, VendorSchema } from "@/core/schemas";

/**
 * Tope de los montos en USD. Más allá, los centavos dejan de ser enteros exactos en coma flotante
 * y la guardia no puede revisar ningún pago (todo quedaría escalado).
 */
const MAX_USD = 1_000_000_000_000;
/** Mismo tope de tolerancia que el motor (MAX_AMOUNT_TOLERANCE_PCT) y la pantalla de reglas. */
const MAX_TOLERANCE_PCT = 100;

const amountUsd = (label: string) =>
  z.number().refine((n) => Number.isFinite(n) && n >= 0 && n <= MAX_USD, {
    message: `${label} debe ser un número entre 0 y ${MAX_USD.toLocaleString("es-CO")}`,
  });

export const RulesInputSchema = RulesSchema.extend({
  approvalThresholdUsd: amountUsd("El umbral de aprobación"),
  periodLimitUsd: amountUsd("El límite del mes"),
  initialFundUsd: amountUsd("El fondo inicial"),
  amountTolerancePct: z.number().refine((n) => Number.isFinite(n) && n >= 0 && n <= MAX_TOLERANCE_PCT, {
    message: `La tolerancia debe ser un porcentaje entre 0 y ${MAX_TOLERANCE_PCT}`,
  }),
  fxToUsd: z
    .record(z.string(), z.number())
    .refine((fx) => Object.keys(fx).every((code) => /^[A-Z]{3}$/.test(code)), {
      message: "Cada moneda debe ser un código de 3 letras en mayúscula, como EUR",
    })
    .refine((fx) => Object.values(fx).every((v) => Number.isFinite(v) && v > 0), {
      message: "Cada tasa de cambio debe ser un número mayor que 0",
    })
    .refine((fx) => fx.USD === 1, { message: "La tasa de USD debe ser 1" }),
});

export const VendorInputSchema = VendorSchema.refine((v) => v.id.trim().length > 0, {
  message: "El proveedor necesita un id",
  path: ["id"],
});

export const VendorListInputSchema = z.array(VendorInputSchema).superRefine((list, ctx) => {
  const seen = new Set<string>();
  list.forEach((v, i) => {
    if (seen.has(v.id)) {
      ctx.addIssue({ code: "custom", message: `El proveedor «${v.id}» aparece más de una vez`, path: [i, "id"] });
    }
    seen.add(v.id);
  });
});
