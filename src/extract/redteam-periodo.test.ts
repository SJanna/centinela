/**
 * DUP-B del equipo rojo (docs/REDTEAM.md): factura de Camila Restrepo Dev S.A.S. emitida el 5 de
 * noviembre de 2026 «por los servicios prestados durante el mes anterior a la fecha de emisión», sin
 * periodo de servicio escrito, por el monto pactado (COP 12.000.000) y a la cuenta registrada. Octubre
 * de 2026 del acuerdo mensual a-camila-mensual ya se pagó (factura B01).
 *
 * Con las lecturas REALES guardadas (Haiku 5.5 ×2, prompts v6/v6b) las dos dejan servicePeriod vacío
 * (bien: el documento no lo dice). El motor tomaba el mes de la emisión (noviembre), DUP-3 lo veía
 * libre y se pagaba octubre dos veces. Ahora la verificación (sin modelo) ve que el documento y las dos
 * notas dicen «mes anterior» (earlierPeriodMarkers): el motor imputa la factura a octubre (el mes que
 * cobra), DUP-3 ve que ya se pagó y escala; la guardia lo revisa por su cuenta.
 *
 * Las variantes (texto del documento, notas, historial, ficha de la empresa) salen de esta misma
 * factura y sus lecturas: son los hallazgos de la revisión de seguridad y autonomía de la regla
 * (pago en cascada, renovación del acuerdo, paráfrasis, sin fecha de emisión, fechas de otra cosa,
 * explicación citada desde una nota).
 *
 * Las lecturas v6 de este PDF también disparan el detector de notas de documento no cobrable (lector-b
 * anota «Documento sin marcas de anulación, proforma ni pagado»: un falso positivo, la nota lo niega).
 * Las pruebas de DUP-3 quitan esas marcas para no depender de ese falso positivo.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import companyJson from "../../dataset/company.json";
import type { Company, Decision, DecisionContext, EngineInput, Extraction, HistoryEntry, NormalizedDoc, ReaderResult } from "../core/schemas";
import { decide } from "../engine";
import { guardPayment } from "../guard";
import { normalizeFile } from "../ingest";
import { decideWithGuard } from "../pipeline/guard-apply";
import { assessReadings } from "./assess";

const here = path.dirname(fileURLToPath(import.meta.url));
const company = companyJson as unknown as Company;
const ID = "DUP-B-mes-anterior-sin-periodo";
const DETAIL = "Servicios prestados durante el mes anterior a la fecha de emisión";

/** El historial y la fecha de redteam/attacks/logica/DUP-B-mes-anterior-sin-periodo/ataque.json. */
const OCTOBER_PAID: HistoryEntry = {
  invoiceId: "B01",
  fileHash: "previa-CRD-1045",
  outcome: "PAGAR",
  vendorId: "v-camila",
  invoiceNumber: "CRD-1045",
  agreementId: "a-camila-mensual",
  agreementPeriod: "2026-10",
  amountUsd: 3000,
  decidedAt: "2026-10-05T15:00:00Z",
};
const NOW = "2026-11-08T15:00:00Z";
const ctx: DecisionContext = { company, history: [OCTOBER_PAID], now: NOW };

/** Un pago anterior de Camila con el acuerdo mensual. */
function camilaPaid(period: string, invoiceId: string, agreementId = "a-camila-mensual"): HistoryEntry {
  return { ...OCTOBER_PAID, invoiceId, fileHash: `previa-${invoiceId}`, invoiceNumber: `CRD-${invoiceId}`, agreementId, agreementPeriod: period };
}

/** La decisión como la registra el pipeline en el historial. */
function asHistory(input: EngineInput, d: Decision, decidedAt = NOW): HistoryEntry {
  return {
    invoiceId: d.invoiceId,
    fileHash: input.fileHash,
    outcome: d.outcome,
    vendorId: d.vendorId,
    invoiceNumber: input.reading.data?.invoiceNumber ?? null,
    agreementId: d.agreementId,
    agreementPeriod: d.agreementPeriod,
    amountUsd: d.amountUsd,
    decidedAt,
  };
}

