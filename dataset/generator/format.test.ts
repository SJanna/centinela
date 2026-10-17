import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { simpleParser } from "mailparser";
import { amountInWords, copAmountInWords, formatDate, formatMoney, formatPeriod, parseLastAmount, spanishNumberWords } from "./format";
import { buildEml, encodeHeaderWord, encodeQuotedPrintable } from "./render/email";
import { buildChat } from "./render/chat";
import type { Locale } from "./spec";

describe("formato local de montos", () => {
  it("usa el formato de cada país", () => {
    expect(formatMoney(12000000, "COP", "es-CO")).toBe("COP 12.000.000");
    expect(formatMoney(9500, "BRL", "pt-BR")).toBe("R$ 9.500,00");
    expect(formatMoney(36000, "MXN", "es-MX")).toBe("$36,000.00 MXN");
    expect(formatMoney(6000, "PEN", "es-PE")).toBe("S/ 6,000.00");
    expect(formatMoney(4500, "USD", "es-CO")).toBe("USD 4.500,00");
    expect(formatMoney(1200, "USD", "en-US")).toBe("$1,200.00");
    expect(formatMoney(0, "COP", "es-CO")).toBe("COP 0");
  });

  it("parseLastAmount lee de vuelta lo que formatMoney escribe", () => {
    const locales: Array<[Locale, string]> = [
      ["es-CO", "COP"], ["es-CO", "USD"], ["pt-BR", "BRL"], ["es-MX", "MXN"], ["es-PE", "PEN"], ["es-CL", "USD"], ["en-US", "USD"],
    ];
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 99_999_999 }), fc.constantFrom(...locales), (cents, [locale, cur]) => {
        const amount = cur === "COP" ? Math.round(cents / 100) : cents / 100;
        expect(parseLastAmount(formatMoney(amount, cur, locale))).toBe(amount);
      }),
    );
  });

  it("interpreta separadores ambiguos como en los documentos", () => {
    expect(parseLastAmount("Total: USD 2.800")).toBe(2800);
    expect(parseLastAmount("Total a pagar: USD 2.100 (exento)")).toBe(2100);
    expect(parseLastAmount("Impuestos: R$ 0,00")).toBe(0);
    expect(parseLastAmount("VAT: USD 0.00")).toBe(0);
    expect(parseLastAmount("sin monto")).toBeNull();
  });
});

describe("fechas y periodos", () => {
  it("formatea según el idioma", () => {
    expect(formatDate("2026-10-06", "es-CO", "long")).toBe("6 de octubre de 2026");
    expect(formatDate("2026-10-06", "es-CO", "short")).toBe("06/10/2026");
    expect(formatDate("2026-10-01", "en-US", "long")).toBe("October 1, 2026");
    expect(formatDate("2026-10-15", "en-US", "medium")).toBe("Oct 15, 2026");
    expect(formatPeriod("2026-10", "es-CO")).toBe("Octubre 2026");
    expect(formatPeriod("2026-10", "pt-BR")).toBe("Outubro/2026");
    expect(formatPeriod("2026-10", "en-US", "range")).toBe("Oct 1 – Oct 31, 2026");
  });
});

describe("monto en letras", () => {
  it("escribe números en español", () => {
    expect(spanishNumberWords(12000000)).toBe("doce millones");
    expect(spanishNumberWords(1800)).toBe("mil ochocientos");
    expect(spanishNumberWords(21000)).toBe("veintiún mil");
    expect(spanishNumberWords(4125)).toBe("cuatro mil ciento veinticinco");
    expect(spanishNumberWords(1001000)).toBe("un millón mil");
    expect(spanishNumberWords(100)).toBe("cien");
    expect(copAmountInWords(12000000)).toBe("DOCE MILLONES DE PESOS M/CTE");
    expect(copAmountInWords(4760000)).toBe("CUATRO MILLONES SETECIENTOS SESENTA MIL PESOS M/CTE");
    expect(amountInWords(2400, "USD")).toBe("DOS MIL CUATROCIENTOS DÓLARES ESTADOUNIDENSES CON 00/100");
    expect(amountInWords(21, "USD")).toBe("VEINTIÚN DÓLARES ESTADOUNIDENSES CON 00/100");
    expect(amountInWords(6040, "PEN")).toBe("SEIS MIL CUARENTA CON 00/100 SOLES");
    expect(amountInWords(36000, "MXN")).toBe("TREINTA Y SEIS MIL PESOS 00/100 M.N.");
    expect(amountInWords(9500, "BRL")).toBe("NUEVE MIL QUINIENTOS REALES CON 00/100");
    expect(amountInWords(1218.5, "USD")).toBe("MIL DOSCIENTOS DIECIOCHO DÓLARES ESTADOUNIDENSES CON 50/100");
    expect(amountInWords(10, "EUR")).toBeNull();
  });
});

describe("correo y chat", () => {
  it("quoted-printable respeta 76 columnas y se decodifica igual", async () => {
    const text = `Línea con acentos: áéíóú ñ ç ã — ${"x".repeat(150)}= fin \nSegunda línea con espacio final `;
    const qp = encodeQuotedPrintable(text);
    for (const line of qp.split("\r\n")) expect(line.length).toBeLessThanOrEqual(76);
    const eml = buildEml(
      { from: "Facturación <a@b.co>", to: "Pagos <c@d.co>", cc: null, subject: "Prueba ñandú", date: "Wed, 07 Oct 2026 09:14:22 -0300", messageId: "<x@b.co>", body: text.split("\n") },
      null,
    );
    const mail = await simpleParser(eml);
    expect(mail.subject).toBe("Prueba ñandú");
    expect(mail.from?.value[0].name).toBe("Facturación");
    expect(String(mail.text)).toContain("Segunda línea con espacio final");
    expect(String(mail.text)).toContain("áéíóú ñ ç ã");
    expect(String(mail.text)).toContain(`${"x".repeat(150)}= fin`);
  });

  it("no parte caracteres de varios bytes entre líneas ni excede 75 caracteres por palabra codificada", () => {
    const text = `${"ñ".repeat(60)} ${"áé".repeat(40)} €€€ ${"x".repeat(70)}ç`;
    for (const line of encodeQuotedPrintable(text).split("\r\n")) {
      const raw = line.replace(/=$/, "");
      const bytes: number[] = [];
      for (let i = 0; i < raw.length; i++) {
        if (raw[i] === "=") {
          bytes.push(parseInt(raw.slice(i + 1, i + 3), 16));
          i += 2;
        } else bytes.push(raw.charCodeAt(i));
      }
      expect(() => new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes))).not.toThrow();
    }
    const header = encodeHeaderWord(`Factura electrónica ${"ñ".repeat(50)} – octubre`);
    for (const word of header.split("\r\n ")) expect(word.length).toBeLessThanOrEqual(75);
  });

  it("el chat tiene una línea con fecha por mensaje y continúa los mensajes largos", () => {
    const txt = buildChat([
      { date: "14/10/2026", time: "10:02", sender: null, text: "Aviso" },
      { date: "14/10/2026", time: "10:03", sender: "Ana", text: "Hola\nsegunda línea" },
    ]);
    expect(txt).toBe("14/10/2026, 10:02 - Aviso\n14/10/2026, 10:03 - Ana: Hola\nsegunda línea\n");
  });
});
