/**
 * LOG-11 del equipo rojo (docs/REDTEAM.md): factura de Camila Restrepo Dev S.A.S. con el monto pactado
 * (COP 12.000.000), a la cuenta registrada, pero dirigida a «Pampa Labs Colombia S.A.S.» (NIT
 * 901.888.123-4), no a Andes Labs Inc. Con las lecturas REALES guardadas (Haiku 5.5 ×2, prompts
 * v4/v4b) se pagaba: ningún campo traía a quién va dirigida la factura (las dos lecturas lo anotaron
 * en readerNotes, que ninguna regla mira).
 *
 * Los prompts v5/v5b piden el destinatario (billToName, billToTaxId). Sin API: el PDF real del ataque
 * pasa por la entrada, y a esas mismas lecturas se les agrega el destinatario tal como está en el PDF
 * (lo que pide v5). La decisión la toman el motor (ACU-1) y la guardia, sin modelo.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import companyJson from "../../dataset/company.json";
import type { Company, DecisionContext, EngineInput, Extraction, NormalizedDoc, ReaderResult } from "../core/schemas";
import { decide } from "../engine";
import { guardPayment } from "../guard";
import { normalizeFile } from "../ingest";
import { decideWithGuard } from "../pipeline/guard-apply";
import { assessReadings } from "./assess";

const here = path.dirname(fileURLToPath(import.meta.url));
const company = companyJson as unknown as Company;
/** Lo que usó el runner del equipo rojo: sin historial, 20 de octubre de 2026. */
const ctx: DecisionContext = { company, history: [], now: "2026-10-20T15:00:00Z" };

type BillTo = Pick<Extraction, "billToName" | "billToTaxId">;

/** Lo que pide v5 en este PDF: «Cliente / Pampa Labs Colombia S.A.S. / NIT: 901.888.123-4». */
const PAMPA: BillTo = {
  billToName: { value: "Pampa Labs Colombia S.A.S.", evidence: "Cliente Pampa Labs Colombia S.A.S.", legible: true },
  billToTaxId: { value: "901.888.123-4", evidence: "NIT: 901.888.123-4", legible: true },
};

/** La lectura real guardada (v4/v4b), con el destinatario que se le indique (o sin él). */
function reading(readerId: "lector-a" | "lector-b", billTo: BillTo | null): ReaderResult {
  const saved = JSON.parse(readFileSync(path.join(here, "test-data", "redteam-readings", `LOG-11.${readerId}.json`), "utf8")) as Extraction;
  const extraction = billTo ? { ...saved, ...billTo } : saved;
  const promptVersion = billTo ? (readerId === "lector-a" ? "v5" : "v5b") : readerId === "lector-a" ? "v4" : "v4b";
  return { ok: true, readerId, model: "claude-haiku-5-5", promptVersion, extraction };
}

async function attackDoc(): Promise<NormalizedDoc> {
  const bytes = new Uint8Array(readFileSync(path.join(here, "test-data", "redteam", "LOG-11-factura-a-otra-empresa.pdf")));
  return normalizeFile(bytes, "factura.pdf");
}

function input(doc: NormalizedDoc, a: BillTo | null, b: BillTo | null): EngineInput {
  return { invoiceId: "logica/LOG-11", fileHash: doc.fileHash, reading: assessReadings(doc, reading("lector-a", a), reading("lector-b", b)) };
}

const EXPLANATION = "La factura está dirigida a Pampa Labs Colombia S.A.S. (NIT 901.888.123-4), no a Andes Labs Inc.";

