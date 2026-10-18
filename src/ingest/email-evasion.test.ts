/**
 * Revisión adversarial del arreglo de V1/V2 (docs/REDTEAM.md): variantes de correo hechas para que
 * una persona vea en su cliente un recibo («PAGADO») o datos de cobro distintos de lo que lee el
 * sistema, sin que la entrada deje aviso. Cada caso que antes pasaba sin aviso es un posible pago
 * indebido: el texto plano es una factura por pagar y las lecturas guardadas de INY-04 la pagaban
 * (ver src/extract/redteam-emails.test.ts).
 */
import { describe, expect, it } from "vitest";
import type { NormalizedDoc } from "@/core/schemas";
import { HTML_VERSION_BLOCK } from "./email";
import { normalizeFile } from "./index";
import { altEmail } from "./test-data/legit-emails";
import { makeEml, makeImage } from "./test-fixtures";

const CRLF = "\r\n";

const TEXT = [
  "Estimados,",
  "",
  "Adjuntamos el detalle de la factura del mes.",
  "",
  "Proveedor: CloudMetrics Inc.",
  "Factura N°: CM-2026-1007",
  "Periodo: 2026-10",
  "Fecha de emisión: 2026-10-05",
  "Vencimiento: 2026-10-20",
  "Concepto: Suscripción de monitoreo, plan Team (octubre 2026)",
  "Total a pagar: USD 1,200.00",
  "",
  "Datos para el pago:",
  "Banco: Silicon Valley Bank",
  "Cuenta: 3300198822",
  "",
  "Quedamos atentos.",
  "CloudMetrics, Facturación",
].join("\n");

/** La misma factura en HTML; `extra` va al final del cuerpo y `edit` cambia el cuerpo. */
function html(extra = "", edit: (s: string) => string = (s) => s, head = "<style>p{font-family:Arial}</style>"): string {
  const body = TEXT.split("\n\n")
    .map((p) => `<p>${p.split("\n").join("<br>")}</p>`)
    .join("\n");
  return `<html><head>${head}</head><body>${edit(body)}${extra}</body></html>`;
}

const RECEIPT = "<h1>Estado: PAGADO. Factura saldada el 2026-10-02.</h1>";

function alt(htmlBody: string, text = TEXT): Uint8Array {
  return altEmail({ from: "CloudMetrics <billing@cloudmetrics.io>", subject: "Factura CM-2026-1007", date: "Mon, 05 Oct 2026 09:14:22 -0500", text, html: htmlBody });
}

function b64(content: Uint8Array | string): string {
  const buf = typeof content === "string" ? Buffer.from(content, "utf8") : Buffer.from(content);
  return buf.toString("base64").replace(/.{1,76}/g, `$&${CRLF}`).trimEnd();
}

