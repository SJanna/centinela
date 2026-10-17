/**
 * Generador: specs → archivos + manifiesto. Sin E/S salvo en writeGenerated().
 * Determinista: dos corridas producen los mismos bytes.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ManifestEntry } from "../../src/core/ports";
import type { Extraction } from "../../src/core/schemas";
import { readCases } from "./cases";
import { buildGroundTruth } from "./groundTruth";
import type { EvidenceKey, EvidenceMap } from "./spec";
import {
  documentOf,
  isCopySpec,
  isDocumentSpec,
  isPhotoOfSpec,
  loadSpecs,
  type CaseSpec,
  type DocumentSpec,
  type Format,
  type PhotoSpec,
  type TemplateKind,
} from "./spec";
import { buildChat } from "./render/chat";
import { buildEml } from "./render/email";
import { renderPhoto, renderPng } from "./render/image";
import { renderPdf } from "./render/pdf";
import { renderTemplate } from "./templates";

export const MEDIA_TYPES: Record<Format, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  eml: "message/rfc822",
  txt: "text/plain",
};

export interface GeneratedCase {
  caseId: string;
  /** Nombre del archivo dentro de dataset/generated/. */
  file: string;
  mediaType: string;
  bytes: Buffer;
  sha256: string;
  groundTruth: Extraction;
  /** Citas tal como quedaron en el archivo (para pruebas). */
  evidence: EvidenceMap;
  /** Bytes del PDF adjunto (solo correos con adjunto). */
  attachment: Buffer | null;
}

