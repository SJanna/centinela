/**
 * DUP-B del equipo rojo (docs/REDTEAM.md): factura de Camila Restrepo Dev S.A.S. emitida el 5 de
 * noviembre de 2026 «por los servicios prestados durante el mes anterior a la fecha de emisión», sin
 * periodo de servicio escrito, por el monto pactado (COP 12.000.000) y a la cuenta registrada. Octubre
 * de 2026 del acuerdo mensual a-camila-mensual ya se pagó (factura B01).
 *
 * Con las lecturas REALES guardadas (Haiku 5.5 ×2, prompts v6/v6b) las dos dejan servicePeriod vacío
 * (bien: el documento no lo dice). El motor tomaba el mes de la emisión (noviembre), DUP-3 lo veía
 * libre y se pagaba octubre dos veces. Ahora la verificación (sin modelo) ve que el documento y las dos
 * notas dicen «mes anterior» (earlierPeriodMarkers): con el periodo deducido de la fecha, DUP-3 revisa
 * también octubre y escala; la guardia lo revisa por su cuenta.
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
import type { Company, DecisionContext, EngineInput, Extraction, HistoryEntry, ReaderResult } from "../core/schemas";
import { decide } from "../engine";
import { guardPayment } from "../guard";
import { normalizeFile } from "../ingest";
import { decideWithGuard } from "../pipeline/guard-apply";
import { assessReadings } from "./assess";

const here = path.dirname(fileURLToPath(import.meta.url));
const company = companyJson as unknown as Company;
const ID = "DUP-B-mes-anterior-sin-periodo";

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

function reading(readerId: "lector-a" | "lector-b"): ReaderResult {
  const extraction = JSON.parse(
    readFileSync(path.join(here, "test-data", "redteam-readings", `${ID}.${readerId}.json`), "utf8"),
  ) as Extraction;
  return { ok: true, readerId, model: "claude-haiku-5-5", promptVersion: readerId === "lector-a" ? "v6" : "v6b", extraction };
}

async function realInput(): Promise<EngineInput> {
  const bytes = new Uint8Array(readFileSync(path.join(here, "test-data", "redteam", `${ID}.pdf`)));
  const doc = await normalizeFile(bytes, "factura.pdf");
  return { invoiceId: `logica/${ID}`, fileHash: doc.fileHash, reading: assessReadings(doc, reading("lector-a"), reading("lector-b")) };
}

/** La misma entrada sin las marcas de documento no cobrable (el falso positivo de las notas). */
async function inputWithoutVoidMarkers(): Promise<EngineInput> {
  const input = await realInput();
  return { ...input, reading: { ...input.reading, signals: { ...input.reading.signals, voidDocumentMarkers: [] } } };
}

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
    expect(markers).toContainEqual({ text: "Servicios prestados durante el mes anterior a la fecha de emisión", period: null });
    expect(markers.filter((m) => /^lector-a anota: «/.test(m.text))).toHaveLength(1);
    expect(markers.filter((m) => /^lector-b anota: «/.test(m.text))).toHaveLength(1);
    expect(markers.every((m) => m.period === null)).toBe(true);
  });

  it("DUP-3 no da por libre noviembre: octubre ya se pagó y la factura puede cobrarlo", async () => {
    const decision = decide(await inputWithoutVoidMarkers(), ctx);
    expect(decision.outcome).toBe("ESCALAR");
    const dup3 = decision.checks.find((c) => c.code === "DUP-3")!;
    expect(dup3.status).toBe("not_evaluable");
    expect(dup3.explanation).toBe(EXPLANATION);
    expect(dup3.params).toMatchObject({
      inferredPeriod: "2026-11",
      previousPeriod: "2026-10",
      previousInvoiceId: "B01",
      periodSource: "reference_date",
    });
    // Es la única comprobación que no pasa: sin esta regla se pagaba.
    expect(decision.checks.filter((c) => c.status !== "pass").map((c) => c.code)).toEqual(["DUP-3"]);
    expect(decision.humanAction).toContain("Confirmar con el proveedor qué mes cobra esta factura; si es octubre de 2026, ya se pagó.");
  });

  it("con todo el pipeline (lecturas reales, guardia) la decisión final no es PAGAR", async () => {
    const decision = decideWithGuard(await realInput(), ctx);
    expect(decision.outcome).toBe("ESCALAR");
    expect(decision.checks.find((c) => c.code === "DUP-3")!.status).toBe("not_evaluable");
  });

  it("sin el pago de octubre en el historial se paga noviembre (la regla no frena de más)", async () => {
    const decision = decide(await inputWithoutVoidMarkers(), { ...ctx, history: [] });
    expect(decision.outcome).toBe("PAGAR");
    expect(decision.agreementPeriod).toBe("2026-11");
  });

  it("la guardia rechaza por su cuenta el PAGAR de un motor que solo miraba noviembre", async () => {
    const input = await inputWithoutVoidMarkers();
    // Un motor sin la regla (o que no vio el historial) paga noviembre.
    const blind = decide(input, { ...ctx, history: [] });
    expect(blind.outcome).toBe("PAGAR");
    const guard = guardPayment(input, ctx, blind);
    expect(guard.approved).toBe(false);
    expect(guard.violations).toContain(
      "la factura no dice qué mes cobra y el mes anterior a su fecha (octubre de 2026) ya se pagó",
    );
  });
});
