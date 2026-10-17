import { describe, expect, it } from "vitest";
import type { ManifestEntry } from "../core/ports";
import type { Extraction } from "../core/schemas";
import { PROMPT_VERSION } from "./prompt";
import { SIMULATED_MODEL, createSimulatedReader } from "./simulated";
import { makeDoc, makeExtraction } from "./test-utils";

const HASH = "c".repeat(64);

function manifest(groundTruth: Extraction = makeExtraction()): ManifestEntry[] {
  return [{ caseId: "B19", file: "B19.txt", sha256: HASH, mediaType: "text/plain", groundTruth }];
}

describe("createSimulatedReader", () => {
  it("devuelve la lectura del manifiesto buscando por huella", async () => {
    const reader = createSimulatedReader({ id: "simulado-principal", manifest: manifest() });
    expect(reader).toMatchObject({ id: "simulado-principal", model: "simulado", promptVersion: PROMPT_VERSION });
    const result = await reader.read(makeDoc({ fileHash: HASH }));
    expect(result).toEqual({
      ok: true,
      readerId: "simulado-principal",
      model: SIMULATED_MODEL,
      promptVersion: PROMPT_VERSION,
      extraction: makeExtraction(),
    });
  });

  it("acepta la huella en mayúsculas", async () => {
    const reader = createSimulatedReader({ id: "s", manifest: manifest() });
    expect((await reader.read(makeDoc({ fileHash: HASH.toUpperCase() }))).ok).toBe(true);
  });

  it("archivo desconocido → unavailable con mensaje en español", async () => {
    const reader = createSimulatedReader({ id: "s", manifest: manifest() });
    const result = await reader.read(makeDoc({ fileHash: "d".repeat(64) }));
    expect(result).toEqual({
      ok: false,
      readerId: "s",
      model: "simulado",
      promptVersion: PROMPT_VERSION,
      error: "unavailable",
      message: "Lectura simulada no disponible para este archivo",
    });
  });

  it("devuelve una copia: modificarla no altera el manifiesto", async () => {
    const reader = createSimulatedReader({ id: "s", manifest: manifest() });
    const first = await reader.read(makeDoc({ fileHash: HASH }));
    if (first.ok) first.extraction.total.value = 1;
    const second = await reader.read(makeDoc({ fileHash: HASH }));
    expect(second.ok && second.extraction.total.value).toBe(2400);
  });

  it("una verdad de terreno inválida en el manifiesto → parse_error", async () => {
    const broken = { ...makeExtraction(), total: { value: "2400", evidence: null, legible: true } } as unknown as Extraction;
    const reader = createSimulatedReader({ id: "s", manifest: manifest(broken) });
    const result = await reader.read(makeDoc({ fileHash: HASH }));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toBe("parse_error");
    expect(!result.ok && result.message).toContain("B19");
  });
});