export function sha256(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

interface Rendered {
  bytes: Buffer;
  evidence: EvidenceMap;
  illegible: EvidenceKey[];
}

/** Fecha fija de creación del PDF: la fecha de emisión (y hora, si la hay) en UTC. */
function pdfDate(spec: DocumentSpec): Date {
  return new Date(`${spec.issueDate}T${spec.issueTime ?? "14:00:00"}Z`);
}

export async function renderPdfDocument(spec: DocumentSpec, template: TemplateKind): Promise<Rendered> {
  const canvas = renderTemplate(spec, template);
  const bytes = await renderPdf(canvas.page(), {
    title: `${spec.title} ${spec.invoiceNumber}`,
    author: spec.vendor.name,
    subject: `${spec.title} ${spec.invoiceNumber} · ${spec.customer.name}`,
    createdAt: pdfDate(spec),
  });
  return { bytes, evidence: canvas.evidence, illegible: [] };
}

/**
 * Citas de una imagen: en una imagen no hay texto con qué comprobar la cita, así que la lectura
 * «perfecta» cita la fila completa del total con su etiqueta («TOTAL A PAGAR $36,000.00 MXN»), como la
 * transcribiría una persona y como lo exige la verificación (src/extract/assess.ts,
 * totalNotConfirmedByQuote). En un PDF la cita es solo el monto: ahí la etiqueta puede quedar en otra
 * línea o con las letras unidas en la capa de texto.
 */
function imageEvidence(spec: DocumentSpec, template: TemplateKind, canvas: { evidence: EvidenceMap; labeledEvidence: EvidenceMap }): EvidenceMap {
  if (canvas.evidence.total != null && canvas.labeledEvidence.total == null) {
    throw new Error(`${spec.id}: la plantilla ${template} no registró la fila del total con su etiqueta (citeWithLabel)`);
  }
  return { ...canvas.evidence, ...canvas.labeledEvidence };
}

async function renderVisual(spec: DocumentSpec, format: "pdf" | "png" | "jpg", template: TemplateKind, photo: PhotoSpec | null): Promise<Rendered> {
  if (format === "pdf") return renderPdfDocument(spec, template);
  const canvas = renderTemplate(spec, template);
  const page = canvas.page();
  const evidence = imageEvidence(spec, template, canvas);
  if (format === "png") {
    return { bytes: await renderPng(page, template === "portal" ? 1.5 : 2), evidence, illegible: [] };
  }
  if (!photo) throw new Error(`${spec.id}: falta photo para jpg`);
  const illegibleTags = spec.blurTotal ? ["total"] : [];
  const bytes = await renderPhoto(page, photo, { illegibleTags });
  return { bytes, evidence, illegible: spec.blurTotal ? ["total"] : [] };
}

async function renderDocument(spec: DocumentSpec): Promise<Rendered & { attachment: Buffer | null }> {
  switch (spec.format) {
    case "pdf":
    case "png":
    case "jpg": {
      if (!spec.template) throw new Error(`${spec.id}: falta template`);
      return { ...(await renderVisual(spec, spec.format, spec.template, spec.photo)), attachment: null };
    }
    case "eml": {
      if (!spec.emailMeta) throw new Error(`${spec.id}: falta emailMeta`);
      if (spec.attachment) {
        const pdf = await renderPdfDocument(spec, spec.attachment.template);
        const bytes = buildEml(spec.emailMeta, { filename: spec.attachment.filename, contentType: "application/pdf", bytes: pdf.bytes });
        return { bytes, evidence: pdf.evidence, illegible: [], attachment: pdf.bytes };
      }
      return { bytes: buildEml(spec.emailMeta, null), evidence: spec.evidence ?? {}, illegible: [], attachment: null };
    }
    case "txt": {
      if (!spec.chatMessages) throw new Error(`${spec.id}: falta chatMessages`);
      return { bytes: Buffer.from(buildChat(spec.chatMessages), "utf8"), evidence: spec.evidence ?? {}, illegible: [], attachment: null };
    }
  }
}

function packCase(spec: CaseSpec, r: Rendered & { attachment: Buffer | null }, groundTruth: Extraction): GeneratedCase {
  return {
    caseId: spec.id,
    file: `${spec.id}.${spec.format}`,
    mediaType: MEDIA_TYPES[spec.format],
    bytes: r.bytes,
    sha256: sha256(r.bytes),
    groundTruth,
    evidence: r.evidence,
    attachment: r.attachment,
  };
}

/** Genera un caso. `done` trae los casos ya generados (para copyOf). */
export async function generateCase(spec: CaseSpec, byId: Map<string, CaseSpec>, done: Map<string, GeneratedCase>): Promise<GeneratedCase> {
  if (isCopySpec(spec)) {
    const source = done.get(spec.copyOf);
    if (!source) throw new Error(`${spec.id}: ${spec.copyOf} todavía no se generó`);
    return {
      ...source,
      caseId: spec.id,
      file: `${spec.id}.${spec.format}`,
      bytes: Buffer.from(source.bytes),
      groundTruth: structuredClone(source.groundTruth),
    };
  }
  if (isPhotoOfSpec(spec)) {
    const doc = documentOf(spec, byId);
    if (!doc.template) throw new Error(`${spec.id}: ${spec.photoOf} no tiene plantilla`);
    const r = await renderVisual(doc, "jpg", doc.template, spec.photo);
    const gt = buildGroundTruth(doc, r.evidence, { illegible: r.illegible, readerNotes: spec.readerNotes });
    return packCase(spec, { ...r, attachment: null }, gt);
  }
  const r = await renderDocument(spec);
  const gt = buildGroundTruth(spec, r.evidence, { illegible: r.illegible });
  return packCase(spec, r, gt);
}

/** Genera todos los casos, en el orden de casos.csv. */
export async function generateAll(specs: CaseSpec[] = loadSpecs()): Promise<GeneratedCase[]> {
  const byId = new Map(specs.map((s) => [s.id, s]));
  const done = new Map<string, GeneratedCase>();
  const phases = [specs.filter(isDocumentSpec), specs.filter(isPhotoOfSpec), specs.filter(isCopySpec)];
  for (const phase of phases) {
    for (const spec of phase) done.set(spec.id, await generateCase(spec, byId, done));
  }
  const order = readCases().map((c) => c.id);
  const rank = (id: string) => {
    const i = order.indexOf(id);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...done.values()].sort((a, b) => rank(a.caseId) - rank(b.caseId) || a.caseId.localeCompare(b.caseId));
}

export function toManifest(cases: GeneratedCase[]): ManifestEntry[] {
  return cases.map((c) => ({ caseId: c.caseId, file: c.file, sha256: c.sha256, mediaType: c.mediaType, groundTruth: c.groundTruth }));
}

export function manifestJson(cases: GeneratedCase[]): string {
  return `${JSON.stringify(toManifest(cases), null, 2)}\n`;
}

/** Escribe los archivos y manifest.json; borra archivos de casos que ya no existen. */
export function writeGenerated(cases: GeneratedCase[], outDir: string): void {
  fs.mkdirSync(outDir, { recursive: true });
  const keep = new Set([...cases.map((c) => c.file), "manifest.json"]);
  for (const f of fs.readdirSync(outDir)) {
    if (/^[A-Z]\d{2}\.(pdf|png|jpg|eml|txt)$/.test(f) && !keep.has(f)) fs.rmSync(path.join(outDir, f));
  }
  for (const c of cases) fs.writeFileSync(path.join(outDir, c.file), c.bytes);
  fs.writeFileSync(path.join(outDir, "manifest.json"), manifestJson(cases));
}
