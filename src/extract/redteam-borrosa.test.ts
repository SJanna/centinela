/**
 * Foto borrosa, de punta a punta y sin API: la entrada real (normalizeFile) mide la nitidez, la
 * verificación, el motor y la guardia. Las dos lecturas son «perfectas» (la lectura del manifiesto
 * del dataset, como si el modelo acertara todo): aun así una foto borrosa no se paga sola, porque en
 * una foto borrosa las dos lecturas pueden equivocarse igual y nadie lo vería.
 *
 * B21 (dataset/generated): foto de celular de Soporte Caribe, 100 h × COP 80.000, etiquetada PAGAR.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import companyJson from "../../dataset/company.json";
import manifestJson from "../../dataset/generated/manifest.json";
import type { Company, DecisionContext, EngineInput, Extraction, NormalizedDoc, ReaderResult } from "../core/schemas";
import type { ManifestEntry } from "../core/ports";
import { decide } from "../engine";
import { guardPayment } from "../guard";
import { normalizeFile } from "../ingest";
import { MIN_IMAGE_SHARPNESS } from "../ingest/limits";
import { decideWithGuard } from "../pipeline/guard-apply";
import { assessReadings } from "./assess";

const here = path.dirname(fileURLToPath(import.meta.url));
const company = companyJson as unknown as Company;
const ctx: DecisionContext = { company, history: [], now: "2026-10-20T15:00:00Z" };
const manifest = manifestJson as unknown as ManifestEntry[];
const ACTION_BLURRY = "Pedir al proveedor una copia legible o el PDF original antes de pagar.";

function caseFile(caseId: string): { bytes: Buffer; entry: ManifestEntry } {
  const entry = manifest.find((e) => e.caseId === caseId)!;
  return { bytes: readFileSync(path.join(here, "..", "..", "dataset", "generated", entry.file)), entry };
}

function input(id: string, doc: NormalizedDoc, truth: Extraction): EngineInput {
  const a: ReaderResult = { ok: true, readerId: "lector-a", model: "claude-haiku-5-5", promptVersion: "v6", extraction: truth };
  const b: ReaderResult = { ok: true, readerId: "lector-b", model: "claude-haiku-5-5", promptVersion: "v6b", extraction: structuredClone(truth) };
  return { invoiceId: `borrosa/${id}`, fileHash: doc.fileHash, reading: assessReadings(doc, a, b) };
}

/** La misma foto, desenfocada con sigma 3 (como las trampas de total borroso del set de estrés, o peor). */
async function blurred(bytes: Buffer, sigma = 3): Promise<Uint8Array> {
  return new Uint8Array(await sharp(bytes).blur(sigma).jpeg({ quality: 70 }).toBuffer());
}

