/**
 * Detector de documento ya pagado (src/extract/paid-markers.ts) contra los archivos del dataset, con el
 * texto plano que produce la entrada real (normalizeFile):
 * - en los 138 archivos de dataset/generated, marcas solo en B87 (la versión HTML del correo dice
 *   «Paid – thank you»; el recibo B29 es una imagen, sin texto plano) y cero en TODAS las facturas
 *   legítimas del set de estrés (decision_esperada PAGAR), ni en las demás trampas que no son recibos;
 * - detecta todos los recibos del set de estrés que tienen texto (PDF, correo, chat; las imágenes no
 *   tienen texto plano y dependen de la lectura).
 * El set de estrés no se versiona: esas pruebas corren solo si ya se generó (npm run stress:generate).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ManifestEntry } from "../src/core/ports";
import type { Decision, Extraction, ReaderResult } from "../src/core/schemas";
import { decide } from "../src/engine";
import { assessReadings, detectPaidDocumentMarkers } from "../src/extract";
import { guardPayment } from "../src/guard";
import { normalizeFile } from "../src/ingest";
import { companyForScenario } from "../src/pipeline/dataset";
import { loadEvalDataset, parseStressCases, STRESS_DIR, STRESS_GENERATED } from "./datasets";

const root = process.cwd();
const stressGenerated = existsSync(path.join(root, STRESS_GENERATED, "manifest.json"));

function manifestOf(dir: string): ManifestEntry[] {
  return JSON.parse(readFileSync(path.join(root, dir, "manifest.json"), "utf8")) as ManifestEntry[];
}

/** Marcas del detector sobre el texto plano del archivo (null si el archivo no tiene texto, p. ej. una imagen). */
async function markersOf(dir: string, entry: ManifestEntry): Promise<string[] | null> {
  const doc = await normalizeFile(new Uint8Array(readFileSync(path.join(root, dir, entry.file))), entry.file, entry.mediaType);
  if (doc.plainText == null || doc.plainText.trim() === "") return null;
  return detectPaidDocumentMarkers(doc.plainText).map((m) => `${entry.caseId}: «${m.text}»`);
}

