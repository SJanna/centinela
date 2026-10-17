/**
 * Esquema de las specs del dataset (dataset/specs/<ID>.json).
 *
 * Una spec describe el contenido REAL de un documento de prueba: quién lo emite, qué cobra,
 * cómo se ve (plantilla, idioma, formato local de montos) y qué trampas trae (nota visible,
 * texto oculto, total borroso, correo, chat…). El generador la convierte en un archivo y en la
 * lectura «perfecta» (groundTruth) que se guarda en el manifiesto.
 *
 * Hay tres tipos de spec:
 * - DocumentSpec: un documento completo.
 * - CopySpec (copyOf): el mismo archivo que otro caso, byte a byte (B07 = B02).
 * - PhotoOfSpec (photoOf): una foto del documento de otro caso (H03 = foto de H01).
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { currencyDecimals } from "./format";

export const FORMATS = ["pdf", "png", "jpg", "eml", "txt"] as const;
export type Format = (typeof FORMATS)[number];

/** Plantillas visuales (pdf/png/jpg y adjuntos PDF de correos). */
export const TEMPLATES = ["saas", "latam", "cuenta_cobro", "nota_servico", "portal"] as const;
export type TemplateKind = (typeof TEMPLATES)[number];

/** Formato local de montos y fechas del documento. */
export const LOCALES = ["es-CO", "es-MX", "es-PE", "es-CL", "es-AR", "pt-BR", "en-US"] as const;
export type Locale = (typeof LOCALES)[number];

/** Logos hechos con formas simples. */
export const LOGOS = ["bars", "peak", "orbit", "monogram", "cactus", "check", "sun", "wave", "dots", "pillar", "tree"] as const;
export type LogoKind = (typeof LOGOS)[number];

/** Campos de la lectura que llevan cita textual (evidence). */
export const EVIDENCE_KEYS = [
  "vendorName",
  "vendorTaxId",
  "invoiceNumber",
  "issueDate",
  "dueDate",
  "servicePeriod",
  "currency",
  "subtotal",
  "tax",
  "total",
  "beneficiaryName",
  "bankName",
  "accountNumber",
  "routingOrSwift",
] as const;
export type EvidenceKey = (typeof EVIDENCE_KEYS)[number];
export type EvidenceMap = Partial<Record<EvidenceKey, string>>;

/** true si "YYYY-MM-DD" es un día que existe (2026-02-30 no). */
function isCalendarDate(s: string): boolean {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "fecha YYYY-MM-DD")
  .refine(isCalendarDate, "fecha YYYY-MM-DD que no existe en el calendario");
const isoMonth = z
  .string()
  .regex(/^\d{4}-\d{2}$/, "periodo YYYY-MM")
  .refine((s) => isCalendarDate(`${s}-01`), "periodo YYYY-MM con un mes que no existe");
/** Ids del dataset base («B01») y del set de estrés de dataset/stress («S0001»). */
const caseId = z.string().regex(/^(?:[A-Z]\d{2}|S\d{4})$/, "id de caso tipo B01 (o S0001 en el set de estrés)");

export const PartySchema = z.strictObject({
  name: z.string().min(1),
  taxIdLabel: z.string().nullable(),
  taxId: z.string().nullable(),
  address: z.array(z.string()),
  email: z.string().nullable(),
  phone: z.string().nullable(),
});
export type Party = z.infer<typeof PartySchema>;

export const BrandSchema = z.strictObject({
  /** Color principal (#RRGGBB). */
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  /** Color secundario opcional (#RRGGBB). */
  accent: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable(),
  logo: z.enum(LOGOS),
  /** Iniciales para logos tipo monograma. */
  initials: z.string().nullable(),
  /** Nombre corto que se dibuja junto al logo (p. ej. "CloudMetrics"). */
  wordmark: z.string(),
  /** Frase corta bajo el nombre (opcional). */
  tagline: z.string().nullable(),
});
export type Brand = z.infer<typeof BrandSchema>;

export const LineSchema = z.strictObject({
  description: z.string().min(1),
  /** Texto secundario bajo la descripción (no forma parte de la lectura). */
  detail: z.string().nullable(),
  quantity: z.number().nullable(),
  /** Unidad que se muestra junto a la cantidad ("h", "seats"…). */
  unit: z.string().nullable(),
  unitPrice: z.number().nullable(),
  amount: z.number(),
});
export type LineSpec = z.infer<typeof LineSchema>;