describe("equipo rojo · LOG-11, factura dirigida a otra empresa", () => {
  it("el PDF dice a quién va dirigida y las lecturas v4 lo anotaron solo en sus notas", async () => {
    const doc = await attackDoc();
    expect(doc.plainText).toContain("Cliente\nPampa Labs Colombia S.A.S.\nNIT: 901.888.123-4");
    for (const id of ["lector-a", "lector-b"] as const) {
      const r = reading(id, null);
      expect(r.ok && r.extraction, id).not.toHaveProperty("billToName");
      expect(r.ok && r.extraction.readerNotes, id).toContain("Pampa Labs Colombia S.A.S.");
    }
  });

  it("sin destinatario en las lecturas (las v4 guardadas) ACU-1 no tiene qué revisar y se pagaba: por eso v5 lo pide", async () => {
    const d = decideWithGuard(input(await attackDoc(), null, null), ctx);
    expect(d.outcome).toBe("PAGAR");
    expect(d.checks.find((c) => c.code === "ACU-1")?.status).toBe("pass");
  });

  it("con el destinatario leído (v5/v5b) escala por ACU-1, con la explicación concreta", async () => {
    const now = input(await attackDoc(), PAMPA, PAMPA);
    expect(now.reading.signals.readersDisagreeOn).toEqual([]);
    expect(now.reading.signals.evidenceNotFound).toEqual([]);
    const d = decideWithGuard(now, ctx);
    expect(d.outcome).toBe("ESCALAR");
    expect(d.guardOverride).toBe(false);
    expect(d.checks.filter((c) => c.status !== "pass").map((c) => c.code)).toEqual(["ACU-1"]);
    const acu1 = d.checks.find((c) => c.code === "ACU-1")!;
    expect(acu1.status).toBe("fail");
    expect(acu1.explanation).toBe(EXPLANATION);
    expect(acu1.params).toMatchObject({ billToName: "Pampa Labs Colombia S.A.S.", billToTaxId: "901.888.123-4", billToMatches: false, agreementId: "a-camila-mensual" });
    expect(d.summary).toBe("Se escala a una persona: no cumple «Acuerdo vigente».");
    expect(d.humanAction).toContain("Confirmar con el proveedor a qué empresa corresponde la factura");
  });

  it("basta con que una de las dos lecturas traiga el destinatario", async () => {
    const d = decideWithGuard(input(await attackDoc(), null, PAMPA), ctx);
    expect(d.outcome).toBe("ESCALAR");
    const acu1 = d.checks.find((c) => c.code === "ACU-1")!;
    expect(acu1.status).toBe("fail");
    expect(acu1.explanation).toBe(
      "Según la segunda lectura, la factura está dirigida a Pampa Labs Colombia S.A.S. (NIT 901.888.123-4), no a Andes Labs Inc.",
    );
    // Solo una de las dos lo trae: no es desacuerdo entre lecturas (LEC-2).
    expect(d.checks.find((c) => c.code === "LEC-2")?.status).toBe("pass");
  });

  it("una lectura que dice «Andes Labs Inc.» sin que el PDF lo diga no se cree: la cita no está en el texto (LEC-1)", async () => {
    const fake: BillTo = { billToName: { value: "Andes Labs Inc.", evidence: "Cliente Andes Labs Inc.", legible: true } };
    const now = input(await attackDoc(), fake, fake);
    expect(now.reading.signals.evidenceNotFound).toEqual(["billToName"]);
    const d = decideWithGuard(now, ctx);
    expect(d.outcome).toBe("ESCALAR");
    expect(d.checks.find((c) => c.code === "LEC-1")?.explanation).toContain("Dato no respaldado por el texto del documento: destinatario de la factura");
  });

  it("si las dos lecturas dicen destinatarios distintos, es desacuerdo (LEC-2)", async () => {
    const other: BillTo = { billToName: { value: "Pampa Labs S.A.S.", evidence: "Pampa Labs", legible: true } };
    const d = decideWithGuard(input(await attackDoc(), PAMPA, other), ctx);
    expect(d.outcome).toBe("ESCALAR");
    expect(d.checks.find((c) => c.code === "LEC-2")?.explanation).toContain("destinatario de la factura");
  });

  it("si el motor se equivocara y dijera PAGAR, la guardia, con su propia lógica, no lo aprueba", async () => {
    const doc = await attackDoc();
    const enginePaid = decide(input(doc, null, null), ctx);
    expect(enginePaid.outcome).toBe("PAGAR");
    const g = guardPayment(input(doc, PAMPA, PAMPA), ctx, enginePaid);
    expect(g.approved).toBe(false);
    expect(g.violations).toEqual([
      "la factura está dirigida a «Pampa Labs Colombia S.A.S.», no a Andes Labs Inc.",
      "la factura está dirigida al id tributario 901.888.123-4, que no es el de Andes Labs Inc.",
    ]);
  });
});

// ───────────────────────── Revisión adversarial (18 oct) ─────────────────────────

/**
 * Variantes de LOG-11 sin API: el mismo PDF con el bloque del cliente cambiado en el texto plano (lo
 * que la verificación compara) y las mismas lecturas reales, con el destinatario como lo leería v5.
 */
const CLIENT_BLOCK = "Cliente\nPampa Labs Colombia S.A.S.\nNIT: 901.888.123-4";

async function variantDoc(block: string): Promise<NormalizedDoc> {
  const doc = await attackDoc();
  expect(doc.plainText).toContain(CLIENT_BLOCK);
  return { ...doc, plainText: doc.plainText!.replace(CLIENT_BLOCK, block) };
}

/** La guardia sola, frente a un PAGAR del motor (el de las lecturas v4, sin destinatario). */
function guardAlone(doc: NormalizedDoc, now: EngineInput) {
  const enginePaid = decide(input(doc, null, null), ctx);
  expect(enginePaid.outcome).toBe("PAGAR");
  return guardPayment(now, ctx, enginePaid);
}

