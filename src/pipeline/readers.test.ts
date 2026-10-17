/**
 * Lectores de la aplicación: tiempo máximo de una lectura en vivo (el candado de procesamiento no
 * puede quedar tomado por una llamada colgada) y los ids que forman la clave de caché.
 */
import { describe, expect, it } from "vitest";
import type { NormalizedDoc, Reader, ReaderResult } from "../core/schemas";
import { PRIMARY_MODEL, SECONDARY_MODEL } from "../extract";
import { maxDuration } from "../app/api/invoices/route";
import { getReaders, LIVE_READ_TIMEOUT_MS, withReadTimeout } from "./readers";

const doc: NormalizedDoc = {
  fileHash: "a".repeat(64),
  filename: "f.txt",
  mediaType: "text/plain",
  kind: "text",
  parts: [{ type: "text", text: "Factura 1" }],
  plainText: "Factura 1",
  meta: {},
};

function fakeReader(read: () => Promise<ReaderResult>): Reader {
  return { id: "lector-a", model: "modelo-x", promptVersion: "v9", read };
}

describe("withReadTimeout", () => {
  it("una lectura que no termina se corta como no disponible (y escala)", async () => {
    const started = Date.now();
    const result = await withReadTimeout(fakeReader(() => new Promise<ReaderResult>(() => undefined)), 30).read(doc);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(result).toMatchObject({ ok: false, error: "unavailable", readerId: "lector-a", model: "modelo-x", promptVersion: "v9" });
    expect(!result.ok && result.message).toMatch(/^La lectura tardó más de /);
  });

  it("una lectura a tiempo pasa tal cual", async () => {
    const ok: ReaderResult = { ok: false, readerId: "lector-a", model: "modelo-x", promptVersion: "v9", error: "refusal", message: "no" };
    const reader = withReadTimeout(fakeReader(async () => ok), 1000);
    expect(await reader.read(doc)).toBe(ok);
    expect({ id: reader.id, model: reader.model, promptVersion: reader.promptVersion }).toEqual({
      id: "lector-a",
      model: "modelo-x",
      promptVersion: "v9",
    });
  });

  it("un error del lector se propaga (lo convierte en fallo la verificación de lecturas)", async () => {
    const reader = withReadTimeout(fakeReader(async () => Promise.reject(new Error("x"))), 1000);
    await expect(reader.read(doc)).rejects.toThrow("x");
  });
});

describe("getReaders", () => {
  it("live: mismos ids y modelos que la caché del banco de pruebas", () => {
    const { primary, secondary } = getReaders("live");
    expect([primary.id, primary.model]).toEqual(["lector-a", PRIMARY_MODEL]);
    expect([secondary.id, secondary.model]).toEqual(["lector-b", SECONDARY_MODEL]);
  });

  it("el tiempo máximo de lectura deja margen dentro del maxDuration de POST /api/invoices", () => {
    expect(LIVE_READ_TIMEOUT_MS).toBeGreaterThan(0);
    expect(LIVE_READ_TIMEOUT_MS).toBeLessThan(maxDuration * 1000 - 5000);
  });
});