function extraction(readerId: "lector-a" | "lector-b"): Extraction {
  return JSON.parse(readFileSync(path.join(here, "test-data", "redteam-readings", `${ID}.${readerId}.json`), "utf8")) as Extraction;
}

function reading(readerId: "lector-a" | "lector-b", e: Extraction = extraction(readerId)): ReaderResult {
  return { ok: true, readerId, model: "claude-haiku-5-5", promptVersion: readerId === "lector-a" ? "v6" : "v6b", extraction: e };
}

async function realDoc(): Promise<NormalizedDoc> {
  const bytes = new Uint8Array(readFileSync(path.join(here, "test-data", "redteam", `${ID}.pdf`)));
  return normalizeFile(bytes, "factura.pdf");
}

async function realInput(): Promise<EngineInput> {
  const doc = await realDoc();
  return { invoiceId: `logica/${ID}`, fileHash: doc.fileHash, reading: assessReadings(doc, reading("lector-a"), reading("lector-b")) };
}

/** Sin las marcas de documento no cobrable (el falso positivo de las notas). */
function withoutVoidMarkers(input: EngineInput): EngineInput {
  return { ...input, reading: { ...input.reading, signals: { ...input.reading.signals, voidDocumentMarkers: [] } } };
}

async function inputWithoutVoidMarkers(): Promise<EngineInput> {
  return withoutVoidMarkers(await realInput());
}

const NEUTRAL_NOTES = "Factura con IVA 0% por exportación.";

/**
 * Una variante de la misma factura, con la verificación recalculada sobre el texto y las lecturas
 * cambiadas (y sin las marcas de documento no cobrable).
 */
async function variant(opts: {
  /** Reemplaza la línea de detalle del documento (null: el documento no trae texto, como una foto). */
  detail?: string | null;
  /** Nota de las dos lecturas (por defecto, las reales). */
  notes?: string;
  invoiceNumber?: string;
  servicePeriod?: string;
  /** null: la factura no trae fecha de emisión. */
  issueDate?: null;
  hashSuffix?: string;
}): Promise<EngineInput> {
  const doc = await realDoc();
  let text = doc.plainText ?? "";
  if (opts.detail !== undefined && opts.detail !== null) text = text.replace(DETAIL, opts.detail);
  if (opts.invoiceNumber) text = text.replace("CRD-1071", opts.invoiceNumber);
  const changed: NormalizedDoc = {
    ...doc,
    plainText: opts.detail === null ? null : text,
    fileHash: opts.hashSuffix ? `${doc.fileHash.slice(0, -opts.hashSuffix.length)}${opts.hashSuffix}` : doc.fileHash,
  };
  const edit = (e: Extraction): Extraction => {
    const out: Extraction = structuredClone(e);
    if (opts.notes !== undefined) out.readerNotes = opts.notes;
    if (opts.invoiceNumber) out.invoiceNumber = { value: opts.invoiceNumber, evidence: `FACTURA N.º ${opts.invoiceNumber}`, legible: true };
    if (opts.servicePeriod) out.servicePeriod = { value: opts.servicePeriod, evidence: null, legible: true };
    if (opts.issueDate === null) out.issueDate = { value: null, evidence: null, legible: true };
    return out;
  };
  const input: EngineInput = {
    invoiceId: `logica/${ID}${opts.hashSuffix ? `-${opts.hashSuffix}` : ""}`,
    fileHash: changed.fileHash,
    reading: assessReadings(changed, reading("lector-a", edit(extraction("lector-a"))), reading("lector-b", edit(extraction("lector-b")))),
  };
  return withoutVoidMarkers(input);
}

const dup3 = (d: Decision) => d.checks.find((c) => c.code === "DUP-3")!;
const nonPass = (d: Decision) => d.checks.filter((c) => c.status !== "pass").map((c) => c.code);