export const TaxSchema = z.strictObject({
  /** Rótulo tal como aparece ("IVA 19 %", "Sales tax (0%)"…). */
  label: z.string(),
  amount: z.number(),
});

export const PaymentSchema = z.strictObject({
  beneficiaryName: z.string(),
  bankName: z.string(),
  /** Tal como aparece en el documento (con espacios o guiones si el documento los trae). */
  accountNumber: z.string(),
  /** Rótulo de la cuenta ("Cuenta corriente N°", "CLABE", "Account number"…). */
  accountLabel: z.string(),
  routingOrSwift: z.string().nullable(),
  /** Rótulo del código ("SWIFT", "ABA routing number"…). */
  routingLabel: z.string().nullable(),
});
export type PaymentSpec = z.infer<typeof PaymentSchema>;

export const EmailMetaSchema = z.strictObject({
  from: z.string(),
  to: z.string(),
  cc: z.string().nullable(),
  subject: z.string(),
  /** Fecha RFC 5322 fija, p. ej. "Wed, 07 Oct 2026 09:14:22 -0300". */
  date: z.string(),
  messageId: z.string().regex(/^<[^<>\s]+@[^<>\s]+>$/),
  /** Cuerpo en texto plano, una entrada por línea. */
  body: z.array(z.string()),
});
export type EmailMeta = z.infer<typeof EmailMetaSchema>;

export const AttachmentSchema = z.strictObject({
  filename: z.string().regex(/\.pdf$/),
  template: z.enum(TEMPLATES),
});