describe("foto borrosa con lecturas perfectas", () => {
  it("B21 nítida: sin avisos, paga como antes", async () => {
    const { bytes, entry } = caseFile("B21");
    const doc = await normalizeFile(new Uint8Array(bytes), entry.file, entry.mediaType);
    expect(Number(doc.meta.sharpness)).toBeGreaterThanOrEqual(MIN_IMAGE_SHARPNESS);
    expect(doc.warnings).toBeUndefined();
    const i = input("B21", doc, entry.groundTruth);
    expect(i.reading.signals.ingestWarnings).toEqual([]);
    expect(i.reading.signals.ingestWarningCodes).toEqual([]);
    expect(decideWithGuard(i, ctx).outcome).toBe("PAGAR");
  });

  it("B21 borrosa: escala solo por LEC-1, con la nitidez medida y la acción de pedir una copia legible", async () => {
    const { bytes, entry } = caseFile("B21");
    const doc = await normalizeFile(await blurred(bytes), "B21-borrosa.jpg");
    const score = Number(doc.meta.sharpness);
    expect(score).toBeLessThan(MIN_IMAGE_SHARPNESS);
    const message = `La foto está borrosa (nitidez ${score}; mínimo ${MIN_IMAGE_SHARPNESS}): una persona debe revisarla.`;
    expect(doc.warnings).toEqual([{ code: "blurry_image", message }]);

    const i = input("B21-borrosa", doc, entry.groundTruth);
    expect(i.reading.signals.ingestWarnings).toEqual([message]);
    expect(i.reading.signals.ingestWarningCodes).toEqual(["blurry_image"]);

    const d = decideWithGuard(i, ctx);
    expect(d.outcome).toBe("ESCALAR");
    expect(d.guardOverride).toBe(false); // lo frena el motor; la guardia no hizo falta
    expect(d.checks.filter((c) => c.status !== "pass").map((c) => c.code)).toEqual(["LEC-1"]);
    const lec1 = d.checks.find((c) => c.code === "LEC-1")!;
    expect(lec1.explanation).toBe(`La foto está borrosa (nitidez ${score}; mínimo ${MIN_IMAGE_SHARPNESS}): una persona debe revisarla.`);
    expect(d.humanAction).toContain(ACTION_BLURRY);
    // No es un correo: no pide abrir el correo original.
    expect(d.humanAction).not.toContain("correo");
  });

  it("B21 borrosa: si el motor se equivocara y dijera PAGAR, la guardia lo rechaza sola", async () => {
    const { bytes, entry } = caseFile("B21");
    const doc = await normalizeFile(await blurred(bytes), "B21-borrosa.jpg");
    const withWarning = input("B21-borrosa", doc, entry.groundTruth);
    // El motor sin el aviso (lo que pasaba antes de medir la nitidez): paga.
    const enginePaid = decide(input("B21-borrosa", { ...doc, warnings: undefined }, entry.groundTruth), ctx);
    expect(enginePaid.outcome).toBe("PAGAR");
    const g = guardPayment(withWarning, ctx, enginePaid);
    expect(g.approved).toBe(false);
    expect(g.violations).toEqual([expect.stringContaining("la entrada dejó un aviso que la lectura no resuelve («La foto está borrosa (nitidez")]);
  });

  it("una foto borrosa adjunta a un correo también escala, y pide la copia legible", async () => {
    const { bytes, entry } = caseFile("B21");
    const jpeg = Buffer.from(await blurred(bytes)).toString("base64").replace(/.{76}/g, "$&\r\n");
    const eml = [
      "From: Soporte Caribe <facturas@soportecaribe.co>",
      "To: pagos@andeslabs.dev",
      "Subject: Factura de octubre",
      "Date: Fri, 16 Oct 2026 10:00:00 -0500",
      "MIME-Version: 1.0",
      'Content-Type: multipart/mixed; boundary="b1"',
      "",
      "--b1",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Buenos días, les comparto la foto de la factura de octubre.",
      "--b1",
      'Content-Type: image/jpeg; name="factura.jpg"',
      'Content-Disposition: attachment; filename="factura.jpg"',
      "Content-Transfer-Encoding: base64",
      "",
      jpeg,
      "--b1--",
      "",
    ].join("\r\n");
    const doc = await normalizeFile(new TextEncoder().encode(eml), "correo.eml");
    expect(doc.warnings?.map((w) => w.code)).toEqual(["blurry_image"]);
    expect(doc.warnings?.[0].message).toMatch(/^La foto adjunta «factura\.jpg» está borrosa \(nitidez \d+; mínimo 120\)/);
    const i = input("B21-correo", doc, entry.groundTruth);
    const d = decideWithGuard(i, ctx);
    expect(d.outcome).toBe("ESCALAR");
    expect(d.checks.find((c) => c.code === "LEC-1")!.status).toBe("fail");
    expect(d.humanAction).toContain(ACTION_BLURRY);
  });

  it.each(["B17", "B21", "H03"])("%s (foto nítida del dataset): ningún aviso, las señales no cambian", async (caseId) => {
    const { bytes, entry } = caseFile(caseId);
    const doc = await normalizeFile(new Uint8Array(bytes), entry.file, entry.mediaType);
    expect(Number(doc.meta.sharpness)).toBeGreaterThanOrEqual(MIN_IMAGE_SHARPNESS);
    expect(doc.warnings).toBeUndefined();
    const i = input(caseId, doc, entry.groundTruth);
    expect(i.reading.signals.ingestWarnings).toEqual([]);
    expect(decide(i, ctx).checks.find((c) => c.code === "LEC-1")!.params.ingestWarnings ?? 0).toBe(0);
  });
});