const EXPLANATION =
  "La factura no dice qué mes cobra y se refiere a un mes anterior («Servicios prestados durante el mes anterior a la fecha de emisión»). Por la fecha de emisión (5 de noviembre de 2026) puede ser de noviembre de 2026 o de octubre de 2026, y octubre de 2026 del acuerdo «Desarrollo backend, tarifa fija mensual» ya se pagó (factura B01): no se puede descartar un pago doble.";

describe("equipo rojo · DUP-B, factura del mes anterior sin periodo (lecturas reales v6)", () => {
  it("las dos lecturas dejan el periodo vacío y leen la emisión del 5 de noviembre", async () => {
    for (const r of ["lector-a", "lector-b"] as const) {
      const got = reading(r);
      expect(got.ok && got.extraction.servicePeriod.value).toBeNull();
      expect(got.ok && got.extraction.issueDate.value).toBe("2026-11-05");
      expect(got.ok && got.extraction.readerNotes).toMatch(/mes anterior/);
    }
    const input = await realInput();
    expect(input.reading.data?.servicePeriod ?? null).toBeNull();
    expect(input.reading.data?.total).toBe(12000000);
  });

  it("la verificación (sin modelo) ve que cobra un mes anterior: en el PDF y en las notas de las dos lecturas", async () => {
    const markers = (await realInput()).reading.signals.earlierPeriodMarkers ?? [];
    expect(markers).toContainEqual({ text: DETAIL, period: null, source: "document" });
    for (const readerId of ["lector-a", "lector-b"]) {
      const notes = markers.filter((m) => m.source === "reader_note" && m.readerId === readerId);
      expect(notes).toHaveLength(1);
      // Un fragmento corto alrededor de la referencia, sin comillas anidadas ni el nombre del lector.
      expect(notes[0].text).toMatch(/mes anterior/);
      expect(notes[0].text).not.toMatch(/lector|«/);
    }
    expect(markers.every((m) => m.period === null)).toBe(true);
  });

  it("se imputa a octubre (el mes que cobra); como octubre ya se pagó, DUP-3 escala", async () => {
    const decision = decide(await inputWithoutVoidMarkers(), ctx);
    expect(decision.outcome).toBe("ESCALAR");
    expect(decision.agreementPeriod).toBe("2026-10");
    expect(dup3(decision).status).toBe("not_evaluable");
    expect(dup3(decision).explanation).toBe(EXPLANATION);
    expect(dup3(decision).params).toMatchObject({
      inferredPeriod: "2026-11",
      previousPeriod: "2026-10",
      previousInvoiceId: "B01",
      periodSource: "document_reference",
    });
    // Es la única comprobación que no pasa: sin esta regla se pagaba.
    expect(nonPass(decision)).toEqual(["DUP-3"]);
    expect(decision.humanAction).toContain("Confirmar con el proveedor qué mes cobra esta factura; si es octubre de 2026, ya se pagó.");
    expect(decision.summary).toBe("Se escala a una persona: no se sabe qué mes cobra la factura («Periodo no pagado»).");
  });

  it("con todo el pipeline (lecturas reales, guardia) la decisión final no es PAGAR", async () => {
    const decision = decideWithGuard(await realInput(), ctx);
    expect(decision.outcome).toBe("ESCALAR");
    expect(dup3(decision).status).toBe("not_evaluable");
  });

  it("sin el pago de octubre en el historial se paga, imputado a octubre (no a noviembre)", async () => {
    const input = await inputWithoutVoidMarkers();
    const decision = decideWithGuard(input, { ...ctx, history: [] });
    expect(decision.outcome).toBe("PAGAR");
    expect(decision.guardOverride).toBe(false);
    expect(decision.agreementPeriod).toBe("2026-10");
    expect(dup3(decision).explanation).toBe(
      "El periodo octubre de 2026 del acuerdo «Desarrollo backend, tarifa fija mensual» no se ha pagado. La factura no lo escribe como periodo, pero se refiere al mes anterior a su fecha («Servicios prestados durante el mes anterior a la fecha de emisión»); noviembre de 2026, el mes de su fecha, tampoco se ha pagado.",
    );
    expect(decision.checks.find((c) => c.code === "ACU-1")!.explanation).toContain(
      "El periodo facturado, octubre de 2026 (la factura no lo escribe como periodo; se deduce de lo que dice el documento), está dentro de su vigencia.",
    );
  });

  it("la guardia rechaza por su cuenta el PAGAR de un motor que solo miraba noviembre", async () => {
    const input = await inputWithoutVoidMarkers();
    // Un motor que no vio la referencia al mes anterior paga noviembre.
    const blindInput = { ...input, reading: { ...input.reading, signals: { ...input.reading.signals, earlierPeriodMarkers: [] } } };
    const blind = decide(blindInput, { ...ctx, history: [] });
    expect(blind.outcome).toBe("PAGAR");
    expect(blind.agreementPeriod).toBe("2026-11");
    const guard = guardPayment(input, ctx, blind);
    expect(guard.approved).toBe(false);
    expect(guard.violations).toContain("la factura no dice qué mes cobra y el mes anterior a su fecha (octubre de 2026) ya se pagó");
    expect(guard.violations).toContain("la decisión imputa el periodo 2026-11, pero la factura es del 2026-10");
    // Aunque la señal venga vacía, la guardia lee «mes anterior» en las notas de las lecturas.
    expect(guardPayment(blindInput, ctx, blind).approved).toBe(false);
    // Y sin octubre pagado tampoco deja registrar noviembre: dejaría octubre libre para otra factura.
    expect(guardPayment(input, { ...ctx, history: [] }, blind).violations).toEqual([
      "la decisión imputa el periodo 2026-11, pero la factura es del 2026-10",
    ]);
  });
});

