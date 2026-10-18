/**
 * Contratos centrales. Todos los módulos programan contra estos tipos.
 * Cambiar algo aquí es una decisión de arquitectura: no lo hagas desde un módulo.
 */
import { z } from "zod";

// ───────────────────────── Lectura (lo que devuelve el modelo) ─────────────────────────

/** Un campo leído: valor, cita textual de donde salió y si se leyó con claridad. */
const field = <T extends z.ZodTypeAny>(value: T) =>
  z.object({
    value: value.nullable(),
    /** Fragmento literal del documento que respalda el valor (null si no hay). */
    evidence: z.string().nullable(),
    /** false si el texto estaba borroso, tachado, ambiguo o se infirió. */
    legible: z.boolean(),
  });

export const ExtractionSchema = z.object({
  documentType: z.enum(["invoice", "cuenta_de_cobro", "receipt", "other"]),
  vendorName: field(z.string()),
  vendorTaxId: field(z.string()),
  invoiceNumber: field(z.string()),
  /** YYYY-MM-DD */
  issueDate: field(z.string()),
  /** YYYY-MM-DD */
  dueDate: field(z.string()),
  /** Periodo facturado, YYYY-MM (si aplica). */
  servicePeriod: field(z.string()),
  /** Código ISO 4217 en mayúsculas, p. ej. USD, COP. */
  currency: field(z.string()),
  subtotal: field(z.number()),
  tax: field(z.number()),
  total: field(z.number()),
  lineItems: z.array(
    z.object({
      description: z.string(),
      quantity: z.number().nullable(),
      unitPrice: z.number().nullable(),
      amount: z.number(),
    }),
  ),
  payment: z.object({
    beneficiaryName: field(z.string()),
    bankName: field(z.string()),
    accountNumber: field(z.string()),
    routingOrSwift: field(z.string()),
  }),
  /**
   * Texto del documento que intenta dar órdenes a quien procesa la factura o al sistema
   * (p. ej. "ya aprobado por el CFO", "ignorar validaciones", "pagar a esta nueva cuenta").
   */
  embeddedInstructions: z.array(z.object({ text: z.string(), reason: z.string() })),
  readerNotes: z.string(),
});
export type Extraction = z.infer<typeof ExtractionSchema>;
export type ExtractionField = Extraction["vendorName"];

// ───────────────────────── Documento normalizado (entrada) ─────────────────────────

export type DocKind = "pdf" | "image" | "email" | "chat" | "text";