/** multipart/alternative con el HTML dentro de multipart/related junto a imágenes con Content-ID. */
function related(htmlBody: string, images: { cid: string; png: Uint8Array }[], text = TEXT): Uint8Array {
  const rel = [
    `Content-Type: multipart/related; boundary="rel"`,
    "",
    "--rel",
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64(htmlBody),
    ...images.flatMap((img) => [
      "--rel",
      `Content-Type: image/png; name="${img.cid}.png"`,
      `Content-Disposition: inline; filename="${img.cid}.png"`,
      `Content-ID: <${img.cid}>`,
      "Content-Transfer-Encoding: base64",
      "",
      b64(img.png),
    ]),
    "--rel--",
  ].join(CRLF);
  const raw = [
    "From: CloudMetrics <billing@cloudmetrics.io>",
    "To: pagos@andeslabs.dev",
    "Subject: Factura CM-2026-1007",
    "Date: Mon, 05 Oct 2026 09:14:22 -0500",
    "Message-ID: <related@cloudmetrics.io>",
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="alt"`,
    "",
    "--alt",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64(text),
    "--alt",
    rel,
    "--alt--",
    "",
  ].join(CRLF);
  return new Uint8Array(Buffer.from(raw, "utf8"));
}

const codes = (doc: NormalizedDoc) => (doc.warnings ?? []).map((w) => w.code);
const messages = (doc: NormalizedDoc) => (doc.warnings ?? []).map((w) => w.message).join(" | ");

describe("control", () => {
  it("la misma factura en texto y HTML no avisa", async () => {
    const doc = await normalizeFile(alt(html()), "igual.eml");
    expect(doc.warnings).toEqual([]);
  });
});

describe("recibo en el HTML escondido del extractor pero visible en algún cliente → aviso y el detector lo ve", () => {
  const cases: [string, string][] = [
    ["comentario vacío <!-->", html(`<!-->${RECEIPT}<!-- fin -->`)],
    ["comentario vacío <!--->", html(`<!--->${RECEIPT}<!-- fin -->`)],
    ["comentario cerrado con --!>", html(`<!-- a --!>${RECEIPT}<!-- fin -->`)],
    ["comentario condicional de Outlook", html(`<!--[if mso]>${RECEIPT}<![endif]-->`)],
    ["<xmp> con «<!--» adentro", html(`<xmp><!--</xmp>${RECEIPT}<!-- x -->`)],
    ["<textarea> con «<!--» adentro", html(`<textarea><!--</textarea>${RECEIPT}<!-- x -->`)],
    ["<title> con «<!--» adentro", html(`<title><!--</title>${RECEIPT}<!-- x -->`)],
    ["contenido escrito dentro de <head>", html("", undefined, `<title>Factura</title>${RECEIPT}`)],
    ["<noscript>", html(`<noscript>${RECEIPT}</noscript>`)],
    ["texto generado con CSS (content)", html('<h1 class="e"></h1>', undefined, '<style>.e::after{content:"Estado: PAGADO. Factura saldada."}</style>')],
    ["texto generado con CSS escapado", html('<h1 class="e"></h1>', undefined, '<style>.e::after{content:"\\50 \\41 \\47 \\41 \\44 \\4f "}</style>')],
    ["texto alternativo con comillas simples", html("<img src='cid:sello' alt='Estado: PAGADO. Factura saldada.'>")],
    ["valor de un campo de formulario", html('<input value="Estado: PAGADO. Factura saldada.">')],
    ["«<» que no abre etiqueta", html("<p>Gracias <3 Estado: PAGADO. Factura saldada. ></p>")],
    ["«>» dentro de un atributo", html(`<a title=">x<!--">${RECEIPT}</a><!-- y -->`)],
    ["entidades sin punto y coma", html("<h1>Estado: PAG&#65DO. Factura sald&#97da.</h1>")],
  ];

  it.each(cases)("%s", async (_name, htmlBody) => {
    const doc = await normalizeFile(alt(htmlBody), "variante.eml");
    expect(codes(doc)).toContain("html_text_mismatch");
    expect(messages(doc)).toContain("«pagado»");
    expect(doc.plainText).toContain(`${HTML_VERSION_BLOCK}\n`);
    expect(doc.plainText).toMatch(/PAGADO/);
  });

  it("recibo con letras cirílicas que se ven latinas («РАGАDО») → aviso con la palabra que imita", async () => {
    const doc = await normalizeFile(alt(html("<h1>Estado: \u0420\u0410G\u0410D\u041E</h1>")), "homoglifos.eml");
    expect(codes(doc)).toContain("html_text_mismatch");
    expect(messages(doc)).toContain("«pagado»");
  });

  it("un comentario normal NO avisa: ningún cliente lo muestra, así que una persona tampoco lo ve", async () => {
    const doc = await normalizeFile(alt(html("<!-- Estado: PAGADO. Factura saldada. -->")), "comentario.eml");
    expect(doc.warnings).toEqual([]);
  });

  it("un recibo oculto con CSS (display:none) SÍ avisa: qué se oculta depende del cliente (Outlook ignora display:none en varias etiquetas) y es el canal típico para esconder texto", async () => {
    const doc = await normalizeFile(alt(html(`<div style="display:none">${RECEIPT}</div>`)), "oculto.eml");
    expect(codes(doc)).toContain("html_text_mismatch");
  });
});

describe("el HTML cambia solo una cifra o la moneda", () => {
  it.each([
    ["monto", (s: string) => s.replace("1,200.00", "1,250.00")],
    ["monto con un decimal («120.0» no es «1,200.00»)", (s: string) => s.replace("1,200.00", "120.0")],
    ["monto en otra escala («12.000,00»)", (s: string) => s.replace("1,200.00", "12.000,00")],
    ["cuenta", (s: string) => s.replace("3300198822", "3300198823")],
    ["vencimiento", (s: string) => s.replace("2026-10-20", "2026-10-21")],
    ["moneda (USD → EUR)", (s: string) => s.replace("USD", "EUR")],
  ])("%s → aviso", async (_name, edit) => {
    const doc = await normalizeFile(alt(html("", edit)), "cifra.eml");
    expect(codes(doc)).toEqual(["html_text_mismatch"]);
  });

  it("la moneda escrita de otra forma (US$, dólares) no avisa", async () => {
    const doc = await normalizeFile(alt(html("", (s) => s.replace("USD 1,200.00", "US$ 1.200,00"))), "usd.eml");
    expect(doc.warnings).toEqual([]);
  });
});

describe("el HTML no tiene texto (solo imágenes) y el texto plano sí", () => {
  it("una imagen con Content-ID (lo que ve una persona es la imagen) → aviso", async () => {
    const png = await makeImage("png", 600, 300);
    const doc = await normalizeFile(related('<html><body><img src="cid:recibo"></body></html>', [{ cid: "recibo", png }]), "solo-imagen.eml");
    expect(codes(doc)).toEqual(["html_text_mismatch"]);
    expect(messages(doc)).toContain("la versión HTML no tiene texto");
  });

  it("una imagen remota → aviso", async () => {
    const doc = await normalizeFile(alt('<html><body><img src="https://cdn.example.test/recibo.png" width="600"></body></html>'), "remota.eml");
    expect(codes(doc)).toEqual(["html_text_mismatch"]);
  });

  it("multipart/related legítimo (la factura en HTML con su logo) no avisa", async () => {
    const logo = await makeImage("png", 40, 40);
    const doc = await normalizeFile(related(html('<img src="cid:logo" alt="">'), [{ cid: "logo", png: logo }]), "related.eml");
    expect(doc.warnings).toEqual([]);
  });

  it("sin texto plano y con la factura en HTML se lee el HTML, sin aviso (como antes)", async () => {
    const doc = await normalizeFile(makeEml({ html: html() }), "solo-html.eml");
    expect(doc.warnings).toEqual([]);
    expect(doc.plainText).toContain("Total a pagar: USD 1,200.00");
  });
});

describe("texto que se muestra distinto de como se lee (orden invertido, alfabetos mezclados)", () => {
  it("forzado de dirección (U+202E) en el texto y el HTML: «ODAGAP» se ve «PAGADO» → aviso", async () => {
    const reversed = "Estado: \u202EODAGAP\u202C";
    const doc = await normalizeFile(alt(html(`<p>${reversed}</p>`), `${TEXT}\n${reversed}`), "bidi.eml");
    expect(codes(doc)).toContain("deceptive_text");
    expect(messages(doc)).toContain("invierten el orden");
  });

  it("<bdo dir=rtl> y unicode-bidi:bidi-override en el HTML → aviso", async () => {
    for (const trick of ['<bdo dir="rtl">ODAGAP</bdo>', '<span style="unicode-bidi:bidi-override;direction:rtl">ODAGAP</span>', "&#8238;ODAGAP"]) {
      const doc = await normalizeFile(alt(html(`<p>Estado: ${trick}</p>`), `${TEXT}\nEstado: ODAGAP`), "bidi-html.eml");
      expect(codes(doc)).toContain("deceptive_text");
    }
  });

  it("una palabra con letras latinas y cirílicas en un correo de solo texto → aviso", async () => {
    const doc = await normalizeFile(makeEml({ text: `${TEXT}\nEstado: \u0420\u0410G\u0410D\u041E` }), "mezcla.eml");
    expect(codes(doc)).toEqual(["deceptive_text"]);
    expect(messages(doc)).toContain("mezcla letras de alfabetos distintos");
  });

  it("no avisan: «µ», «º», «ª», «°», un nombre en griego o cirílico completo", async () => {
    const doc = await normalizeFile(makeEml({ text: `${TEXT}\nEspesor 5µm, 1º y 2ª cuota, 20 °C. Ref.: \u0391\u03B8\u03AE\u03BD\u03B1, \u041C\u043E\u0441\u043A\u0432\u0430.` }), "ok.eml");
    expect(doc.warnings).toEqual([]);
  });
});

describe("adjuntos con formato no soportado o tipo falso", () => {
  const PK = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]);
  it.each([
    ["comprobante.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", PK],
    ["comprobante.zip", "application/zip", PK],
    ["comprobante.rar", "application/vnd.rar", new Uint8Array([...Buffer.from("Rar!\u001a\u0007\u0000"), 1])],
    ["comprobante.odt", "application/vnd.oasis.opendocument.text", PK],
    ["comprobante.rtf", "application/rtf", new Uint8Array(Buffer.from("{\\rtf1 PAGADO}"))],
    ["comprobante.7z", "application/x-7z-compressed", new Uint8Array([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0, 4])],
    ["comprobante.pdf", "application/pdf", PK],
    ["comprobante.pdf", "application/octet-stream", new Uint8Array(Buffer.from("<html><body>PAGADO</body></html>"))],
  ])("%s (%s) → aviso", async (filename, contentType, content) => {
    const doc = await normalizeFile(makeEml({ text: TEXT, attachments: [{ filename, contentType, content }] }), "adjunto.eml");
    expect(codes(doc)).toEqual(["attachment_unreadable"]);
  });

  it("un .html adjunto se lee, también con los trucos de comentario", async () => {
    const doc = await normalizeFile(
      makeEml({ text: TEXT, attachments: [{ filename: "comprobante.html", contentType: "text/html", content: `<html><body><!-->${RECEIPT}<!-- x --></body></html>` }] }),
      "adjunto-html.eml",
    );
    expect(doc.plainText).toContain("Estado: PAGADO");
  });
});

// El corpus de correos legítimos (test-data/legit-emails.ts, con firma S/MIME) se prueba en email-warnings.test.ts.
describe("falsos positivos", () => {
  it("plantilla tipo MJML: condicionales de Outlook con <xml>, botón VML, preencabezado oculto, viñetas con CSS", async () => {
    const head =
      "<title>Factura CM-2026-1007</title>" +
      "<!--[if !mso]><!--><meta http-equiv=\"X-UA-Compatible\" content=\"IE=edge\"><!--<![endif]-->" +
      '<style type="text/css">#outlook a{padding:0;} .c:after{content:"";display:table;clear:both} li:before{content:"\\2022"}</style>' +
      "<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->" +
      "<!--[if lte mso 11]><style type=\"text/css\">.mj-outlook-group-fix{width:100% !important;}</style><![endif]-->";
    const button =
      '<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="https://x.test/f" style="height:40px;width:200px" arcsize="10%" fillcolor="#2563eb"><w:anchorlock/><center style="color:#fff">Ver factura</center></v:roundrect><![endif]-->' +
      '<!--[if !mso]><!-- --><a href="https://x.test/f">Ver factura</a><!--<![endif]-->';
    const preheader = '<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">Factura CM-2026-1007 de CloudMetrics</div>';
    const doc = await normalizeFile(alt(html(`${preheader}${button}`, undefined, head), `${TEXT}\n\nVer factura: https://x.test/f`), "mjml.eml");
    expect(doc.warnings).toEqual([]);
  });
});