describe("detector de documento ya pagado · dataset", () => {
  it("en los 138 archivos de dataset/generated solo marca B87 (correo cuya versión HTML dice que ya se pagó)", async () => {
    const dir = path.join("dataset", "generated");
    const manifest = manifestOf(dir);
    expect(manifest).toHaveLength(138);
    const found: string[] = [];
    for (const entry of manifest) found.push(...((await markersOf(dir, entry)) ?? []));
    expect(found).toEqual(["B87: «Paid – thank you! We charged $96.00 to your Visa ending 4417 on October 2, 2026. Amount due: $0.00.»"]);
  }, 120_000);

  describe.skipIf(!stressGenerated)("set de estrés", () => {
    const load = () => {
      const { rows, extras } = parseStressCases(readFileSync(path.join(root, STRESS_DIR, "casos.csv"), "utf8"));
      const manifest = new Map(manifestOf(STRESS_GENERATED).map((e) => [e.caseId, e]));
      const isReceipt = (id: string) => (extras.get(id)?.trampa ?? "").split("+").includes("recibo");
      return { rows, manifest, isReceipt };
    };

    it("cero marcas en todas las facturas legítimas (PAGAR) y en las demás que no son recibos", async () => {
      const { rows, manifest, isReceipt } = load();
      const legit = rows.filter((r) => r.decision_esperada === "PAGAR");
      expect(legit.length).toBeGreaterThan(800);
      const inLegit: string[] = [];
      const inOthers: string[] = [];
      let withText = 0;
      for (const row of rows) {
        if (isReceipt(row.id)) continue;
        const entry = manifest.get(row.id);
        if (!entry) throw new Error(`${row.id} no está en el manifiesto del set de estrés`);
        const found = await markersOf(STRESS_GENERATED, entry);
        if (found == null) continue;
        if (row.decision_esperada === "PAGAR") withText++;
        (row.decision_esperada === "PAGAR" ? inLegit : inOthers).push(...found);
      }
      expect(inLegit).toEqual([]);
      expect(inOthers).toEqual([]);
      // Las legítimas con texto (PDF, correo, chat) son la mayoría: la prueba no pasa por estar vacía.
      expect(withText).toBeGreaterThan(400);
    }, 180_000);

    /**
     * Los pagos indebidos medidos con Claude real (perfil económico): las dos lecturas dijeron «invoice»
     * (o pusieron el subtotal visible como total en una foto borrosa), coincidían y no había señales.
     * Se reproducen con la lectura «perfecta» alterada igual que la real, sin llamar a la API.
     */
    describe("los 6 pagos indebidos del set de estrés ya no se pagan", () => {
      const ok = (readerId: string, extraction: Extraction): ReaderResult => ({ ok: true, readerId, model: "claude-haiku-5-5", promptVersion: "v3", extraction });
      const setup = async (caseId: string) => {
        const ds = loadEvalDataset("stress");
        const row = ds.rows.find((r) => r.id === caseId)!;
        const scenario = ds.scenarios.find((sc) => sc.id === row.escenario)!;
        const entry = ds.manifest.find((e) => e.caseId === caseId)!;
        const doc = await normalizeFile(new Uint8Array(readFileSync(ds.filePath(entry))), entry.file, entry.mediaType);
        const ctx = { company: companyForScenario(ds.company, scenario), history: [], now: scenario.now };
        return { doc, ctx, groundTruth: structuredClone(entry.groundTruth) as Extraction };
      };

      it.each(["S0916", "S1086", "S0030", "S0488", "S0768"])("%s: recibo que las dos lecturas leyeron como «invoice»", async (caseId) => {
        const { doc, ctx, groundTruth } = await setup(caseId);
        expect(groundTruth.documentType).toBe("receipt");
        const asInvoice: Extraction = { ...groundTruth, documentType: "invoice" };
        const reading = assessReadings(doc, ok("lector-a", asInvoice), ok("lector-b", structuredClone(asInvoice)));
        const input = { invoiceId: caseId, fileHash: doc.fileHash, reading };
        expect(reading.signals.paidDocumentMarkers?.length).toBeGreaterThan(0);

        // Sin la señal (como antes) se pagaba: el hueco era real.
        const blind = { ...input, reading: { ...reading, signals: { ...reading.signals, paidDocumentMarkers: [] } } };
        const before: Decision = decide(blind, ctx);
        expect(before.outcome).toBe("PAGAR");

        // Con la señal el motor escala por LEC-1 y cita el documento.
        const after = decide(input, ctx);
        expect(after.outcome).toBe("ESCALAR");
        const lec1 = after.checks.find((c) => c.code === "LEC-1")!;
        expect(lec1.status).toBe("fail");
        expect(lec1.explanation).toMatch(/^El documento indica que ya fue pagado: «/);

        // Y la guardia, por su cuenta, rechaza el PAGAR que habría dado un motor ciego a la señal.
        const guard = guardPayment(input, ctx, before);
        expect(guard.approved).toBe(false);
        expect(guard.violations.join(" | ")).toContain("el documento indica que ya fue pagado");
      }, 30_000);

      it("S0922: foto con el total borroso; una lectura pone como total el subtotal visible, sin etiqueta", async () => {
        const { doc, ctx, groundTruth } = await setup("S0922");
        expect(groundTruth.total.legible).toBe(false);
        const subtotal = groundTruth.subtotal.value!;
        const a: Extraction = { ...groundTruth, total: { value: subtotal, evidence: `Total ${groundTruth.subtotal.evidence}`, legible: true } };
        const b: Extraction = { ...groundTruth, total: { value: subtotal, evidence: groundTruth.subtotal.evidence, legible: true } };
        const reading = assessReadings(doc, ok("lector-a", a), ok("lector-b", b));
        expect(reading.signals.illegibleCriticalFields).toEqual(["total"]);
        const d = decide({ invoiceId: "S0922", fileHash: doc.fileHash, reading }, ctx);
        expect(d.outcome).toBe("ESCALAR");
        expect(d.checks.find((c) => c.code === "LEC-1")!.explanation).toContain("La cita del total no muestra la etiqueta del total");
      }, 30_000);
    });

    it("detecta todos los recibos que tienen texto (PDF, correo con o sin adjunto)", async () => {
      const { rows, manifest, isReceipt } = load();
      const receipts = rows.filter((r) => isReceipt(r.id));
      expect(receipts.length).toBeGreaterThan(0);
      const missed: string[] = [];
      let withText = 0;
      for (const row of receipts) {
        const found = await markersOf(STRESS_GENERATED, manifest.get(row.id)!);
        if (found == null) {
          // Sin texto plano solo pueden ser imágenes: ahí decide la lectura (documentType «receipt»).
          expect(["png", "jpg"], row.id).toContain(row.formato);
          continue;
        }
        withText++;
        if (found.length === 0) missed.push(`${row.id} (${row.formato})`);
      }
      expect(missed).toEqual([]);
      expect(withText).toBe(receipts.filter((r) => r.formato !== "png" && r.formato !== "jpg").length);
      expect(withText).toBeGreaterThanOrEqual(20);
    }, 120_000);
  });
});

