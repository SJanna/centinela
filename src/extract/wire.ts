/**
 * Formato «de cable» que se le pide al modelo en la salida estructurada.
 *
 * La API limita los esquemas a 16 parámetros con tipos unión (nullable / anyOf), y `Extraction`
 * tiene 32 (con el destinatario: billToName y billToTaxId). Por eso el modelo responde SIN uniones: los datos ausentes viajan como texto vacío con
 * `found: false`, y los montos como texto decimal ("12000000", "1200.50"). Este módulo convierte esa
 * respuesta en `Extraction`, que es lo que usa el resto del sistema.
 *
 * Seguridad: un monto que no se puede interpretar nunca se adivina. Queda como dato ausente e
 * ilegible, y la verificación escala la factura (LEC-1). Una línea con monto ilegible invalida la
 * lectura completa (se registra como error de lectura, que también escala).
 */
import { z } from "zod";
import type { Extraction } from "../core/schemas";

const wireField = z.object({
  /** false si el dato no aparece en el documento. */
  found: z.boolean(),
  /** El dato como texto. "" si no aparece. Montos: decimal con punto, sin separadores de miles. */
  value: z.string(),
  /** Cita literal del documento. "" si no hay nada que citar. */
  evidence: z.string(),
  legible: z.boolean(),
});
type WireField = z.infer<typeof wireField>;

export const WireExtractionSchema = z.object({
  documentType: z.enum(["invoice", "cuenta_de_cobro", "receipt", "other"]),
  vendorName: wireField,
  vendorTaxId: wireField,
  /** A quién va dirigida la factura (el cliente). found false si el documento no lo dice. */
  billToName: wireField,
  /** Id tributario del destinatario, sin la etiqueta. */
  billToTaxId: wireField,
  invoiceNumber: wireField,
  issueDate: wireField,
  dueDate: wireField,
  servicePeriod: wireField,
  currency: wireField,
  subtotal: wireField,
  tax: wireField,
  total: wireField,
  lineItems: z.array(
    z.object({
      description: z.string(),
      /** "" si la línea no muestra cantidad. */
      quantity: z.string(),
      /** "" si la línea no muestra precio unitario. */
      unitPrice: z.string(),
      amount: z.string(),
    }),
  ),
  payment: z.object({
    beneficiaryName: wireField,
    bankName: wireField,
    accountNumber: wireField,
    routingOrSwift: wireField,
  }),
  embeddedInstructions: z.array(z.object({ text: z.string(), reason: z.string() })),
  readerNotes: z.string(),
});
export type WireExtraction = z.infer<typeof WireExtractionSchema>;

/** Decimal estricto: "1200", "-3", "9500.5". Nada de comas, espacios, símbolos ni notación científica. */
const STRICT_DECIMAL = /^-?\d+(\.\d+)?$/;