describe("DUP-B · revisión de seguridad", () => {
  it("F1 · en cascada: pagada la del «mes anterior», otra factura que dice octubre no vuelve a pagarlo", async () => {
    // X: la factura DUP-B, con septiembre pagado y octubre libre → se paga, imputada a octubre.
    const x = await inputWithoutVoidMarkers();
    const september = camilaPaid("2026-09", "B00");
    const dx = decideWithGuard(x, { ...ctx, history: [september] });
    expect(dx.outcome).toBe("PAGAR");
    expect(dx.agreementPeriod).toBe("2026-10");
    // Y: otra factura del mismo proveedor (otro número, otro archivo) que sí escribe «octubre de 2026».
    const y = await variant({ invoiceNumber: "CRD-2001", servicePeriod: "2026-10", notes: NEUTRAL_NOTES, detail: "Servicios de octubre de 2026", hashSuffix: "ff" });
    expect(y.reading.data?.servicePeriod).toBe("2026-10");
    const dy = decideWithGuard(y, { ...ctx, history: [september, asHistory(x, dx)], now: "2026-11-22T15:00:00Z" });
    expect(dy.outcome).not.toBe("PAGAR");
    expect(dup3(dy).status).toBe("fail");
    // Y la guardia, por su cuenta, tampoco aprobaría un PAGAR de Y.
    const blindY = decide(y, { ...ctx, history: [september], now: "2026-11-22T15:00:00Z" });
    expect(blindY.outcome).toBe("PAGAR");
    expect(guardPayment(y, { ...ctx, history: [september, asHistory(x, dx)], now: "2026-11-22T15:00:00Z" }, blindY).approved).toBe(false);
  });

  it("F2 · acuerdo renovado al cambiar de mes: octubre pagado con el acuerdo anterior no se vuelve a pagar con el nuevo", async () => {
    const renewed: Company = structuredClone(company);
    const camila = renewed.vendors.find((v) => v.id === "v-camila")!;
    const old = camila.agreements.find((a) => a.id === "a-camila-mensual")!;
    old.validTo = "2026-10-31";
    camila.agreements.push({ ...structuredClone(old), id: "a-camila-mensual-2", validFrom: "2026-11-01", validTo: null });
    const rctx: DecisionContext = { company: renewed, history: [OCTOBER_PAID], now: NOW };
    const input = await inputWithoutVoidMarkers();
    const decision = decideWithGuard(input, rctx);
    expect(decision.outcome).not.toBe("PAGAR");
    // Octubre está fuera del acuerdo nuevo: igual que si la factura escribiera «octubre de 2026».
    expect(decision.checks.find((c) => c.code === "ACU-1")!.status).toBe("fail");
    // La guardia no aprueba un motor que imputara noviembre con el acuerdo nuevo.
    const blindInput = { ...input, reading: { ...input.reading, signals: { ...input.reading.signals, earlierPeriodMarkers: [] } } };
    const blind = decide(blindInput, { ...rctx, history: [] });
    expect(blind).toMatchObject({ outcome: "PAGAR", agreementId: "a-camila-mensual-2", agreementPeriod: "2026-11" });
    const guard = guardPayment(input, rctx, blind);
    expect(guard.approved).toBe(false);
    expect(guard.violations.some((x) => x.startsWith("el periodo 2026-10 está fuera de la vigencia del acuerdo"))).toBe(true);
  });

  it.each([
    "Servicios prestados durante el mes inmediato anterior a la fecha de emisión",
    "Servicios prestados durante el mes calendario anterior",
    "Mensualidad del mes que acaba de terminar",
    "Services rendered during the month prior to the invoice date",
    "Services for the month before the invoice date",
    "Services for the month preceding the invoice date",
    "Servicios del último mes",
  ])("F3 · paráfrasis «%s» (notas que la citan): no se paga octubre otra vez", async (detail) => {
    const input = await variant({ detail, notes: `${NEUTRAL_NOTES} El documento dice: '${detail}'.` });
    const decision = decideWithGuard(input, ctx);
    expect(decision.outcome).not.toBe("PAGAR");
    expect(dup3(decision).status).toBe("not_evaluable");
    expect(decision.agreementPeriod).toBe("2026-10");
  });

  it("F4 · sin fecha de emisión y un mes sin año («Servicios de octubre»): se ubica contra hoy y no se paga otra vez", async () => {
    const input = await variant({ detail: "Servicios de octubre", notes: NEUTRAL_NOTES, issueDate: null });
    expect(input.reading.data?.issueDate ?? null).toBeNull();
    expect(input.reading.signals.earlierPeriodMarkers).toContainEqual({ text: "Servicios de octubre", period: null, month: 10, source: "document" });
    const decision = decideWithGuard(input, ctx);
    expect(decision.outcome).not.toBe("PAGAR");
    expect(dup3(decision).status).toBe("not_evaluable");
    expect(dup3(decision).explanation).toContain("Tampoco trae fecha de emisión; por la fecha de hoy (8 de noviembre de 2026) puede ser de noviembre de 2026 o de octubre de 2026");
    // La guardia también lo ubica por su cuenta.
    const blindInput = { ...input, reading: { ...input.reading, signals: { ...input.reading.signals, earlierPeriodMarkers: [] } } };
    const blind = decide(blindInput, { ...ctx, history: [] });
    expect(blind.outcome).toBe("PAGAR");
    expect(guardPayment(input, ctx, blind).approved).toBe(false);
  });
});