/**
 * Revisión adversarial (17 oct): el correo B03 (factura legítima, se paga) con UNA línea agregada que
 * dice, de otra forma que «Payment receipt» / «Payment received», que ya se pagó. Pasa por la entrada
 * real (normalizeFile del .eml), las dos lecturas dicen «invoice» (la verdad del generador) y no hay
 * otra señal: si el detector no ve la línea, se paga. Con la línea, el motor escala por LEC-1 y la
 * guardia rechaza por su cuenta el PAGAR de un motor ciego a la señal.
 */
describe("variantes de «ya pagado» en el cuerpo de un correo con datos bancarios (B03)", () => {
  const ok = (readerId: string, extraction: Extraction): ReaderResult => ({ ok: true, readerId, model: "claude-haiku-5-5", promptVersion: "v4", extraction });
  /** Codifica una línea en quoted-printable (el .eml de B03 viene así). */
  const qp = (line: string) =>
    [...Buffer.from(line, "utf8")].map((b) => (b >= 33 && b <= 126 && b !== 61 ? String.fromCharCode(b) : b === 32 ? " " : `=${b.toString(16).toUpperCase().padStart(2, "0")}`)).join("");
  const setup = async (extraLine: string | null) => {
    const ds = loadEvalDataset("base");
    const row = ds.rows.find((r) => r.id === "B03")!;
    const scenario = ds.scenarios.find((sc) => sc.id === row.escenario)!;
    const entry = ds.manifest.find((e) => e.caseId === "B03")!;
    let eml = readFileSync(ds.filePath(entry), "utf8");
    if (extraLine != null) {
      // El .eml usa CRLF: la línea va después de los datos bancarios, con el mismo fin de línea.
      const anchor = /SWIFT: ITAUBRSP(\r?\n)/;
      expect(eml).toMatch(anchor);
      eml = eml.replace(anchor, (m: string, nl: string) => `${m}${nl}${qp(extraLine)}${nl}`);
    }
    const doc = await normalizeFile(new Uint8Array(Buffer.from(eml, "utf8")), entry.file, entry.mediaType);
    const ctx = { company: companyForScenario(ds.company, scenario), history: [], now: scenario.now };
    const truth = structuredClone(entry.groundTruth) as Extraction;
    const reading = assessReadings(doc, ok("lector-a", truth), ok("lector-b", structuredClone(truth)));
    return { doc, ctx, reading, input: { invoiceId: "B03", fileHash: doc.fileHash, reading } };
  };

  it("sin la línea agregada, la factura se paga (la prueba parte de un caso que pasa todo)", async () => {
    const { ctx, input, doc } = await setup(null);
    expect(doc.plainText).toContain("SWIFT: ITAUBRSP");
    expect(input.reading.signals.paidDocumentMarkers).toEqual([]);
    expect(decide(input, ctx).outcome).toBe("PAGAR");
  }, 30_000);

  it.each([
    ["Status: Paid"],
    ["Estado de la factura: PAGADA"],
    ["Pago aplicado el 20/10/2026 por transferencia."],
    ["Pagamento confirmado em 20/10/2026."],
    ["Settled on 2026-10-20"],
    ["Fatura quitada"],
    ["PAGADO 20 OCT 2026"],
    ["Saldo a pagar: R$ 0,00"],
    ["Sí, la factura ya fue pagada el 20/10."],
    ["Una vez más, gracias por su pago."],
    ["We send you the payment receipt for October."],
    ["Charged to your card ending 4242"],
  ])("«%s»: escala por LEC-1 y la guardia rechaza", async (line) => {
    const { ctx, input } = await setup(line);
    expect(input.reading.signals.paidDocumentMarkers?.map((m) => m.text)).toEqual([line]);

    const blind = { ...input, reading: { ...input.reading, signals: { ...input.reading.signals, paidDocumentMarkers: [] } } };
    const before: Decision = decide(blind, ctx);
    expect(before.outcome).toBe("PAGAR");

    const after = decide(input, ctx);
    expect(after.outcome).toBe("ESCALAR");
    const lec1 = after.checks.find((c) => c.code === "LEC-1")!;
    expect(lec1.status).toBe("fail");
    expect(lec1.explanation).toContain(`El documento indica que ya fue pagado: «${line}»`);

    const guard = guardPayment(input, ctx, before);
    expect(guard.approved).toBe(false);
    expect(guard.violations.join(" | ")).toContain("el documento indica que ya fue pagado");
  }, 30_000);
});