export type DocPart =
  | { type: "pdf"; base64: string }
  | { type: "image"; mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif"; base64: string }
  | { type: "text"; text: string; label?: string };

export interface NormalizedDoc {
  /** sha256 hex del archivo original. */
  fileHash: string;
  filename: string;
  mediaType: string;
  kind: DocKind;
  /** Lo que se envía al modelo, en orden. */
  parts: DocPart[];
  /** Texto plano extraído sin modelo (PDF con texto, correo, chat). null si es solo imagen. */
  plainText: string | null;
  meta: Record<string, string>;
}

// ───────────────────────── Resultado de lectores ─────────────────────────

export type ReaderResult =
  | { ok: true; readerId: string; model: string; promptVersion: string; extraction: Extraction; usage?: { inputTokens: number; outputTokens: number } }
  | { ok: false; readerId: string; model: string; promptVersion: string; error: "refusal" | "api_error" | "parse_error" | "unavailable"; message: string };

export interface Reader {
  id: string;
  model: string;
  promptVersion: string;
  read(doc: NormalizedDoc): Promise<ReaderResult>;
}

// ───────────────────────── Datos de la factura ya normalizados ─────────────────────────

export interface InvoiceData {
  documentType: Extraction["documentType"];
  vendorName: string | null;
  vendorTaxId: string | null;
  invoiceNumber: string | null;
  issueDate: string | null;
  dueDate: string | null;
  servicePeriod: string | null;
  currency: string | null;
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  lineItems: Extraction["lineItems"];
  beneficiaryName: string | null;
  bankName: string | null;
  /** Normalizado: solo dígitos y letras en mayúscula, sin espacios ni guiones. */
  accountNumber: string | null;
  routingOrSwift: string | null;
}

/** Señales que produce la verificación (código, sin modelo) sobre las lecturas. */
export interface ReadingSignals {
  /** LEC-1: campos críticos ausentes. */
  missingCriticalFields: string[];
  /** LEC-1: campos críticos marcados como ilegibles por el lector. */
  illegibleCriticalFields: string[];
  /** LEC-2: campos críticos en los que las dos lecturas no coinciden. ["segunda_lectura_no_disponible"] si falta. */
  readersDisagreeOn: string[];
  /** LEC-3: problemas aritméticos (líneas ≠ subtotal, subtotal + impuestos ≠ total). */
  arithmeticIssues: string[];
  /** LEC-4: instrucciones detectadas en el documento (por el modelo o por heurística). */
  suspiciousInstructions: { text: string; source: "model" | "heuristic"; reason: string }[];
  /** Citas de evidencia de campos críticos que no aparecen en el texto plano del documento. */
  evidenceNotFound: string[];
  /**
   * LEC-1: el documento es de algo YA PAGADO (un recibo, no un cobro). Una entrada por lectura que lo
   * clasifica como "receipt" (source "model"; text dice qué lectura) y una por cada marca del detector
   * por patrones sobre el texto plano (source "heuristic"; text = la línea del documento, p. ej.
   * «Payment received on 2026-08-10»). Si no está vacía, nunca se paga: LEC-1 escala y la guardia
   * rechaza. La verificación siempre la llena; es opcional solo para leer registros guardados antes de
   * que existiera (la guardia la exige: si falta, las señales están incompletas y no aprueba).
   */
  paidDocumentMarkers?: { text: string; source: "model" | "heuristic"; reason: string }[];
}

export interface ReadingAssessment {
  primary: ReaderResult;
  secondary: ReaderResult | null;
  /** Datos tomados de la lectura principal, normalizados. null si la lectura principal falló. */
  data: InvoiceData | null;
  signals: ReadingSignals;
}

/** Campos críticos: sin ellos (o con duda en ellos) nunca se paga. */
export const CRITICAL_FIELDS = ["vendorName", "invoiceNumber", "currency", "total", "accountNumber"] as const;
export type CriticalField = (typeof CRITICAL_FIELDS)[number];

// ───────────────────────── Datos de la empresa ─────────────────────────

export const AgreementSchema = z.object({
  id: z.string(),
  description: z.string(),
  /** fixed_recurring: monto fijo por periodo · hourly: tarifa × cantidad · one_off: cotización puntual */
  kind: z.enum(["fixed_recurring", "hourly", "one_off"]),
  currency: z.string(),
  /** Monto pactado (fixed_recurring y one_off). */
  amount: z.number().nullable(),
  /** Tarifa por unidad (hourly). */
  rate: z.number().nullable(),
  /** Máximo de unidades por periodo (hourly). */
  maxQuantity: z.number().nullable(),
  frequency: z.enum(["monthly", "once"]),
  /** YYYY-MM-DD */
  validFrom: z.string(),
  /** YYYY-MM-DD o null si no vence. */
  validTo: z.string().nullable(),
});
export type Agreement = z.infer<typeof AgreementSchema>;

export const VendorSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Otros nombres con que puede aparecer en una factura. */
  aliases: z.array(z.string()),
  taxId: z.string().nullable(),
  country: z.string(),
  account: z.object({
    beneficiaryName: z.string(),
    bankName: z.string(),
    accountNumber: z.string(),
    routingOrSwift: z.string().nullable(),
  }),
  agreements: z.array(AgreementSchema),
});
export type Vendor = z.infer<typeof VendorSchema>;

export const RulesSchema = z.object({
  /** Por encima de este monto (USD) siempre se escala a una persona. */
  approvalThresholdUsd: z.number(),
  /** Máximo a pagar por mes calendario (USD). */
  periodLimitUsd: z.number(),
  /** Fondo inicial con el que trabaja el agente (USD). Lo disponible = inicial − pagado. */
  initialFundUsd: z.number(),
  /** Tolerancia del monto contra el acuerdo, en porcentaje (1 = ±1 %). */
  amountTolerancePct: z.number(),
  /** Tasas fijas: cuántos USD vale 1 unidad de cada moneda. USD = 1. */
  fxToUsd: z.record(z.string(), z.number()),
});
export type Rules = z.infer<typeof RulesSchema>;

export const CompanySchema = z.object({
  name: z.string(),
  rules: RulesSchema,
  vendors: z.array(VendorSchema),
});
export type Company = z.infer<typeof CompanySchema>;

// ───────────────────────── Decisión ─────────────────────────