export function parseWireNumber(raw: string): number | null {
  const v = raw.trim();
  if (!STRICT_DECIMAL.test(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function evidenceOf(f: WireField): string | null {
  const e = f.evidence.trim();
  return e === "" ? null : e;
}

function textField(f: WireField): Extraction["vendorName"] {
  const v = f.value.trim();
  return { value: f.found && v !== "" ? v : null, evidence: evidenceOf(f), legible: f.legible };
}

function numberField(f: WireField, name: string, notes: string[]): Extraction["total"] {
  const v = f.value.trim();
  if (!f.found || v === "") return { value: null, evidence: evidenceOf(f), legible: f.legible };
  const n = parseWireNumber(v);
  if (n == null) {
    notes.push(`El valor de ${name} («${v.slice(0, 40)}») no es un número válido; se tomó como no leído.`);
    return { value: null, evidence: evidenceOf(f), legible: false };
  }
  return { value: n, evidence: evidenceOf(f), legible: f.legible };
}

function optionalNumber(raw: string): number | null | "invalid" {
  if (raw.trim() === "") return null;
  return parseWireNumber(raw) ?? "invalid";
}

export type WireConversion = { ok: true; extraction: Extraction } | { ok: false; message: string };

/** Convierte la respuesta del modelo en `Extraction`. */
export function wireToExtraction(w: WireExtraction): WireConversion {
  const notes: string[] = [];
  const lineItems: Extraction["lineItems"] = [];
  for (const [i, line] of w.lineItems.entries()) {
    const amount = parseWireNumber(line.amount);
    if (amount == null) {
      return { ok: false, message: `La línea ${i + 1} trae un monto que no es un número válido («${line.amount.slice(0, 40)}»).` };
    }
    const quantity = optionalNumber(line.quantity);
    const unitPrice = optionalNumber(line.unitPrice);
    if (quantity === "invalid" || unitPrice === "invalid") {
      return { ok: false, message: `La línea ${i + 1} trae una cantidad o un precio unitario que no es un número válido.` };
    }
    lineItems.push({ description: line.description, quantity, unitPrice, amount });
  }

  const extraction: Extraction = {
    documentType: w.documentType,
    vendorName: textField(w.vendorName),
    vendorTaxId: textField(w.vendorTaxId),
    billToName: textField(w.billToName),
    billToTaxId: textField(w.billToTaxId),
    invoiceNumber: textField(w.invoiceNumber),
    issueDate: textField(w.issueDate),
    dueDate: textField(w.dueDate),
    servicePeriod: textField(w.servicePeriod),
    currency: textField(w.currency),
    subtotal: numberField(w.subtotal, "subtotal", notes),
    tax: numberField(w.tax, "impuestos", notes),
    total: numberField(w.total, "total", notes),
    lineItems,
    payment: {
      beneficiaryName: textField(w.payment.beneficiaryName),
      bankName: textField(w.payment.bankName),
      accountNumber: textField(w.payment.accountNumber),
      routingOrSwift: textField(w.payment.routingOrSwift),
    },
    embeddedInstructions: w.embeddedInstructions,
    readerNotes: [w.readerNotes.trim(), ...notes].filter((s) => s !== "").join(" "),
  };
  return { ok: true, extraction };
}

/** Inversa (para pruebas y dobles): `Extraction` → formato de cable. */
export function extractionToWire(e: Extraction): WireExtraction {
  const t = (f: Extraction["vendorName"] | undefined): WireField =>
    f == null
      ? { found: false, value: "", evidence: "", legible: true }
      : { found: f.value != null, value: f.value ?? "", evidence: f.evidence ?? "", legible: f.legible };
  const n = (f: Extraction["total"]): WireField => ({
    found: f.value != null,
    value: f.value == null ? "" : String(f.value),
    evidence: f.evidence ?? "",
    legible: f.legible,
  });
  return {
    documentType: e.documentType,
    vendorName: t(e.vendorName),
    vendorTaxId: t(e.vendorTaxId),
    billToName: t(e.billToName),
    billToTaxId: t(e.billToTaxId),
    invoiceNumber: t(e.invoiceNumber),
    issueDate: t(e.issueDate),
    dueDate: t(e.dueDate),
    servicePeriod: t(e.servicePeriod),
    currency: t(e.currency),
    subtotal: n(e.subtotal),
    tax: n(e.tax),
    total: n(e.total),
    lineItems: e.lineItems.map((l) => ({
      description: l.description,
      quantity: l.quantity == null ? "" : String(l.quantity),
      unitPrice: l.unitPrice == null ? "" : String(l.unitPrice),
      amount: String(l.amount),
    })),
    payment: {
      beneficiaryName: t(e.payment.beneficiaryName),
      bankName: t(e.payment.bankName),
      accountNumber: t(e.payment.accountNumber),
      routingOrSwift: t(e.payment.routingOrSwift),
    },
    embeddedInstructions: e.embeddedInstructions,
    readerNotes: e.readerNotes,
  };
}