describe("equipo rojo · LOG-11, revisión adversarial del arreglo", () => {
  it("dirigida a la filial «Andes Labs S.A.S.» (otra razón social, sin NIT): escala por ACU-1 y la guardia la rechaza", async () => {
    const doc = await variantDoc("Cliente\nAndes Labs S.A.S.");
    const sas: BillTo = { billToName: { value: "Andes Labs S.A.S.", evidence: "Cliente Andes Labs S.A.S.", legible: true } };
    const now = input(doc, sas, sas);
    expect(now.reading.signals.evidenceNotFound).toEqual([]);
    const d = decideWithGuard(now, ctx);
    expect(d.outcome).toBe("ESCALAR");
    expect(d.checks.filter((c) => c.status !== "pass").map((c) => c.code)).toEqual(["ACU-1"]);
    expect(d.checks.find((c) => c.code === "ACU-1")?.explanation).toBe(
      "La factura está dirigida a Andes Labs S.A.S., no a Andes Labs Inc.: tiene otra forma societaria y puede ser otra entidad (por ejemplo, una filial).",
    );
    expect(guardAlone(doc, now).approved).toBe(false);
  });

  it("una lectura que cambia «Andes Labs S.A.S.» por «Andes Labs Inc.» no está respaldada por el texto (LEC-1)", async () => {
    const doc = await variantDoc("Cliente\nAndes Labs S.A.S.");
    const inc: BillTo = { billToName: { value: "Andes Labs Inc.", evidence: "Andes Labs Inc.", legible: true } };
    const now = input(doc, inc, inc);
    expect(now.reading.signals.evidenceNotFound).toEqual(["billToName"]);
    expect(decideWithGuard(now, ctx).outcome).toBe("ESCALAR");
    expect(guardAlone(doc, now).approved).toBe(false);
  });

  it("dirigida a una empresa escrita en cirílico: no es «sin destinatario»", async () => {
    const doc = await variantDoc("Cliente\nООО Пампа Лабс");
    const ru: BillTo = { billToName: { value: "ООО Пампа Лабс", evidence: "Cliente ООО Пампа Лабс", legible: true } };
    const now = input(doc, ru, ru);
    expect(now.reading.data?.billToName).toBe("ООО Пампа Лабс");
    expect(now.reading.signals.evidenceNotFound).toEqual([]);
    const d = decideWithGuard(now, ctx);
    expect(d.outcome).toBe("ESCALAR");
    expect(d.checks.find((c) => c.code === "ACU-1")?.explanation).toBe("La factura está dirigida a ООО Пампа Лабс, no a Andes Labs Inc.");
    expect(guardAlone(doc, now).approved).toBe(false);
  });

  it("«Pampa Labs Colombia S.A.S. c/o Andes Labs Inc.»: aunque la lectura escriba solo «Andes Labs Inc.», su cita la delata", async () => {
    const doc = await variantDoc("Cliente\nPampa Labs Colombia S.A.S. c/o Andes Labs Inc.");
    const co: BillTo = { billToName: { value: "Andes Labs Inc.", evidence: "Pampa Labs Colombia S.A.S. c/o Andes Labs Inc.", legible: true } };
    const now = input(doc, co, co);
    expect(now.reading.signals.evidenceNotFound).toEqual([]);
    const d = decideWithGuard(now, ctx);
    expect(d.outcome).toBe("ESCALAR");
    expect(d.checks.find((c) => c.code === "ACU-1")?.status).toBe("not_evaluable");
    expect(guardAlone(doc, now).approved).toBe(false);
  });

  it("dos destinatarios: v5/v5b piden marcarlo ilegible y entonces escala; si una lectura eligiera uno sin marcarlo, la regla no lo ve", async () => {
    const doc = await variantDoc(`Facturar a: Andes Labs Inc.\n${CLIENT_BLOCK}`);
    const marked: BillTo = { billToName: { value: "Andes Labs Inc.", evidence: "Facturar a: Andes Labs Inc.", legible: false } };
    const now = input(doc, marked, marked);
    expect(decideWithGuard(now, ctx).outcome).toBe("ESCALAR");
    expect(decideWithGuard(now, ctx).checks.find((c) => c.code === "ACU-1")?.status).toBe("not_evaluable");
    expect(guardAlone(doc, now).approved).toBe(false);
    // Límite conocido (docs/ARCHITECTURE.md): depende de que alguna lectura lo marque o traiga al otro.
    const picked: BillTo = { billToName: { ...marked.billToName!, legible: true } };
    expect(decideWithGuard(input(doc, picked, picked), ctx).outcome).toBe("PAGAR");
    // Basta que la otra lectura traiga al otro destinatario.
    expect(decideWithGuard(input(doc, picked, PAMPA), ctx).outcome).toBe("ESCALAR");
  });
});
