/**
 * Validación de la ficha de la empresa para las rutas /api/company/*.
 * Además del esquema (src/core/schemas), rechaza valores que no tienen sentido para las reglas.
 */
import { z } from "zod";
import { RulesSchema, VendorSchema } from "@/core/schemas";

const nonNegative = (label: string) =>
  z.number().refine((n) => Number.isFinite(n) && n >= 0, { message: `${label} debe ser un número mayor o igual a 0` });

export const RulesInputSchema = RulesSchema.extend({
  approvalThresholdUsd: nonNegative("El umbral de aprobación"),
  periodLimitUsd: nonNegative("El límite del mes"),
  initialFundUsd: nonNegative("El fondo inicial"),
  amountTolerancePct: nonNegative("La tolerancia"),
  fxToUsd: z
    .record(z.string(), z.number())
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