describe("DUP-B · revisión de autonomía", () => {
  it("F2 · un proveedor que siempre cobra «el mes anterior» sin periodo: cada mes se paga y se imputa al mes que cobra", async () => {
    const history: HistoryEntry[] = [];
    const months: Array<{ issued: string; now: string }> = [
      { issued: "2026-08-05", now: "2026-08-08T15:00:00Z" },
      { issued: "2026-09-04", now: "2026-09-08T15:00:00Z" },
      { issued: "2026-10-05", now: "2026-10-08T15:00:00Z" },
      { issued: "2026-11-05", now: "2026-11-08T15:00:00Z" },
    ];
    const outcomes: Array<[string, string | null]> = [];
    for (const [i, m] of months.entries()) {
      const base = await variant({ invoiceNumber: `CRD-30${i}`, hashSuffix: `a${i}`, notes: `${NEUTRAL_NOTES} ${DETAIL}.` });
      const input: EngineInput = {
        ...base,
        reading: {
          ...base.reading,
          data: { ...base.reading.data!, issueDate: m.issued },
          primary: { ...base.reading.primary, extraction: { ...(base.reading.primary as { extraction: Extraction }).extraction, issueDate: { value: m.issued, evidence: null, legible: true } } } as ReaderResult,
          secondary: { ...base.reading.secondary!, extraction: { ...(base.reading.secondary as { extraction: Extraction }).extraction, issueDate: { value: m.issued, evidence: null, legible: true } } } as ReaderResult,
        },
      };
      const d = decideWithGuard(input, { company, history, now: m.now });
      outcomes.push([d.outcome, d.agreementPeriod]);
      history.push(asHistory(input, d, m.now));
    }
    expect(outcomes).toEqual([
      ["PAGAR", "2026-07"],
      ["PAGAR", "2026-08"],
      ["PAGAR", "2026-09"],
      ["PAGAR", "2026-10"],
    ]);
  });

  it("F3 · una fecha de contrato en el documento no es el mes cobrado (enero pagado no frena noviembre)", async () => {
    const input = await variant({
      detail: `${DETAIL}\nSegún contrato de prestación de servicios firmado el 15 de enero de 2026`,
      notes: NEUTRAL_NOTES,
    });
    expect((input.reading.signals.earlierPeriodMarkers ?? []).map((m) => m.period)).toEqual([null]);
    const decision = decideWithGuard(input, { ...ctx, history: [camilaPaid("2026-01", "B90")] });
    expect(decision.outcome).toBe("PAGAR");
    expect(decision.agreementPeriod).toBe("2026-10");
  });

  it("F4 · si solo las notas lo dicen (foto o PDF sin texto), la explicación cita el fragmento, sin jerga ni comillas anidadas", async () => {
    const input = await variant({ detail: null });
    expect(input.reading.signals.earlierPeriodMarkers?.every((m) => m.source === "reader_note")).toBe(true);
    const decision = decide(input, ctx);
    expect(decision.outcome).toBe("ESCALAR");
    const text = dup3(decision).explanation;
    expect(text).toMatch(/^La factura no dice qué mes cobra y se refiere a un mes anterior \(una de las lecturas anota «[^«»]*mes anterior[^«»]*»\)\./);
    expect(text).not.toMatch(/lector-/);
    expect(decision.summary).toBe("Se escala a una persona: no se sabe qué mes cobra la factura («Periodo no pagado»).");
  });

  it("si el documento se refiere a dos meses distintos, se escala aunque ninguno esté pagado (no se sabe a cuál imputarlo)", async () => {
    const input = await variant({ detail: `${DETAIL}\nServicios de septiembre de 2026`, notes: NEUTRAL_NOTES });
    const decision = decideWithGuard(input, { ...ctx, history: [] });
    expect(decision.outcome).toBe("ESCALAR");
    expect(dup3(decision).status).toBe("not_evaluable");
    expect(dup3(decision).explanation).toContain("se refiere a varios meses anteriores a su fecha: octubre de 2026");
    expect(dup3(decision).explanation).toContain("septiembre de 2026 («Servicios de septiembre de 2026»)");
  });

  it("si solo una lectura lo anota (y el documento no lo dice), se escala", async () => {
    const doc = await realDoc();
    const plain: NormalizedDoc = { ...doc, plainText: (doc.plainText ?? "").replace(`${DETAIL}\n`, "") };
    const a = extraction("lector-a");
    const b = extraction("lector-b");
    b.readerNotes = NEUTRAL_NOTES;
    const input = withoutVoidMarkers({ invoiceId: "x", fileHash: doc.fileHash, reading: assessReadings(plain, reading("lector-a", a), reading("lector-b", b)) });
    const decision = decide(input, { ...ctx, history: [] });
    expect(decision.outcome).toBe("ESCALAR");
    expect(dup3(decision).explanation).toContain("pero el documento no lo dice de forma que se pueda comprobar");
  });
});
