/**
 * Avisos de la entrada en correos (NormalizedDoc.warnings): versión HTML distinta del texto plano y
 * adjuntos que no se pudieron leer. Los cuatro ataques del equipo rojo que se pagaban (INY-04, INY-07,
 * INY-10, INY-13; copias de redteam/attacks/inyeccion en test-data/redteam) y un corpus de correos
 * legítimos multipart/alternative que no debe dar ningún aviso.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { NormalizedDoc } from "@/core/schemas";
import { HTML_VERSION_BLOCK, HTML_VERSION_LABEL, isBenignAttachment } from "./email";
import { normalizeFile } from "./index";
import { LEGIT_ALT_EMAILS, altEmail, fakeSmimeSignature } from "./test-data/legit-emails";
import { makeEml, makePdf } from "./test-fixtures";

const here = path.dirname(fileURLToPath(import.meta.url));
const attack = (file: string) => new Uint8Array(readFileSync(path.join(here, "test-data", "redteam", file)));

function labels(doc: NormalizedDoc): string[] {
  return doc.parts.map((p) => (p.type === "text" ? (p.label ?? "texto") : p.type));
}

describe("ataques del equipo rojo · versión HTML distinta del texto (V1)", () => {
  const cases = [
    { file: "INY-04-eml-html-vs-texto.eml", terms: ["«recibido»", "«pagado»"], figure: "2026-10-02", paidLine: "Estado: PAGADO." },
    { file: "INY-07-eml-cuenta-cobro-saldada.eml", terms: ["«recibo»", "«saldada»"], figure: "2026-10-03", paidLine: "Factura saldada." },
    { file: "INY-13-eml-pen-cancelada.eml", terms: ["«constancia»", "«recibido»", "«acreditado»"], figure: "2026-10-02", paidLine: "Estado: PAGADO." },
  ];

  it.each(cases)("$file → aviso html_text_mismatch y el HTML entra a la lectura", async ({ file, terms, figure, paidLine }) => {
    const doc = await normalizeFile(attack(file), file);
    expect(doc.warnings).toHaveLength(1);
    const [w] = doc.warnings ?? [];
    expect(w.code).toBe("html_text_mismatch");
    expect(w.message).toMatch(/^El correo trae una versión HTML distinta del texto plano: el HTML dice /);
    for (const t of terms) expect(w.message).toContain(t);
    expect(w.message).toContain(`el HTML trae cifras que el texto no tiene (${figure})`);
    // Lo que ve una persona (el HTML) ahora lo ven los lectores y los detectores.
    expect(labels(doc)).toEqual(["correo", HTML_VERSION_LABEL]);
    expect(doc.plainText).toContain(`${HTML_VERSION_BLOCK}\n`);
    expect(doc.plainText).toContain(paidLine);
    // La parte «correo» sigue siendo el texto plano (la factura por pagar), sin el recibo del HTML.
    const first = doc.parts[0];
    expect(first.type).toBe("text");
    if (first.type === "text") {
      expect(first.text).toMatch(/Total a pagar|Debe a mí la suma de/);
      expect(first.text).not.toContain(paidLine);
    }
  });
});

describe("ataques del equipo rojo · adjunto que no se pudo leer (V2)", () => {
  it("INY-10: el .docx «comprovante_pago» → aviso attachment_unreadable con el nombre", async () => {
    const doc = await normalizeFile(attack("INY-10-eml-adjunto-omitido.eml"), "INY-10.eml");
    expect(doc.warnings).toEqual([
      { code: "attachment_unreadable", message: "El correo trae un adjunto que no se pudo leer: comprovante_pago.docx (formato no soportado)" },
    ]);
    expect(doc.meta.skippedAttachments).toBe("comprovante_pago.docx (formato no soportado)");
  });
});

describe("falsos positivos · correos legítimos multipart/alternative", () => {
  it(`hay al menos 10 correos legítimos en el corpus (${LEGIT_ALT_EMAILS.length})`, () => {
    expect(LEGIT_ALT_EMAILS.length).toBeGreaterThanOrEqual(10);
  });

  it.each(LEGIT_ALT_EMAILS.map((e) => [e.id, e] as const))("%s: 0 avisos", async (_id, email) => {
    const doc = await normalizeFile(await email.build(), `${email.id}.eml`);
    expect(doc.warnings, email.description).toEqual([]);
    expect(doc.kind).toBe("email");
  });

  it("firma S/MIME: smime.p7s se omite sin aviso (benigno) y el cuerpo se lee", async () => {
    const smime = LEGIT_ALT_EMAILS.find((e) => e.id.includes("smime"));
    expect(smime).toBeDefined();
    const doc = await normalizeFile(await smime!.build(), "firmado.eml");
    expect(doc.meta.attachments).toBe("smime.p7s");
    expect(doc.meta.skippedAttachments).toBe("smime.p7s (formato no soportado)");
    expect(doc.warnings).toEqual([]);
    expect(doc.plainText).toContain("FI-20931");
  });

  it("la versión HTML con algo de presentación propio se agrega a la lectura, sin aviso", async () => {
    const email = LEGIT_ALT_EMAILS.find((e) => e.id.startsWith("L10"));
    const doc = await normalizeFile(await email!.build(), "l10.eml");
    expect(doc.warnings).toEqual([]);
    expect(labels(doc)).toEqual(["correo", HTML_VERSION_LABEL]);
    expect(doc.plainText).toContain("Ver en el navegador");
  });

  it("si las dos versiones dicen exactamente lo mismo, no se duplica el cuerpo", async () => {
    const doc = await normalizeFile(makeEml({ text: "Factura 77 por USD 300.00", html: "<p>Factura <b>77</b> por USD&nbsp;300.00</p>" }), "igual.eml");
    expect(doc.warnings).toEqual([]);
    expect(labels(doc)).toEqual(["correo"]);
    expect(doc.plainText).not.toContain(HTML_VERSION_BLOCK);
  });
});

describe("adjuntos que no se pudieron leer", () => {
  const docx = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]);

  it("PDF con contraseña, PDF dañado y formato no soportado → un aviso por adjunto", async () => {
    const locked = await makePdf({ pages: [["Comprobante"]], userPassword: "x" });
    const doc = await normalizeFile(
      makeEml({
        text: "Factura y soportes adjuntos.",
        attachments: [
          { filename: "soporte.pdf", contentType: "application/pdf", content: locked },
          { filename: "roto.pdf", contentType: "application/pdf", content: new TextEncoder().encode("no es un pdf") },
          { filename: "recibo.docx", contentType: "application/octet-stream", content: docx },
        ],
      }),
      "varios.eml",
    );
    expect(doc.warnings?.map((w) => w.message)).toEqual([
      "El correo trae un adjunto que no se pudo leer: soporte.pdf (PDF con contraseña)",
      "El correo trae un adjunto que no se pudo leer: roto.pdf (archivo dañado)",
      "El correo trae un adjunto que no se pudo leer: recibo.docx (formato no soportado)",
    ]);
    expect(doc.warnings?.every((w) => w.code === "attachment_unreadable")).toBe(true);
  });

  it("por encima del máximo de adjuntos → aviso por cada uno que no se leyó", async () => {
    const attachments = Array.from({ length: 11 }, (_, i) => ({ filename: `nota-${i + 1}.txt`, contentType: "text/plain", content: `Nota ${i + 1}` }));
    const doc = await normalizeFile(makeEml({ text: "Notas", attachments }), "muchos.eml");
    expect(doc.warnings).toEqual([
      { code: "attachment_unreadable", message: "El correo trae un adjunto que no se pudo leer: nota-11.txt (se leen como máximo 10 adjuntos)" },
    ]);
  });

  it("no avisan: un logo diminuto, un adjunto vacío, una firma S/MIME, una vCard ni una invitación .ics", async () => {
    const { makeImage } = await import("./test-fixtures");
    const doc = await normalizeFile(
      makeEml({
        text: "Factura adjunta.",
        attachments: [
          { filename: "logo.png", contentType: "image/png", content: await makeImage("png", 32, 32), inline: true },
          { filename: "vacio.pdf", contentType: "application/pdf", content: new Uint8Array() },
          { filename: "smime.p7s", contentType: "application/pkcs7-signature", content: fakeSmimeSignature() },
          { filename: "contacto.vcf", contentType: "text/vcard", content: "BEGIN:VCARD\nVERSION:3.0\nFN:Ana Gómez\nEND:VCARD" },
          { filename: "cita.ics", contentType: "text/calendar", content: "BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR" },
        ],
      }),
      "benignos.eml",
    );
    expect(doc.warnings).toEqual([]);
  });

  it("isBenignAttachment exige el tipo o la extensión Y el contenido: un .docx renombrado no cuenta", () => {
    expect(isBenignAttachment("smime.p7s", "application/pkcs7-signature", fakeSmimeSignature())).toBe(true);
    expect(isBenignAttachment("firma.p7s", undefined, fakeSmimeSignature())).toBe(true);
    expect(isBenignAttachment("tarjeta.vcf", "text/x-vcard", new TextEncoder().encode("﻿  begin:vcard\nEND:VCARD"))).toBe(true);
    expect(isBenignAttachment("comprobante.ics", "text/calendar", docx)).toBe(false);
    expect(isBenignAttachment("smime.p7s", "application/pkcs7-signature", docx)).toBe(false);
    expect(isBenignAttachment("comprobante.docx", "application/pkcs7-signature", new Uint8Array())).toBe(false);
    expect(isBenignAttachment("recibo.pdf", "application/pdf", fakeSmimeSignature())).toBe(false);
  });

  it("un .docx renombrado a .ics avisa", async () => {
    const doc = await normalizeFile(
      makeEml({ text: "Adjunto el comprobante.", attachments: [{ filename: "comprobante.ics", contentType: "text/calendar", content: docx }] }),
      "renombrado.eml",
    );
    expect(doc.warnings?.map((w) => w.code)).toEqual(["attachment_unreadable"]);
  });
});

describe("correo adjunto (reenviado)", () => {
  it("los avisos del correo de adentro suben al de afuera, con su nombre", async () => {
    const inner = altEmail({
      from: "CloudMetrics <billing@cloudmetrics.io>",
      subject: "Factura CM-2026-1007",
      date: "Mon, 05 Oct 2026 09:14:22 -0500",
      text: "Factura CM-2026-1007. Total a pagar: USD 1,200.00. Cuenta 3300198822.",
      html: "<p>Factura CM-2026-1007. <b>Estado: PAGADO</b> el 2026-10-02. Total: USD 1,200.00.</p>",
    });
    const outer = makeEml({
      text: "Te reenvío la factura de CloudMetrics.",
      attachments: [{ filename: "original.eml", contentType: "message/rfc822", content: inner }],
    });
    const doc = await normalizeFile(outer, "reenvio.eml");
    expect(doc.warnings).toHaveLength(1);
    expect(doc.warnings?.[0].code).toBe("html_text_mismatch");
    expect(doc.warnings?.[0].message).toMatch(/^El correo trae una versión HTML distinta del texto plano: .*\(en el correo adjunto «original\.eml»\)$/);
    expect(labels(doc)).toEqual(["correo", "correo adjunto: original.eml", "correo adjunto: original.eml (versión HTML)"]);
  });
});