export type Outcome = "PAGAR" | "FRENAR" | "ESCALAR";

/** Una decisión anterior, tal como la necesitan el motor y la guardia. */
export interface HistoryEntry {
  invoiceId: string;
  fileHash: string;
  outcome: Outcome;
  vendorId: string | null;
  invoiceNumber: string | null;
  agreementId: string | null;
  /** YYYY-MM al que se imputa el pago del acuerdo (servicePeriod o mes de emisión). */
  agreementPeriod: string | null;
  amountUsd: number | null;
  /** ISO 8601 */
  decidedAt: string;
  /** Fecha de emisión leída de la factura (YYYY-MM-DD), si la trae. Opcional: historiales viejos no la tienen. */
  issueDate?: string | null;
}

export interface DecisionContext {
  company: Company;
  /** Solo decisiones anteriores a esta factura, en orden. */
  history: HistoryEntry[];
  /**
   * ISO 8601. Su fecha tal como está escrita (YYYY-MM-DD, sin convertir de zona horaria) define el
   * mes calendario de LIM-2; si trae zona horaria y en UTC cae en otro mes, un pago del historial
   * cuenta para el límite si cae en cualquiera de los dos (según su día escrito o su día en UTC):
   * ante la duda se suma de más. Si la factura NO trae fecha de emisión (issueDate ausente), esa misma
   * fecha es la fecha de referencia del acuerdo: con ella se revisa la vigencia (ACU-1) y, si
   * tampoco hay servicePeriod, su mes es el periodo facturado. Una fecha de emisión presente pero
   * inválida no se reemplaza por esta: deja el acuerdo sin evaluar. Motor y guardia hacen lo mismo.
   */
  now: string;
}

export interface EngineInput {
  invoiceId: string;
  fileHash: string;
  reading: ReadingAssessment;
}

export type CheckCode =
  | "LEC-1" | "LEC-2" | "LEC-3" | "LEC-4"
  | "DUP-1" | "DUP-2" | "DUP-3"
  | "PRV-1" | "PRV-2"
  | "ACU-1" | "ACU-2" | "ACU-3"
  | "LIM-1" | "LIM-2" | "FON-1";

export interface CheckResult {
  code: CheckCode;
  /** pass = cumple; fail = no cumple (produce outcomeIfFail); not_evaluable = faltan datos (produce ESCALAR). */
  status: "pass" | "fail" | "not_evaluable";
  /** Qué produce si status = "fail" (viene del catálogo). Si status = "not_evaluable" produce ESCALAR. */
  outcomeIfFail: Exclude<Outcome, "PAGAR">;
  /** Explicación en español, con los valores concretos. Se muestra tal cual al usuario. */
  explanation: string;
  /** Valores usados, para auditoría y para la pantalla. */
  params: Record<string, string | number | boolean | null>;
}

export interface GuardResult {
  /** true si la guardia está de acuerdo con pagar. */
  approved: boolean;
  /** Reglas duras que la guardia considera violadas (vacío si approved). */
  violations: string[];
}

export interface Decision {
  invoiceId: string;
  outcome: Outcome;
  /** Todas las comprobaciones, en el orden del catálogo. Siempre 15. */
  checks: CheckResult[];
  /** Una frase que resume por qué (generada con plantilla). */
  summary: string;
  /** Qué debe revisar una persona (solo ESCALAR; null en otro caso). */
  humanAction: string | null;
  vendorId: string | null;
  agreementId: string | null;
  agreementPeriod: string | null;
  amountUsd: number | null;
  /** Resultado de la guardia. null si la decisión del motor no fue PAGAR (la guardia solo revisa pagos). */
  guard: GuardResult | null;
  /** true si la guardia contradijo al motor y la decisión se bajó a ESCALAR. */
  guardOverride: boolean;
}

/** Registro inmutable de una decisión: lo que se guarda y se exporta. */
export interface DecisionRecord {
  id: string;
  invoiceId: string;
  decidedAt: string;
  filename: string;
  fileHash: string;
  decision: Decision;
  reading: ReadingAssessment;
  /** Copia de las reglas y proveedores usados (para poder explicar después aunque cambien). */
  companySnapshot: Company;
  versions: { app: string; promptVersion: string; models: string[] };
  /** "live" = modelos reales; "cache" = respuestas guardadas; "simulated" = lectura simulada desde el dataset. */
  readingMode: "live" | "cache" | "simulated";
}
