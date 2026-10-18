/**
 * Datos de prueba para src/extract (y para quien necesite una Extraction válida en sus pruebas).
 */
import type { Extraction, NormalizedDoc, Reader, ReaderResult } from "../core/schemas";

type Field<T> = { value: T | null; evidence: string | null; legible: boolean };

export function field<T>(value: T | null, evidence: string | null = value == null ? null : String(value), legible = true): Field<T> {
  return { value, evidence, legible };
}

/** Plain text de una factura coherente con makeExtraction(). */
export const SAMPLE_INVOICE_TEXT = [
  "FACTURA DE VENTA N.º DS-0458",
  "Datos del Sur S.A.S. — NIT 901.234.567-8",
  "Fecha de emisión: 2026-10-15   Vencimiento: 2026-10-30",
  "Periodo: octubre 2026",
  "Concepto                 Cantidad   Valor unitario   Valor",
  "Análisis de datos (horas)    40      USD 60,00        USD 2.400,00",
  "Subtotal: USD 2.400,00",
  "IVA: USD 0,00",
  "Total a pagar: USD 2.400,00",
  "Favor consignar a: Banco de Bogotá — Cuenta corriente 0012-3456-78",
  "Beneficiario: Datos del Sur S.A.S.",
].join("\n");

/** Lectura completa y coherente (40 h × USD 60 = USD 2.400). */
export function makeExtraction(overrides: Partial<Extraction> = {}): Extraction {
  const base: Extraction = {
    documentType: "invoice",
    vendorName: field("Datos del Sur S.A.S.", "Datos del Sur S.A.S."),
    vendorTaxId: field("901.234.567-8", "NIT 901.234.567-8"),
    // El texto de ejemplo no dice a quién va dirigida la factura (como muchos correos y chats).
    billToName: field<string>(null),
    billToTaxId: field<string>(null),
    invoiceNumber: field("DS-0458", "FACTURA DE VENTA N.º DS-0458"),
    issueDate: field("2026-10-15", "Fecha de emisión: 2026-10-15"),
    dueDate: field("2026-10-30", "Vencimiento: 2026-10-30"),
    servicePeriod: field("2026-10", "Periodo: octubre 2026"),
    currency: field("USD", "USD"),
    subtotal: field(2400, "Subtotal: USD 2.400,00"),
    tax: field(0, "IVA: USD 0,00"),
    total: field(2400, "Total a pagar: USD 2.400,00"),
    lineItems: [{ description: "Análisis de datos (horas)", quantity: 40, unitPrice: 60, amount: 2400 }],
    payment: {
      beneficiaryName: field("Datos del Sur S.A.S.", "Beneficiario: Datos del Sur S.A.S."),
      bankName: field("Banco de Bogotá", "Banco de Bogotá"),
      accountNumber: field("0012-3456-78", "Cuenta corriente 0012-3456-78"),
      routingOrSwift: field<string>(null),
    },
    embeddedInstructions: [],
    readerNotes: "",
  };
  return { ...base, ...overrides };
}

export function makeDoc(overrides: Partial<NormalizedDoc> = {}): NormalizedDoc {
  return {
    fileHash: "a".repeat(64),
    filename: "factura.pdf",
    mediaType: "application/pdf",
    kind: "pdf",
    parts: [{ type: "pdf", base64: "JVBERi0xLjQK" }],
    plainText: SAMPLE_INVOICE_TEXT,
    meta: {},
    ...overrides,
  };
}

export function okResult(extraction: Extraction, readerId = "principal", model = "modelo-a"): ReaderResult {
  return { ok: true, readerId, model, promptVersion: "v1", extraction };
}

export function failResult(
  error: "refusal" | "api_error" | "parse_error" | "unavailable" = "api_error",
  readerId = "segunda",
  model = "modelo-b",
): ReaderResult {
  return { ok: false, readerId, model, promptVersion: "v1", error, message: "falló" };
}

/** Lector falso que devuelve siempre el mismo resultado y cuenta las llamadas. */
export function fakeReader(result: ReaderResult | (() => Promise<ReaderResult>), id = "falso", model = "modelo-falso"): Reader & { calls: number } {
  const reader = {
    id,
    model,
    promptVersion: "v1",
    calls: 0,
    async read() {
      reader.calls += 1;
      return typeof result === "function" ? result() : result;
    },
  };
  return reader;
}