export const ChatMessageSchema = z.strictObject({
  /** dd/mm/aaaa */
  date: z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/),
  /** hh:mm */
  time: z.string().regex(/^\d{2}:\d{2}$/),
  /** null = mensaje del sistema de WhatsApp. */
  sender: z.string().nullable(),
  /** Puede tener saltos de línea. */
  text: z.string(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const PhotoSchema = z.strictObject({
  /** Grados de rotación (positivo = horario). */
  angle: z.number().min(-8).max(8),
  /** Fondo sobre el que está el papel. */
  surface: z.enum(["desk", "wood", "fabric"]),
  /** Desenfoque general (sigma de sharp, 0.3–3). */
  blur: z.number().min(0.3).max(3),
  /** Calidad JPEG. */
  quality: z.number().int().min(40).max(95),
  /** Semilla del grano (determinista). */
  seed: z.number().int(),
  /** Papel impreso doblado (línea de pliegue). */
  folded: z.boolean(),
});
export type PhotoSpec = z.infer<typeof PhotoSchema>;

export const InstructionSchema = z.strictObject({ text: z.string().min(1), reason: z.string().min(1) });

export const DocumentSpecSchema = z.strictObject({
  id: caseId,
  /** Descripción del caso (copiada de casos.csv, solo para quien lee la spec). */
  about: z.string(),
  /** id del proveedor en company.json, o null si no está registrado. */
  vendorId: z.string().nullable(),
  format: z.enum(FORMATS),
  /** Plantilla visual (pdf/png/jpg). null para eml y txt. */
  template: z.enum(TEMPLATES).nullable(),
  language: z.enum(["es", "en", "pt"]),
  locale: z.enum(LOCALES),
  documentType: z.enum(["invoice", "cuenta_de_cobro", "receipt", "other"]),
  /** Título del documento tal como aparece ("Invoice", "FACTURA ELECTRÓNICA DE VENTA"…). */
  title: z.string(),
  brand: BrandSchema.nullable(),
  vendor: PartySchema,
  customer: PartySchema,
  invoiceNumber: z.string().min(1),
  issueDate: isoDate,
  /** Ciudad de emisión (cuentas de cobro). */
  issuePlace: z.string().nullable(),
  /** Hora de emisión hh:mm:ss (NFS-e). */
  issueTime: z.string().nullable(),
  dueDate: isoDate.nullable(),
  servicePeriod: isoMonth.nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  /** Condición de pago tal como aparece ("Net 15", "Crédito 15 días"…). */
  paymentTerms: z.string().nullable(),
  lines: z.array(LineSchema).min(1),
  subtotal: z.number().nullable(),
  tax: TaxSchema.nullable(),
  total: z.number(),
  payment: PaymentSchema.nullable(),
  notes: z.array(z.string()),
  /** Texto legal al pie (resolución DIAN, CFDI, SUNAT…). */
  legal: z.array(z.string()),
  /** Datos propios de una plantilla (código de verificación, CUFE, firmante…). */
  templateData: z.record(z.string(), z.string()),
  /** Nota visible que intenta dar órdenes al sistema (B16). */
  visibleNote: z.string().nullable(),
  /** Texto oculto: blanco y diminuto, solo en PDF (H10). */
  hiddenText: z.string().nullable(),
  /** El total sale ilegible en la foto (B17). */
  blurTotal: z.boolean(),
  photo: PhotoSchema.nullable(),
  emailMeta: EmailMetaSchema.nullable(),
  /** Correo con la factura en PDF adjunta (B20). */
  attachment: AttachmentSchema.nullable(),
  chatMessages: z.array(ChatMessageSchema).nullable(),
  /**
   * Citas literales para correos y chats (en documentos con plantilla las calcula el generador
   * a partir de lo que dibuja).
   */
  evidence: z.partialRecord(z.enum(EVIDENCE_KEYS), z.string()).nullable(),
  /** Instrucciones incrustadas además de visibleNote y hiddenText (p. ej. H05). */
  embeddedInstructions: z.array(InstructionSchema),
  readerNotes: z.string().min(1),
});
export type DocumentSpec = z.infer<typeof DocumentSpecSchema>;

export const CopySpecSchema = z.strictObject({
  id: caseId,
  about: z.string(),
  vendorId: z.string().nullable(),
  format: z.enum(FORMATS),
  /** Caso cuyo archivo se copia byte a byte. */
  copyOf: caseId,
});
export type CopySpec = z.infer<typeof CopySpecSchema>;

export const PhotoOfSpecSchema = z.strictObject({
  id: caseId,
  about: z.string(),
  vendorId: z.string().nullable(),
  format: z.literal("jpg"),
  /** Caso cuyo documento aparece en la foto (mismo contenido, mismo número). */
  photoOf: caseId,
  photo: PhotoSchema,
  readerNotes: z.string().min(1),
});
export type PhotoOfSpec = z.infer<typeof PhotoOfSpecSchema>;

export type CaseSpec = DocumentSpec | CopySpec | PhotoOfSpec;

export function isCopySpec(spec: CaseSpec): spec is CopySpec {
  return "copyOf" in spec;
}
export function isPhotoOfSpec(spec: CaseSpec): spec is PhotoOfSpec {
  return "photoOf" in spec;
}
export function isDocumentSpec(spec: CaseSpec): spec is DocumentSpec {
  return !isCopySpec(spec) && !isPhotoOfSpec(spec);
}

/** true si el valor no tiene más de `decimals` decimales (12000000 con 0 sí; 4125.005 con 2 no). */
function hasAtMostDecimals(value: number, decimals: number): boolean {
  const scaled = value * 10 ** decimals;
  return Math.abs(scaled - Math.round(scaled)) < 1e-6;
}

/** Valida una spec y comprueba reglas que el esquema solo no puede expresar. */
export function parseSpec(raw: unknown, source = "spec"): CaseSpec {
  const obj = raw as Record<string, unknown>;
  let spec: CaseSpec;
  if (obj && typeof obj === "object" && "copyOf" in obj) spec = CopySpecSchema.parse(raw);
  else if (obj && typeof obj === "object" && "photoOf" in obj) spec = PhotoOfSpecSchema.parse(raw);
  else spec = DocumentSpecSchema.parse(raw);

  if (isDocumentSpec(spec)) {
    const problems: string[] = [];
    const visual = spec.format === "pdf" || spec.format === "png" || spec.format === "jpg";
    if (visual && !spec.template) problems.push("los formatos pdf/png/jpg necesitan template");
    if (!visual && spec.template) problems.push("eml/txt no usan template (el adjunto lleva el suyo)");
    if (spec.format === "jpg" && !spec.photo) problems.push("jpg necesita photo");
    if (spec.format !== "jpg" && spec.photo) problems.push("photo solo aplica a jpg");
    if (spec.format === "eml" && !spec.emailMeta) problems.push("eml necesita emailMeta");
    if (spec.format !== "eml" && (spec.emailMeta || spec.attachment)) problems.push("emailMeta/attachment solo aplican a eml");
    if (spec.format === "txt" && !spec.chatMessages?.length) problems.push("txt necesita chatMessages");
    if (spec.format !== "txt" && spec.chatMessages) problems.push("chatMessages solo aplica a txt");
    const textual = (spec.format === "eml" && !spec.attachment) || spec.format === "txt";
    if (textual && !spec.evidence) problems.push("correo sin adjunto y chat necesitan evidence explícita");
    if (!textual && spec.evidence) problems.push("evidence explícita solo para correo sin adjunto o chat");
    if (spec.hiddenText && spec.format !== "pdf") problems.push("hiddenText solo en pdf");
    if (spec.blurTotal && spec.format !== "jpg") problems.push("blurTotal solo en jpg");
    if (spec.servicePeriod && !spec.issueDate.startsWith(spec.servicePeriod.slice(0, 4))) {
      problems.push("servicePeriod y issueDate de años distintos");
    }
    // El documento imprime los montos con los decimales de su moneda y las cantidades con hasta 2:
    // un valor con más decimales saldría redondeado en el archivo y distinto en la lectura perfecta.
    const decimals = currencyDecimals(spec.currency);
    const money: Array<[string, number | null]> = [
      ...spec.lines.flatMap((l, i): Array<[string, number | null]> => [
        [`línea ${i + 1} (valor unitario)`, l.unitPrice],
        [`línea ${i + 1} (valor)`, l.amount],
      ]),
      ["subtotal", spec.subtotal],
      ["impuestos", spec.tax?.amount ?? null],
      ["total", spec.total],
    ];
    for (const [label, value] of money) {
      if (value != null && !hasAtMostDecimals(value, decimals)) {
        problems.push(`${label}: ${value} tiene más decimales de los que muestra el documento en ${spec.currency} (${decimals})`);
      }
    }
    spec.lines.forEach((l, i) => {
      if (l.quantity != null && !hasAtMostDecimals(l.quantity, 2)) {
        problems.push(`línea ${i + 1} (cantidad): ${l.quantity} tiene más de 2 decimales`);
      }
    });
    if (problems.length > 0) throw new Error(`${source} (${spec.id}): ${problems.join("; ")}`);
  }
  return spec;
}

/** Directorio dataset/ (se resuelve desde el directorio de trabajo: la raíz del repo). */
export function datasetDir(): string {
  const dir = path.resolve(process.cwd(), "dataset");
  if (!fs.existsSync(path.join(dir, "casos.csv"))) {
    throw new Error(`No encuentro dataset/casos.csv desde ${process.cwd()}. Ejecuta desde la raíz del repo.`);
  }
  return dir;
}

/** Lee y valida todas las specs de dataset/specs/, ordenadas por id. */
export function loadSpecs(specsDir = path.join(datasetDir(), "specs")): CaseSpec[] {
  const files = fs
    .readdirSync(specsDir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  const specs = files.map((f) => {
    const raw: unknown = JSON.parse(fs.readFileSync(path.join(specsDir, f), "utf8"));
    const spec = parseSpec(raw, f);
    if (`${spec.id}.json` !== f) throw new Error(`${f}: el id ${spec.id} no coincide con el nombre del archivo`);
    return spec;
  });
  const byId = new Map(specs.map((s) => [s.id, s]));
  for (const spec of specs) {
    const ref = isCopySpec(spec) ? spec.copyOf : isPhotoOfSpec(spec) ? spec.photoOf : null;
    if (ref == null) continue;
    const target = byId.get(ref);
    if (!target) throw new Error(`${spec.id}: referencia a ${ref}, que no existe`);
    if (!isDocumentSpec(target)) throw new Error(`${spec.id}: ${ref} debe ser un documento completo`);
    if (target.vendorId !== spec.vendorId) {
      throw new Error(`${spec.id}: el proveedor (${spec.vendorId ?? "sin registrar"}) no es el del documento ${ref} (${target.vendorId ?? "sin registrar"})`);
    }
    if (isCopySpec(spec) && target.format !== spec.format) throw new Error(`${spec.id}: formato distinto al de ${ref}`);
    if (isPhotoOfSpec(spec) && target.template == null) throw new Error(`${spec.id}: ${ref} no tiene plantilla visual`);
  }
  return specs;
}

/** El documento que describe una spec (para copyOf/photoOf, el del caso referido). */
export function documentOf(spec: CaseSpec, byId: Map<string, CaseSpec>): DocumentSpec {
  if (isDocumentSpec(spec)) return spec;
  const ref = isCopySpec(spec) ? spec.copyOf : spec.photoOf;
  const target = byId.get(ref);
  if (!target || !isDocumentSpec(target)) throw new Error(`${spec.id}: referencia inválida a ${ref}`);
  return target;
}
