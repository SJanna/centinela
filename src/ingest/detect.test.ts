import { describe, expect, it } from "vitest";
import { analyzeChat, detectFormat, extensionOf, looksLikeEmail, sniffMagic } from "./detect";
import { IngestError } from "./errors";
import { utf8 } from "./test-fixtures";

describe("sniffMagic", () => {
  it.each([
    [[0x25, 0x50, 0x44, 0x46, 0x2d, 0x31], "pdf"],
    [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "image/png"],
    [[0xff, 0xd8, 0xff, 0xe0], "image/jpeg"],
    [[...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBP")], "image/webp"],
    [[...Buffer.from("GIF89a")], "image/gif"],
    [[0x49, 0x49, 0x2a, 0x00], "image/tiff"],
  ])("reconoce %j", (sig, expected) => {
    const m = sniffMagic(new Uint8Array(sig), "");
    expect(m).not.toBeNull();
    if (m?.type === "pdf") expect("pdf").toBe(expected);
    else expect(m && "mediaType" in m ? m.mediaType : null).toBe(expected);
  });

  it("acepta basura antes de %PDF- solo si el nombre dice .pdf", () => {
    const bytes = new Uint8Array([0x0a, 0x0a, ...Buffer.from("%PDF-1.4")]);
    expect(sniffMagic(bytes, "pdf")).toEqual({ type: "pdf" });
    expect(sniffMagic(bytes, "txt")).toBeNull();
  });

  it("texto no tiene firma", () => {
    expect(sniffMagic(utf8("Hola"), "txt")).toBeNull();
  });
});

describe("extensionOf", () => {
  it("devuelve la extensión en minúscula", () => {
    expect(extensionOf("Factura.PDF")).toBe("pdf");
    expect(extensionOf("sin-extension")).toBe("");
    expect(extensionOf("chat.export.txt ")).toBe("txt");
  });
});

describe("looksLikeEmail", () => {
  it("sí: cabeceras con From y Subject", () => {
    expect(looksLikeEmail("From: Ana <a@b.co>\nSubject: Factura\n\nHola")).toBe(true);
  });
  it("sí: formato mbox y cabeceras plegadas", () => {
    expect(looksLikeEmail("From a@b.co Thu Oct 15 2026\nReceived: from x\n  by y\nMIME-Version: 1.0\nSubject: x\n\ncuerpo")).toBe(true);
  });
  it("no: factura en texto con «Fecha:» y «Total:»", () => {
    expect(looksLikeEmail("Fecha: 2026-10-01\nTotal: USD 1.200\n\nGracias")).toBe(false);
  });
  it("no: solo cabeceras débiles (Date, To) sin From/MIME-Version", () => {
    expect(looksLikeEmail("Invoice: 123\nDate: 2026-10-01\nTo: Andes Labs\n\nItems")).toBe(false);
  });
  it("no: chat con «Nombre: mensaje»", () => {
    expect(looksLikeEmail("Ana: hola\nPedro: hola Ana")).toBe(false);
  });
  it("no: cabecera seguida de texto libre sin línea vacía", () => {
    expect(looksLikeEmail("From: Ana\nHola, te escribo para cobrar")).toBe(false);
  });
});

describe("analyzeChat", () => {
  it("WhatsApp iOS con segundos", () => {
    const r = analyzeChat("[20/10/26, 9:41:05] Ana: hola\n[20/10/26, 9:42:00] Pedro: hola");
    expect(r).toEqual({ isChat: true, participants: ["Ana", "Pedro"] });
  });

  it("WhatsApp Android con a. m. / p. m.", () => {
    const r = analyzeChat("20/10/26, 9:41 a. m. - Ana: hola\n20/10/26, 1:05 p. m. - +57 300 1234567: listo");
    expect(r.isChat).toBe(true);
    expect(r.participants).toEqual(["Ana", "+57 300 1234567"]);
  });

  it("WhatsApp Android en inglés con AM/PM", () => {
    const r = analyzeChat("10/20/26, 9:41 AM - Ana: hi\n10/20/26, 9:45 PM - Bob: ok");
    expect(r.isChat).toBe(true);
  });

  it("copiado desde WhatsApp Web: [hora, fecha]", () => {
    const r = analyzeChat("[9:41 a. m., 20/10/2026] Pixel Pro: les envío mi cuenta de cobro\n[9:50 a. m., 20/10/2026] Pixel Pro: COP 2.000.000");
    expect(r).toEqual({ isChat: true, participants: ["Pixel Pro"] });
  });

  it("un solo mensaje con fecha en la primera línea (multilínea)", () => {
    const r = analyzeChat("[20/10/26, 9:41] Pampa Ops: Cobro de octubre\nDevOps gestionado\nTotal USD 2.800");
    expect(r.isChat).toBe(true);
  });

  it("«Nombre: mensaje» repetido entre dos personas, sin fechas", () => {
    const r = analyzeChat("Ana: hola\nPedro: hola Ana\nAna: te mando la factura\nPedro: dale\nAna: listo");
    expect(r).toEqual({ isChat: true, participants: ["Ana", "Pedro"] });
  });

  it("no: factura con campos «Clave: valor»", () => {
    const text = "Proveedor: X\nDescripción: horas\nCantidad: 40\nDescripción: extra\nCantidad: 2\nTotal: 100\nBanco: Y";
    expect(analyzeChat(text).isChat).toBe(false);
  });

  it("nombres con «de» siguen siendo personas", () => {
    const r = analyzeChat("María de los Ángeles: hola\nJuan: hola\nMaría de los Ángeles: va la cuenta\nJuan: ok");
    expect(r).toEqual({ isChat: true, participants: ["María de los Ángeles", "Juan"] });
  });

  it("no: factura con claves de varias palabras repetidas", () => {
    const text = [
      "Fecha de emisión: 2026-10-01",
      "Número de factura: 45",
      "Valor hora: USD 60",
      "Horas trabajadas: 40",
      "Valor hora: USD 60",
      "Horas trabajadas: 2",
      "Valor total: USD 2.520",
    ].join("\n");
    expect(analyzeChat(text).isChat).toBe(false);
  });

  it("no: una sola línea con fecha en medio del texto", () => {
    expect(analyzeChat("Factura 1\nVer chat:\n[20/10/26, 9:41] Ana: ok\nTotal 100").isChat).toBe(false);
  });

  it("el nombre de archivo de exportación de WhatsApp basta", () => {
    expect(analyzeChat("hola\nte mando la cuenta", "Chat de WhatsApp con Pixel Pro.txt").isChat).toBe(true);
  });
});

describe("detectFormat", () => {
  it("message/rfc822 declarado → correo aunque no tenga cabeceras", () => {
    expect(detectFormat(utf8("cuerpo"), "x", "message/rfc822")).toEqual({ kind: "email", mediaType: "message/rfc822" });
  });

  it("ignora application/octet-stream como pista", () => {
    const d = detectFormat(utf8("hola"), "nota", "application/octet-stream");
    expect(d.kind).toBe("text");
    expect(d).toMatchObject({ mediaType: "text/plain" });
  });

  it("correo copiado de Outlook en español → texto (no se pierde nada)", () => {
    const raw = "De: Pampa Ops\nEnviado: martes, 20 de octubre de 2026\nPara: Pagos\nAsunto: Cobro\n\nUSD 2.800";
    const d = detectFormat(utf8(raw), "copiado.txt");
    expect(d).toMatchObject({ kind: "text", text: raw });
  });

  it("CSV conserva su tipo", () => {
    expect(detectFormat(utf8("a,b\n1,2"), "horas.csv")).toMatchObject({ kind: "text", mediaType: "text/csv" });
  });

  it("UTF-16 con BOM (Bloc de notas de Windows)", () => {
    const bytes = new Uint8Array([0xff, 0xfe, ...Buffer.from("Total: USD 1.200", "utf16le")]);
    expect(detectFormat(bytes, "nota.txt")).toMatchObject({ kind: "text", text: "Total: USD 1.200", encoding: "utf-16le" });
  });

  it.each([
    ["foto.jpg", undefined],
    ["foto.png", "image/png"],
    ["foto", "image/jpeg"],
    ["factura", "application/pdf"],
  ])("dice ser imagen o PDF (%s, %s) pero es texto → corrupt", (name, mediaType) => {
    let caught: unknown = null;
    try {
      detectFormat(utf8("hola"), name, mediaType);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(IngestError);
    expect((caught as IngestError).code).toBe("corrupt");
  });

  it("Outlook .msg → mensaje con indicación de guardar como .eml", () => {
    const bytes = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
    expect(() => detectFormat(bytes, "factura.msg")).toThrow(/correo de Outlook \(\.msg\).*\.eml/);
  });

  it("ZIP genérico, RAR, BMP y RTF → no soportado", () => {
    expect(() => detectFormat(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0]), "f.zip")).toThrow(/^Formato no soportado: archivo comprimido \(\.zip\)/);
    expect(() => detectFormat(new Uint8Array([...Buffer.from("Rar!"), 0x1a, 0x07, 0]), "f.rar")).toThrow(/\.rar/);
    const bmp = new Uint8Array(30);
    bmp.set(Buffer.from("BM"), 0);
    bmp[14] = 40;
    expect(() => detectFormat(bmp, "f.bmp")).toThrow(/imagen BMP/);
    expect(() => detectFormat(utf8("{\\rtf1\\ansi hola}"), "f.rtf")).toThrow(/documento RTF/);
  });

  it("video MP4 → no soportado", () => {
    const bytes = new Uint8Array([0, 0, 0, 0x18, ...Buffer.from("ftypisom"), 0, 0, 0, 0, ...Buffer.from("isomiso2"), 0, 0, 0, 0]);
    expect(() => detectFormat(bytes, "video.mp4")).toThrow(/video o audio/);
  });

  it("AVIF → imagen a convertir", () => {
    const bytes = new Uint8Array([0, 0, 0, 0x1c, ...Buffer.from("ftypavif"), 0, 0, 0, 0, ...Buffer.from("avifmif1miaf"), 0, 0, 0, 0]);
    expect(detectFormat(bytes, "x.avif")).toEqual({ kind: "image", mediaType: "image/avif", native: false });
  });
});
