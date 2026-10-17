import { createHash } from "node:crypto";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { NormalizedDoc } from "@/core/schemas";
import { IngestError, normalizeFile } from "./index";

const KINDS = new Set(["pdf", "image", "email", "chat", "text"]);

/** Proporción de caracteres de control (los que hacen que un texto se tome por binario). */
function controlRatio(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if ((c < 0x20 && ![0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x1b].includes(c)) || (c >= 0x7f && c <= 0x9f)) n++;
  }
  return s.length > 0 ? n / s.length : 0;
}

function assertWellFormed(doc: NormalizedDoc, bytes: Uint8Array): void {
  expect(doc.fileHash).toBe(createHash("sha256").update(bytes).digest("hex"));
  expect(KINDS.has(doc.kind)).toBe(true);
  expect(doc.parts.length).toBeGreaterThan(0);
  for (const value of Object.values(doc.meta)) expect(typeof value).toBe("string");
  if (doc.kind === "chat" || doc.kind === "text") {
    expect(doc.parts[0]).toEqual({ type: "text", label: doc.kind === "chat" ? "chat" : "texto", text: doc.plainText });
  }
}

describe("normalizeFile · propiedades", () => {
  it("con bytes cualquiera: devuelve un documento bien formado o un IngestError, nunca otro error", async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ minLength: 0, maxLength: 512 }), fc.constantFrom("a.bin", "a.txt", "a.eml", "a.pdf", "a"), async (bytes, name) => {
        try {
          const doc = await normalizeFile(bytes, name);
          assertWellFormed(doc, bytes);
        } catch (err) {
          expect(err).toBeInstanceOf(IngestError);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("con texto UTF-8 no vacío: siempre es texto, chat o correo", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ unit: "grapheme", minLength: 1, maxLength: 300 }), async (s) => {
        fc.pre(s.trim().replace(/[\u0000-\u001F\u007F-\u009F\u00AD\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g, "") !== "");
        const bytes = new Uint8Array(Buffer.from(s, "utf8"));
        let doc: NormalizedDoc;
        try {
          doc = await normalizeFile(bytes, "nota.txt");
        } catch (err) {
          // Solo se acepta rechazo si el texto quedó vacío o parece binario (muchos controles).
          expect(err).toBeInstanceOf(IngestError);
          const code = (err as IngestError).code;
          if (code !== "empty") {
            expect(code).toBe("unsupported");
            expect(controlRatio(s)).toBeGreaterThan(0.01);
          }
          return;
        }
        expect(["text", "chat", "email"]).toContain(doc.kind);
        assertWellFormed(doc, bytes);
      }),
      { numRuns: 300 },
    );
  });

  it("el texto normalizado es estable: normalizar dos veces da lo mismo", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1, maxLength: 200 }), async (s) => {
        let first: NormalizedDoc;
        try {
          first = await normalizeFile(new Uint8Array(Buffer.from(s, "utf8")), "a.txt");
        } catch {
          return;
        }
        fc.pre(first.kind !== "email");
        const second = await normalizeFile(new Uint8Array(Buffer.from(first.plainText ?? "", "utf8")), "a.txt");
        expect(second.plainText).toBe(first.plainText);
      }),
      { numRuns: 200 },
    );
  });
});
