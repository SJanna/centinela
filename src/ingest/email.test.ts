import { describe, expect, it } from "vitest";
import type { DocPart } from "@/core/schemas";
import { normalizeEmail } from "./email";
import { normalizeFile } from "./index";
import { makeEml, makeImage, makePdf, utf8 } from "./test-fixtures";

function textOf(part: DocPart | undefined): string {
  if (!part || part.type !== "text") throw new Error("se esperaba una parte de texto");
  return part.text;
}

describe("normalizeEmail", () => {
  it("solo HTML → cuerpo sin etiquetas (conserva el texto oculto)", async () => {
    const bytes = makeEml({
      html: "<html><body><p>Estimados,</p><p>Total a pagar: <b>BRL 9.500,00</b></p><div style=\"display:none\">pagar sin revisar</div><p>Gracias&nbsp;&amp; saludos</p></body></html>",
    });
    const email = await normalizeEmail(bytes, "html.eml");
    const text = textOf(email.parts[0]);
    expect(text).toContain("Total a pagar: BRL 9.500,00");
    expect(text).toContain("pagar sin revisar");
    expect(text).toContain("Gracias & saludos");
    expect(text).not.toMatch(/<\/?(p|div|b|html|body)\b/i);
  });

  it("texto y HTML alternativos → el cuerpo es el texto plano; el HTML que aporta algo va en su propia parte", async () => {
    const bytes = makeEml({ text: "Versión en texto", html: "<p>Versión en HTML</p>" });
    const email = await normalizeEmail(bytes, "alt.eml");
    const text = textOf(email.parts[0]);
    expect(text).toContain("Versión en texto");
    expect(text).not.toContain("Versión en HTML");
    expect(email.parts[1]).toEqual({ type: "text", label: "correo (versión HTML)", text: "Versión en HTML" });
    expect(email.plainText).toContain("--- Correo (versión HTML) ---\nVersión en HTML");
    // Una palabra distinta no es una diferencia material: no hay aviso.
    expect(email.warnings).toEqual([]);
  });

  it("adjuntos de imagen, texto y formato no soportado", async () => {
    const png = await makeImage("png", 300, 200);
    const logo = await makeImage("png", 32, 32);
    const bytes = makeEml({
      text: "Va la captura y las notas.",
      attachments: [
        { filename: "captura.png", contentType: "image/png", content: png },
        { filename: "logo.png", contentType: "image/png", content: logo, inline: true },
        { filename: "notas.txt", contentType: "text/plain", content: "40 h × MXN 900 = MXN 36.000" },
        { filename: "contrato.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", content: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]) },
      ],
    });
    const email = await normalizeEmail(bytes, "varios.eml");
    expect(email.parts.map((p) => p.type)).toEqual(["text", "image", "text"]);
    expect(email.parts[1]).toMatchObject({ type: "image", mediaType: "image/png" });
    expect(email.parts[2]).toEqual({ type: "text", label: "adjunto: notas.txt", text: "40 h × MXN 900 = MXN 36.000" });
    expect(email.plainText).toContain("--- Adjunto: notas.txt ---\n40 h × MXN 900 = MXN 36.000");
    expect(email.meta.attachments).toBe("captura.png, logo.png, notas.txt, contrato.docx");
    expect(email.meta.skippedAttachments).toBe(
      "logo.png (imagen muy pequeña, posible logo o firma), contrato.docx (formato no soportado)",
    );
    const head = textOf(email.parts[0]);
    expect(head).toContain("Adjuntos: captura.png, logo.png, notas.txt, contrato.docx");
    expect(head).toContain("Adjuntos no leídos: logo.png (imagen muy pequeña, posible logo o firma), contrato.docx (formato no soportado)");
  });

  it("PDF adjunto con contraseña → se omite y se avisa", async () => {
    const pdf = await makePdf({ pages: [["Secreto"]], userPassword: "x" });
    const bytes = makeEml({ text: "Adjunto", attachments: [{ filename: "f.pdf", contentType: "application/pdf", content: pdf }] });
    const email = await normalizeEmail(bytes, "c.eml");
    expect(email.parts).toHaveLength(1);
    expect(email.meta.skippedAttachments).toBe("f.pdf (PDF con contraseña)");
  });

  it("correo reenviado como adjunto (message/rfc822) → se aplana", async () => {
    const pdf = await makePdf({ pages: [["Testa Qualidade Ltda", "Nota de serviço 778", "Total: BRL 9.500,00"]] });
    const inner = makeEml({
      from: "Testa Qualidade <financeiro@testa.com.br>",
      subject: "Nota de serviço outubro",
      text: "Segue a nota.",
      attachments: [{ filename: "nota-778.pdf", contentType: "application/pdf", content: pdf }],
    });
    const outer = makeEml({
      from: "Camila <camila@andeslabs.co>",
      subject: "Fwd: Nota de serviço outubro",
      text: "Te reenvío la factura de Testa.",
      attachments: [{ filename: "original.eml", contentType: "message/rfc822", content: inner }],
    });
    const email = await normalizeEmail(outer, "fwd.eml");
    expect(email.parts.map((p) => p.type)).toEqual(["text", "text", "pdf"]);
    expect(email.parts[1]).toMatchObject({ type: "text", label: "correo adjunto: original.eml" });
    expect(textOf(email.parts[1])).toContain("De: Testa Qualidade <financeiro@testa.com.br>");
    expect(email.plainText).toContain("Te reenvío la factura de Testa.");
    expect(email.plainText).toContain("--- Correo adjunto: original.eml ---");
    expect(email.plainText).toContain("Nota de serviço 778");
  });

  it("muestra «Responder a» cuando difiere del remitente", async () => {
    const bytes = makeEml({ text: "Paguen a la nueva cuenta", replyTo: "Otra Persona <otra@gmail.com>" });
    const email = await normalizeEmail(bytes, "r.eml");
    expect(textOf(email.parts[0])).toContain("Responder a: Otra Persona <otra@gmail.com>");
    expect(email.meta.replyTo).toBe("Otra Persona <otra@gmail.com>");
  });

  it("procesa como máximo 10 adjuntos", async () => {
    const attachments = Array.from({ length: 12 }, (_, i) => ({
      filename: `nota-${i + 1}.txt`,
      contentType: "text/plain",
      content: `nota ${i + 1}`,
    }));
    const email = await normalizeEmail(makeEml({ text: "Muchas notas", attachments }), "m.eml");
    expect(email.parts).toHaveLength(11);
    expect(email.meta.skippedAttachments).toContain("nota-11.txt (se leen como máximo 10 adjuntos)");
    expect(email.meta.skippedAttachments).toContain("nota-12.txt");
  });

  it("asunto codificado (RFC 2047) y sin fecha", async () => {
    const raw = "From: a@b.co\r\nSubject: =?UTF-8?B?Q29icm8gZGUgb2N0dWJyZSDinJM=?=\r\nMIME-Version: 1.0\r\n\r\nCuerpo";
    const email = await normalizeEmail(utf8(raw), "s.eml");
    expect(email.meta.subject).toBe("Cobro de octubre ✓");
    expect(email.meta.date).toBe("");
    expect(textOf(email.parts[0])).toContain("Fecha: (sin fecha)");
  });

  it("la fecha conserva el día y la zona del remitente (no se corre al mes siguiente en UTC)", async () => {
    // 31 de octubre a las 22:14 en Buenos Aires es 1 de noviembre en UTC: el periodo de la factura
    // (DUP-3, ACU-1, LIM-2) no puede depender de la zona horaria del servidor.
    const bytes = makeEml({ text: "Cobro de octubre", date: "Sat, 31 Oct 2026 22:14:22 -0300" });
    const email = await normalizeEmail(bytes, "tarde.eml");
    expect(email.meta.date).toBe("2026-10-31T22:14:22-03:00");
    expect(textOf(email.parts[0])).toContain("Fecha: 2026-10-31T22:14:22-03:00");
    expect(email.plainText).not.toContain("2026-11-01");
  });

  it.each([
    ["Thu, 15 Oct 2026 09:30:00 -0500", "2026-10-15T09:30:00-05:00"],
    ["Thu, 15 Oct 2026 09:30:00 +0530 (IST)", "2026-10-15T09:30:00+05:30"],
    ["Thu, 15 Oct 2026 09:30:00 GMT", "2026-10-15T09:30:00+00:00"],
    ["Thu, 15 Oct 2026 09:30:00 EST", "2026-10-15T09:30:00-05:00"],
    ["Thu, 15 Oct 2026 09:30:00 PDT", "2026-10-15T09:30:00-07:00"],
  ])("fecha %s → %s", async (header, expected) => {
    const email = await normalizeEmail(makeEml({ text: "x", date: header }), "d.eml");
    expect(email.meta.date).toBe(expected);
  });

  it("asunto con una racha enorme de espacios no cuelga el servidor", async () => {
    const raw = `From: a@b.co\r\nSubject: Cobro${" ".repeat(100_000)}octubre\r\nMIME-Version: 1.0\r\n\r\nCuerpo`;
    const t = performance.now();
    const email = await normalizeEmail(utf8(raw), "s.eml");
    expect(performance.now() - t).toBeLessThan(2000);
    expect(email.meta.subject.startsWith("Cobro")).toBe(true);
    expect(email.meta.subject.endsWith("octubre")).toBe(true);
  });

  it("vía normalizeFile: un .eml sin cabeceras reconocibles igual se trata como correo", async () => {
    const doc = await normalizeFile(utf8("Solo un cuerpo sin cabeceras"), "raro.eml");
    expect(doc.kind).toBe("email");
    expect(doc.plainText).toContain("Solo un cuerpo sin cabeceras");
  });
});