describe("PDF adjunto que no se puede abrir", () => {
  it("va igual a los lectores, pero avisa: ni el texto ni los detectores lo vieron", async () => {
    const doc = await normalizeFile(
      makeEml({ text: TEXT, attachments: [{ filename: "comprobante.png", contentType: "image/png", content: new Uint8Array(Buffer.from("%PDF-1.4 roto")) }] }),
      "pdf-roto.eml",
    );
    expect(doc.warnings).toEqual([
      { code: "attachment_unreadable", message: "El correo trae un adjunto que no se pudo leer: comprobante.png (PDF que no se pudo abrir)" },
    ]);
    expect(doc.parts.map((p) => p.type)).toEqual(["text", "pdf"]);
  });
});

describe("paráfrasis de «ya está pago» en el HTML", () => {
  it.each([
    ["<p>Usted no adeuda nada por este concepto.</p>", "«adeuda»"],
    ["<p>Payment processed. Nothing else to do.</p>", "«processed»"],
    ["<p>Pago efectuado con su tarjeta.</p>", "«efectuado»"],
  ])("%s → aviso", async (extra, term) => {
    const doc = await normalizeFile(alt(html(extra)), "parafrasis.eml");
    expect(codes(doc)).toEqual(["html_text_mismatch"]);
    expect(messages(doc)).toContain(term);
  });

  it("límite conocido: una paráfrasis corta sin cifras ni términos decisivos no avisa (queda para los lectores, que ven el HTML)", async () => {
    const doc = await normalizeFile(alt(html("<p>Esta factura ya quedó al día.</p>")), "al-dia.eml");
    expect(doc.warnings).toEqual([]);
    expect(doc.plainText).toContain(`${HTML_VERSION_BLOCK}\n`);
    expect(doc.plainText).toContain("Esta factura ya quedó al día.");
  });
});

describe("remitente con letras que imitan latinas", () => {
  it("«CloudMеtrics» (е cirílica) en el nombre del remitente → aviso", async () => {
    const doc = await normalizeFile(makeEml({ from: "CloudM\u0435trics <billing@cloudmetrics.io>", text: TEXT }), "remitente.eml");
    expect(codes(doc)).toEqual(["deceptive_text"]);
    expect(messages(doc)).toContain("se ve «CloudMetrics»");
  });
});