describe.skipIf(!stressGenerated)("S0922 · las dos lecturas citan «Total …» con etiqueta (la regla de la cita no lo ve)", () => {
  it("las notas de las lecturas reales dicen que el «Amount due» está borroso: escala por LEC-1", async () => {
    const ds = loadEvalDataset("stress");
    const row = ds.rows.find((r) => r.id === "S0922")!;
    const scenario = ds.scenarios.find((sc) => sc.id === row.escenario)!;
    const entry = ds.manifest.find((e) => e.caseId === "S0922")!;
    const doc = await normalizeFile(new Uint8Array(readFileSync(ds.filePath(entry))), entry.file, entry.mediaType);
    const ctx = { company: companyForScenario(ds.company, scenario), history: [], now: scenario.now };
    const truth = structuredClone(entry.groundTruth) as Extraction;
    const subtotal = truth.subtotal.value!;
    // Lo que puede devolver un lector que obedece «cita la línea del total con su etiqueta» pero copia la
    // fila del subtotal: los dos citan una etiqueta, así que la regla de la cita lo da por bueno.
    const fabricated = (readerNotes: string): Extraction => ({
      ...truth,
      subtotal: { value: subtotal, evidence: `Subtotal ${truth.subtotal.evidence}`, legible: true },
      total: { value: subtotal, evidence: `Total ${truth.subtotal.evidence}`, legible: true },
      readerNotes,
    });
    const ok = (readerId: string, extraction: Extraction): ReaderResult => ({ ok: true, readerId, model: "claude-haiku-5-5", promptVersion: "v4", extraction });
    // Notas reales de lector-a (v3) y lector-b (v3b) en S0922.
    const a = fabricated("El monto Amount due está parcialmente borroso y no se pudo leer con certeza; se usó el total visible de $86,400.00 MXN.");
    const b = fabricated("Subtotal, impuesto y Amount due aparecen borrosos o sin valor legible; no los pude leer.");
    const reading = assessReadings(doc, ok("lector-a", a), ok("lector-b", b));
    expect(reading.signals.illegibleCriticalFields).toEqual(["total"]);
    const d = decide({ invoiceId: "S0922", fileHash: doc.fileHash, reading }, ctx);
    expect(d.outcome).toBe("ESCALAR");
    expect(d.checks.find((c) => c.code === "LEC-1")!.explanation).toContain("una lectura anota que el total está borroso o que lo dedujo");

    // Sin esas notas no hay con qué distinguirlo: es el límite de la regla (sin texto, una etiqueta
    // inventada se ve igual que la fila real del total).
    const silent = assessReadings(doc, ok("lector-a", fabricated("")), ok("lector-b", fabricated("")));
    expect(silent.signals.illegibleCriticalFields).toEqual([]);
  }, 30_000);
});
