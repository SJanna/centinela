/**
 * Correos legítimos multipart/alternative (texto plano + HTML con el MISMO contenido), para medir
 * falsos positivos del aviso html_text_mismatch. Imitan lo que mandan clientes y sistemas reales:
 * tablas, negritas, botones con enlace, firma, aviso de confidencialidad en las dos versiones,
 * «Enviado desde mi iPhone», píxel de rastreo, logo con texto alternativo, preencabezado oculto,
 * estilos y comentarios condicionales de Outlook, fechas y montos escritos distinto en cada versión
 * (pero iguales), cuenta enmascarada en el HTML, firma S/MIME. Todos los datos son ficticios.
 */

import { makePdf } from "../test-fixtures";

const CRLF = "\r\n";

export interface AltAttachment {
  filename: string;
  contentType: string;
  content: Uint8Array | string;
}

export interface AltEmailOptions {
  from: string;
  to?: string;
  subject: string;
  date: string;
  text: string;
  html: string;
  attachments?: AltAttachment[];
  /** Firma S/MIME (multipart/signed con smime.p7s). */
  smime?: boolean;
}

function b64(content: Uint8Array | string): string {
  const buf = typeof content === "string" ? Buffer.from(content, "utf8") : Buffer.from(content);
  return buf.toString("base64").replace(/.{1,76}/g, `$&${CRLF}`).trimEnd();
}

function header(value: string): string {
  return /^[\x20-\x7E]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

/** Firma S/MIME de mentira pero con forma de DER (empieza con SEQUENCE, 0x30 0x82). */
export function fakeSmimeSignature(): Uint8Array {
  const body = Buffer.alloc(600);
  for (let i = 0; i < body.length; i++) body[i] = (i * 37 + 11) % 256;
  return new Uint8Array(Buffer.concat([Buffer.from([0x30, 0x82, 0x02, 0x54, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02]), body]));
}

/** Correo multipart/alternative; con adjuntos va dentro de multipart/mixed; con smime, dentro de multipart/signed. */
export function altEmail(o: AltEmailOptions): Uint8Array {
  const headers = [
    `From: ${header(o.from)}`,
    `To: ${o.to ?? "pagos@andeslabs.dev"}`,
    `Subject: ${header(o.subject)}`,
    `Date: ${o.date}`,
    `Message-ID: <${Buffer.from(o.subject).toString("hex").slice(0, 24)}@legit.test>`,
    "MIME-Version: 1.0",
  ];
  const alt = [
    `Content-Type: multipart/alternative; boundary="alt-boundary"`,
    "",
    "--alt-boundary",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64(o.text),
    "--alt-boundary",
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64(o.html),
    "--alt-boundary--",
  ].join(CRLF);

  let content = alt;
  const attachments = o.attachments ?? [];
  if (attachments.length > 0) {
    const parts = attachments.map((a) =>
      [
        `Content-Type: ${a.contentType}; name="${a.filename}"`,
        `Content-Disposition: attachment; filename="${a.filename}"`,
        "Content-Transfer-Encoding: base64",
        "",
        b64(a.content),
      ].join(CRLF),
    );
    content = [
      `Content-Type: multipart/mixed; boundary="mix-boundary"`,
      "",
      "--mix-boundary",
      alt,
      ...parts.map((p) => `--mix-boundary${CRLF}${p}`),
      "--mix-boundary--",
    ].join(CRLF);
  }
  if (o.smime) {
    content = [
      `Content-Type: multipart/signed; protocol="application/pkcs7-signature"; micalg=sha-256; boundary="sig-boundary"`,
      "",
      "This is a cryptographically signed message in MIME format.",
      "",
      "--sig-boundary",
      content,
      "--sig-boundary",
      `Content-Type: application/pkcs7-signature; name="smime.p7s"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="smime.p7s"`,
      "Content-Description: S/MIME Cryptographic Signature",
      "",
      b64(fakeSmimeSignature()),
      "--sig-boundary--",
    ].join(CRLF);
  }
  // El tipo de contenido del nivel superior va en las cabeceras del mensaje.
  const firstNl = content.indexOf(CRLF);
  return new Uint8Array(Buffer.from([...headers, content.slice(0, firstNl), content.slice(firstNl + CRLF.length), ""].join(CRLF), "utf8"));
}

const CONFIDENTIAL_ES =
  "AVISO DE CONFIDENCIALIDAD: Este mensaje y sus anexos son confidenciales y para uso exclusivo de su destinatario. Si lo recibió por error, avise al remitente y bórrelo.";
const CONFIDENTIAL_ES_HTML =
  "AVISO DE CONFIDENCIALIDAD: Este mensaje y sus anexos son confidenciales y para uso exclusivo de su destinatario. Si lo recibi&oacute; por error, avise al remitente y b&oacute;rrelo.";
const PIXEL = '<img src="https://t.mailtrack.test/o/8f3a91c2e7.gif" width="1" height="1" alt="" style="display:block;border:0">';

export interface LegitEmail {
  id: string;
  description: string;
  build: () => Promise<Uint8Array>;
}

export const LEGIT_ALT_EMAILS: LegitEmail[] = [
  {
    id: "L01-saas-tabla-boton",
    description: "Sistema de facturación SaaS: tabla, botón «Ver factura», logo, preencabezado oculto, píxel, fecha en palabras en el HTML",
    build: async () =>
      altEmail({
        from: "CloudMetrics Facturación <billing@cloudmetrics.io>",
        subject: "Factura CM-2026-1107 — noviembre 2026",
        date: "Thu, 05 Nov 2026 09:14:22 -0500",
        text: [
          "Hola, Andes Labs:",
          "",
          "Ya está disponible su factura de noviembre.",
          "",
          "Factura N.º: CM-2026-1107",
          "Fecha de emisión: 2026-11-05",
          "Vencimiento: 2026-11-20",
          "Periodo: 2026-11",
          "Concepto: Suscripción de monitoreo — plan Team",
          "Total a pagar: USD 1,200.00",
          "",
          "Datos para el pago:",
          "Beneficiario: CloudMetrics Inc.",
          "Banco: Silicon Valley Bank",
          "Cuenta: 3300198822",
          "ABA/Routing: 121140399",
          "",
          "Ver factura: https://billing.cloudmetrics.io/i/CM-2026-1107?utm_source=email",
          "",
          "Gracias por confiar en CloudMetrics.",
          "CloudMetrics Inc. · EIN 88-1234567 · 548 Market St, San Francisco, CA",
          "",
          CONFIDENTIAL_ES,
        ].join("\n"),
        html: `<!DOCTYPE html><html><head><meta charset="utf-8"><style>td{padding:6px 10px} .btn{background:#2563eb;color:#fff}</style></head><body>
<span style="display:none;max-height:0;overflow:hidden">Su factura CM-2026-1107 está disponible</span>
<table width="600" align="center"><tr><td><img src="https://cdn.cloudmetrics.io/logo.png" alt="CloudMetrics" width="140"></td></tr>
<tr><td><p>Hola, <b>Andes Labs</b>:</p><p>Ya est&aacute; disponible su factura de noviembre.</p>
<table border="0" cellspacing="0">
<tr><td>Factura N.&ordm;</td><td><b>CM-2026-1107</b></td></tr>
<tr><td>Fecha de emisi&oacute;n</td><td>5 de noviembre de 2026</td></tr>
<tr><td>Vencimiento</td><td>20 de noviembre de 2026</td></tr>
<tr><td>Periodo</td><td>noviembre 2026</td></tr>
<tr><td>Concepto</td><td>Suscripci&oacute;n de monitoreo &mdash; plan Team</td></tr>
<tr><td><b>Total a pagar</b></td><td><b>USD&nbsp;1,200.00</b></td></tr>
</table>
<h3>Datos para el pago</h3>
<p>Beneficiario: CloudMetrics Inc.<br>Banco: Silicon Valley Bank<br>Cuenta: 3300198822<br>ABA/Routing: 121140399</p>
<p><a class="btn" href="https://billing.cloudmetrics.io/i/CM-2026-1107?utm_source=email">Ver factura</a></p>
<p>Gracias por confiar en CloudMetrics.</p>
<p style="color:#888;font-size:11px">CloudMetrics Inc. &middot; EIN 88-1234567 &middot; 548 Market St, San Francisco, CA</p>
<p style="color:#888;font-size:10px">${CONFIDENTIAL_ES_HTML}</p>
</td></tr></table>${PIXEL}</body></html>`,
      }),
  },
  {
    id: "L02-gmail-firma-iphone",
    description: "Persona desde Gmail en el iPhone: firma, «Enviado desde mi iPhone», PDF adjunto",
    build: async () =>
      altEmail({
        from: "Camila Restrepo <facturacion@crdev.co>",
        subject: "Cuenta de cobro CRD-1062 — noviembre",
        date: "Wed, 04 Nov 2026 16:40:10 -0500",
        text: [
          "Hola equipo,",
          "",
          "Les comparto la cuenta de cobro CRD-1062 de noviembre por COP 12.000.000 (tarifa fija mensual). Va adjunta en PDF.",
          "",
          "Cuenta de ahorros Bancolombia 4512-0098-7731.",
          "",
          "Quedo atenta, mil gracias.",
          "",
          "--",
          "Camila Restrepo",
          "Desarrolladora backend · Camila Restrepo Dev S.A.S.",
          "NIT 901.456.789-1 · +57 300 555 1234",
          "",
          "Enviado desde mi iPhone",
        ].join("\n"),
        html: `<div dir="ltr"><div>Hola equipo,</div><div><br></div><div>Les comparto la cuenta de cobro <b>CRD-1062</b> de noviembre por <b>COP 12.000.000</b> (tarifa fija mensual). Va adjunta en PDF.</div><div><br></div><div>Cuenta de ahorros Bancolombia 4512-0098-7731.</div><div><br></div><div>Quedo atenta, mil gracias.</div><div><br></div>-- <br><div dir="ltr" class="gmail_signature"><div><b>Camila Restrepo</b></div><div>Desarrolladora backend &middot; Camila Restrepo Dev S.A.S.</div><div>NIT 901.456.789-1 &middot; +57 300 555 1234</div></div><div><br></div><div>Enviado desde mi iPhone</div></div>`,
        attachments: [
          {
            filename: "CRD-1062.pdf",
            contentType: "application/pdf",
            content: await makePdf({ pages: [["CUENTA DE COBRO CRD-1062", "Camila Restrepo Dev S.A.S.", "La suma de: COP 12.000.000"]] }),
          },
        ],
      }),
  },
  {
    id: "L03-pt-tabla-fecha-ddmm",
    description: "Proveedor brasileño: tabla, «R$» en el HTML y «BRL» en el texto, fechas dd/mm/aaaa en el HTML",
    build: async () =>
      altEmail({
        from: "Testa Qualidade <financeiro@testaqualidade.com.br>",
        subject: "Nota fiscal TQ-2026-231 - novembro 2026",
        date: "Mon, 02 Nov 2026 11:05:00 -0300",
        text: [
          "Prezados,",
          "",
          "Segue a nota fiscal de serviços de novembro.",
          "",
          "Prestador: Testa Qualidade Ltda (CNPJ 12.345.678/0001-90)",
          "Nota fiscal: TQ-2026-231",
          "Emissão: 2026-11-02",
          "Vencimento: 2026-11-17",
          "QA manual e automatizado - mensal: BRL 9.500,00",
          "Total: BRL 9.500,00",
          "",
          "Dados para pagamento: Itaú Unibanco, conta 0341-45678-9, SWIFT ITAUBRSP.",
          "",
          "Atenciosamente,",
          "Financeiro - Testa Qualidade",
          "",
          "Esta mensagem pode conter informação confidencial. Se você a recebeu por engano, avise o remetente.",
        ].join("\n"),
        html: `<html><body><p>Prezados,</p><p>Segue a nota fiscal de servi&ccedil;os de novembro.</p>
<table style="border-collapse:collapse"><tr><th align="left">Prestador</th><td>Testa Qualidade Ltda (CNPJ 12.345.678/0001-90)</td></tr>
<tr><th align="left">Nota fiscal</th><td>TQ-2026-231</td></tr><tr><th align="left">Emiss&atilde;o</th><td>02/11/2026</td></tr>
<tr><th align="left">Vencimento</th><td>17/11/2026</td></tr>
<tr><td>QA manual e automatizado - mensal</td><td>R$ 9.500,00</td></tr><tr><th align="left">Total</th><td><strong>R$ 9.500,00</strong></td></tr></table>
<p>Dados para pagamento: Ita&uacute; Unibanco, conta 0341-45678-9, SWIFT ITAUBRSP.</p><p>Atenciosamente,<br>Financeiro - Testa Qualidade</p>
<p style="font-size:10px;color:#999">Esta mensagem pode conter informa&ccedil;&atilde;o confidencial. Se voc&ecirc; a recebeu por engano, avise o remetente.</p></body></html>`,
      }),
  },
  {
    id: "L04-soles-entidades",
    description: "Proveedor peruano: entidades HTML, montos «S/ 6,000.00», aviso de confidencialidad largo en ambas",
    build: async () =>
      altEmail({
        from: "Inca Contenidos <cobranzas@incacontenidos.pe>",
        subject: "Factura INC-2026-341 — noviembre 2026",
        date: "Tue, 03 Nov 2026 10:00:00 -0500",
        text: [
          "Estimados:",
          "",
          "Adjuntamos el detalle de la factura del mes.",
          "",
          "Proveedor: Inca Contenidos S.A.C. — RUC 20601234567",
          "Factura N°: INC-2026-341",
          "Fecha de emisión: 2026-11-03",
          "Concepto: Marketing de contenidos — mensual (noviembre 2026)",
          "Total a pagar: S/ 6,000.00",
          "Cuenta BCP 191-2345678-0-12 (SWIFT BCPLPEPL)",
          "",
          "Saludos cordiales,",
          "Área de Cobranzas",
          "",
          CONFIDENTIAL_ES,
        ].join("\n"),
        html: `<html><body style="font-family:Arial"><p>Estimados:</p><p>Adjuntamos el detalle de la factura del mes.</p>
<p>Proveedor: <b>Inca Contenidos S.A.C.</b> &mdash; RUC 20601234567<br>Factura N&deg;: INC-2026-341<br>Fecha de emisi&oacute;n: 2026-11-03<br>
Concepto: Marketing de contenidos &mdash; mensual (noviembre 2026)<br><b>Total a pagar: S/&nbsp;6,000.00</b><br>Cuenta BCP 191-2345678-0-12 (SWIFT BCPLPEPL)</p>
<p>Saludos cordiales,<br>&Aacute;rea de Cobranzas</p><hr><p style="font-size:9px">${CONFIDENTIAL_ES_HTML}</p></body></html>`,
      }),
  },
  {
    id: "L05-ingles-due-date-palabras",
    description: "Factura en inglés: «Due November 20, 2026» en el HTML y ISO en el texto, «$2,400.00» vs «USD 2400.00», botón de pago",
    build: async () =>
      altEmail({
        from: "Datos del Sur Billing <facturas@datosdelsur.cl>",
        subject: "Invoice DS-4471 from Datos del Sur",
        date: "Fri, 06 Nov 2026 08:00:00 -0300",
        text: [
          "Hi Andes Labs team,",
          "",
          "Your invoice DS-4471 for USD 2400.00 is due 2026-11-20.",
          "",
          "Service: Data engineering retainer (November 2026)",
          "Amount due: USD 2400.00",
          "Pay by wire to Banco de Chile, account 00-123-45678-09, SWIFT BCHICLRM.",
          "",
          "View invoice: https://pay.datosdelsur.cl/inv/DS-4471",
          "",
          "Questions? Reply to this email or write to facturas@datosdelsur.cl.",
          "Datos del Sur SpA · RUT 76.543.210-K · Santiago, Chile",
        ].join("\n"),
        html: `<html><body><h2>Datos del Sur</h2><p>Hi Andes Labs team,</p><p>Your invoice <strong>DS-4471</strong> for <strong>$2,400.00</strong> is due <strong>November 20, 2026</strong>.</p>
<table><tr><td>Service</td><td>Data engineering retainer (November 2026)</td></tr><tr><td>Amount due</td><td>USD 2,400.00</td></tr></table>
<p>Pay by wire to Banco de Chile, account 00-123-45678-09, SWIFT BCHICLRM.</p>
<p><a href="https://pay.datosdelsur.cl/inv/DS-4471" style="padding:10px;background:#111;color:#fff">View invoice</a></p>
<p>Questions? Reply to this email or write to <a href="mailto:facturas@datosdelsur.cl">facturas@datosdelsur.cl</a>.</p>
<p style="color:#777">Datos del Sur SpA &middot; RUT 76.543.210-K &middot; Santiago, Chile</p>${PIXEL}</body></html>`,
      }),
  },
  {
    id: "L06-outlook-mso",
    description: "Outlook: estilos, clases MsoNormal, <o:p>, comentarios condicionales; el texto lo genera el propio Outlook",
    build: async () =>
      altEmail({
        from: "Nopal Studio <admin@nopalstudio.mx>",
        subject: "Factura NS-0912 octubre",
        date: "Mon, 02 Nov 2026 12:30:00 -0600",
        text: [
          "Buenas tardes,",
          "",
          "Adjunto la factura NS-0912 correspondiente a octubre de 2026 por MXN 86,400.00 (IVA incluido).",
          "",
          "CLABE: 012180001234567891 (BBVA México).",
          "",
          "Saludos,",
          "",
          "Laura Méndez",
          "Administración | Nopal Studio",
          "Tel. +52 55 5555 0101",
        ].join("\n"),
        html: `<html xmlns:o="urn:schemas-microsoft-com:office:office"><head><style><!-- p.MsoNormal{margin:0cm;font-size:11.0pt;font-family:"Calibri",sans-serif;} --></style><!--[if gte mso 9]><xml><o:shapedefaults v:ext="edit" spidmax="1026" /></xml><![endif]--></head>
<body lang="ES-MX"><div class="WordSection1"><p class="MsoNormal">Buenas tardes,<o:p></o:p></p><p class="MsoNormal"><o:p>&nbsp;</o:p></p>
<p class="MsoNormal">Adjunto la factura NS-0912 correspondiente a octubre de 2026 por <b>MXN 86,400.00</b> (IVA incluido).<o:p></o:p></p><p class="MsoNormal"><o:p>&nbsp;</o:p></p>
<p class="MsoNormal">CLABE: 012180001234567891 (BBVA M&eacute;xico).<o:p></o:p></p><p class="MsoNormal"><o:p>&nbsp;</o:p></p>
<p class="MsoNormal">Saludos,<o:p></o:p></p><p class="MsoNormal"><o:p>&nbsp;</o:p></p><p class="MsoNormal"><b>Laura M&eacute;ndez</b><o:p></o:p></p>
<p class="MsoNormal">Administraci&oacute;n | Nopal Studio<o:p></o:p></p><p class="MsoNormal">Tel. +52 55 5555 0101<o:p></o:p></p></div></body></html>`,
      }),
  },
  {
    id: "L07-gmail-imagen-enlaces",
    description: "Texto generado por Gmail desde el HTML: «[image: …]» por el logo y enlaces entre <>",
    build: async () =>
      altEmail({
        from: "Andes Hosting <billing@andeshosting.co>",
        subject: "Factura AH-2026-118",
        date: "Sat, 07 Nov 2026 07:45:00 -0500",
        text: [
          "[image: Andes Hosting]",
          "",
          "Factura AH-2026-118 · servidor dedicado · noviembre 2026",
          "",
          "Valor total: COP 1.850.000",
          "Pague en línea <https://pagos.andeshosting.co/AH-2026-118> o por transferencia a Davivienda 0570-0012-3456.",
          "",
          "Equipo de Facturación",
          "Andes Hosting S.A.S. · NIT 900.111.222-3",
        ].join("\n"),
        html: `<div><img src="cid:logo@andes" alt="Andes Hosting" width="120"></div><p>Factura <b>AH-2026-118</b> &middot; servidor dedicado &middot; noviembre 2026</p>
<p>Valor total: <b>COP 1.850.000</b></p><p><a href="https://pagos.andeshosting.co/AH-2026-118">Pague en l&iacute;nea</a> o por transferencia a Davivienda 0570-0012-3456.</p>
<p>Equipo de Facturaci&oacute;n<br>Andes Hosting S.A.S. &middot; NIT 900.111.222-3</p>`,
      }),
  },
  {
    id: "L08-cuenta-enmascarada",
    description: "El HTML enmascara la cuenta («terminada en 7731») y el texto la trae completa; fecha «4 nov. 2026»",
    build: async () =>
      altEmail({
        from: "Camila Restrepo Dev <facturacion@crdev.co>",
        subject: "Recordatorio: cuenta de cobro CRD-1062",
        date: "Thu, 12 Nov 2026 09:00:00 -0500",
        text: [
          "Hola,",
          "",
          "Les recuerdo la cuenta de cobro CRD-1062 del 2026-11-04 por COP 12.000.000.",
          "Pago a la cuenta de ahorros Bancolombia 4512-0098-7731.",
          "",
          "Gracias,",
          "Camila",
        ].join("\n"),
        html: `<p>Hola,</p><p>Les recuerdo la cuenta de cobro <b>CRD-1062</b> del 4 nov. 2026 por <b>COP 12.000.000</b>.<br>Pago a la cuenta de ahorros Bancolombia terminada en 7731.</p><p>Gracias,<br>Camila</p>`,
      }),
  },
  {
    id: "L09-horas-tabla",
    description: "Factura por horas con tabla (cantidad, tarifa e importe en celdas) frente a «40 h x MXN 900.00» en el texto",
    build: async () =>
      altEmail({
        from: "Diseño Pixel <hola@disenopixel.mx>",
        subject: "Factura DP-311 · horas de octubre",
        date: "Sun, 01 Nov 2026 18:20:00 -0600",
        text: [
          "Hola, les envío la factura DP-311 de octubre 2026.",
          "",
          "Diseño UX: 40 h x MXN 900.00 = MXN 36,000.00",
          "Total: MXN 36,000.00",
          "",
          "Transferencia a Banorte, CLABE 072180009876543210.",
          "",
          "Saludos,",
          "Diseño Pixel",
        ].join("\n"),
        html: `<p>Hola, les env&iacute;o la factura <b>DP-311</b> de octubre 2026.</p><table border="1"><tr><th>Concepto</th><th>Horas</th><th>Tarifa</th><th>Importe</th></tr>
<tr><td>Diseño UX</td><td>40</td><td>MXN 900.00</td><td>MXN 36,000.00</td></tr><tr><td colspan="3"><b>Total</b></td><td><b>MXN 36,000.00</b></td></tr></table>
<p>Transferencia a Banorte, CLABE 072180009876543210.</p><p>Saludos,<br>Diseño Pixel</p>`,
      }),
  },
  {
    id: "L10-ver-navegador-pie",
    description: "Plantilla con «Ver en el navegador» solo en el HTML, «© 2026» solo en el HTML, pie legal en ambas",
    build: async () =>
      altEmail({
        from: "Contadores Asociados <facturas@contadoresasociados.cl>",
        subject: "Factura CA-7781 noviembre",
        date: "Tue, 10 Nov 2026 10:10:00 -0300",
        text: [
          "Estimado cliente:",
          "",
          "Le informamos que se emitió la factura CA-7781 por sus servicios contables de noviembre 2026.",
          "",
          "Monto: CLP 1.250.000",
          "Fecha de emisión: 10-11-2026",
          "Depósito en Banco Estado, cuenta corriente 123-4-567890-1.",
          "",
          "Contadores Asociados Ltda. · Av. Providencia 1234, Santiago",
          "Para dejar de recibir estos avisos, responda este correo.",
        ].join("\n"),
        html: `<html><body><p style="font-size:10px"><a href="https://mail.contadoresasociados.cl/v/CA-7781">Ver en el navegador</a></p>
<p>Estimado cliente:</p><p>Le informamos que se emiti&oacute; la factura <b>CA-7781</b> por sus servicios contables de noviembre 2026.</p>
<table><tr><td>Monto</td><td>CLP 1.250.000</td></tr><tr><td>Fecha de emisi&oacute;n</td><td>10-11-2026</td></tr></table>
<p>Dep&oacute;sito en Banco Estado, cuenta corriente 123-4-567890-1.</p>
<p style="color:#999">&copy; 2026 Contadores Asociados Ltda. &middot; Av. Providencia 1234, Santiago<br>Para dejar de recibir estos avisos, responda este correo.</p>${PIXEL}</body></html>`,
      }),
  },
  {
    id: "L11-iphone-corto",
    description: "Correo corto desde el iPhone con PDF adjunto: «Enviado desde mi iPhone» en ambas versiones",
    build: async () =>
      altEmail({
        from: "Martín Ortega <martin@ortega-legal.ar>",
        subject: "Honorarios octubre",
        date: "Mon, 02 Nov 2026 21:02:00 -0300",
        text: "Hola! Les mando la factura de honorarios de octubre (ARS 1.500.000). Cualquier cosa me avisan.\n\nEnviado desde mi iPhone",
        html: `<html><head><meta http-equiv="content-type" content="text/html; charset=utf-8"></head><body dir="auto">Hola! Les mando la factura de honorarios de octubre (ARS 1.500.000). Cualquier cosa me avisan.<br><br><div dir="ltr">Enviado desde mi iPhone</div></body></html>`,
        attachments: [
          {
            filename: "factura-C-0001-00000042.pdf",
            contentType: "application/pdf",
            content: await makePdf({ pages: [["FACTURA C 0001-00000042", "Martín Ortega", "Total: ARS 1.500.000"]] }),
          },
        ],
      }),
  },
  {
    id: "L12-smime-firmado",
    description: "Correo firmado con S/MIME (multipart/signed + smime.p7s), texto y HTML iguales",
    build: async () =>
      altEmail({
        from: "Facturación Ferretería Industrial <facturacion@ferreteriaind.co>",
        subject: "Factura electrónica FI-20931",
        date: "Wed, 11 Nov 2026 14:00:00 -0500",
        text: [
          "Señores Andes Labs:",
          "",
          "Adjuntamos la factura electrónica FI-20931 del 2026-11-11 por COP 3.480.000.",
          "Cuenta corriente Banco de Bogotá 001-23456-7.",
          "",
          "Este correo está firmado digitalmente.",
          "Ferretería Industrial S.A.S.",
        ].join("\n"),
        html: `<p>Se&ntilde;ores Andes Labs:</p><p>Adjuntamos la factura electr&oacute;nica <b>FI-20931</b> del 2026-11-11 por <b>COP 3.480.000</b>.<br>Cuenta corriente Banco de Bogot&aacute; 001-23456-7.</p><p><i>Este correo est&aacute; firmado digitalmente.</i><br>Ferreter&iacute;a Industrial S.A.S.</p>`,
        smime: true,
      }),
  },
];
