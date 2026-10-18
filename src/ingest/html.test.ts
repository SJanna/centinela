/**
 * htmlToText frente a HTML hecho para que una persona vea algo que el texto extraído no trae
 * (revisión adversarial del arreglo V1 del equipo rojo). Cada caso es una diferencia entre cómo
 * muestra el HTML un navegador o un cliente de correo (Outlook, Apple Mail, Gmail) y lo que dejaba
 * htmlToText: el «PAGADO» quedaba fuera del texto, así que ni la comparación con el texto plano ni
 * el detector de documento ya pagado lo veían.
 *
 * La regla: lo que algún cliente de correo puede mostrar entra al texto. Sobrar texto escala; faltar
 * texto puede pagar.
 */
import { describe, expect, it } from "vitest";
import { htmlToText } from "./text";

const RECEIPT = "Estado: PAGADO";

describe("htmlToText · comentarios como los cierra un navegador", () => {
  it.each([
    ["<!--> (comentario vacío)", `<p>Factura</p><!--><h1>${RECEIPT}</h1><!-- fin -->`],
    ["<!---> (comentario vacío)", `<p>Factura</p><!---><h1>${RECEIPT}</h1><!-- fin -->`],
    ["--!> (cierre incorrecto pero válido)", `<p>Factura</p><!-- a --!><h1>${RECEIPT}</h1><!-- fin -->`],
  ])("%s: el texto que sigue se ve", (_name, html) => {
    expect(htmlToText(html)).toContain(RECEIPT);
  });

  it("un comentario normal no se ve (ningún cliente lo muestra)", () => {
    expect(htmlToText(`<p>Factura</p><!-- ${RECEIPT} -->`)).toBe("Factura");
  });

  it("comentario condicional de Outlook: Outlook muestra su contenido, así que entra", () => {
    expect(htmlToText(`<p>Factura</p><!--[if mso]><h1>${RECEIPT}</h1><![endif]-->`)).toContain(RECEIPT);
    expect(htmlToText(`<p>Factura</p><!--[if gte mso 9]><table><tr><td>${RECEIPT}</td></tr></table><![endif]-->`)).toContain(RECEIPT);
  });

  it("…pero no los datos de configuración de Office (<xml>) ni lo de los demás clientes se pierde", () => {
    const html =
      "<head><!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->" +
      "<!--[if gte mso 9]><xml><o:shapedefaults v:ext=\"edit\" spidmax=\"1026\" /></xml><![endif]--></head>" +
      '<body><!--[if !mso]><!--><a href="https://x.test">Ver factura</a><!--<![endif]--><p>Total USD 1,200.00</p></body>';
    expect(htmlToText(html)).toBe("Ver factura\nTotal USD 1,200.00");
  });
});

describe("htmlToText · elementos de texto crudo (un «<!--» adentro no es comentario)", () => {
  it.each(["xmp", "textarea", "title", "noembed", "noframes", "iframe"])("<%s> con «<!--» adentro no esconde lo que sigue", (tag) => {
    expect(htmlToText(`<p>Factura</p><${tag}><!--</${tag}><h1>${RECEIPT}</h1><!-- x -->`)).toContain(RECEIPT);
  });

  it("<title> no se muestra; <textarea> y <xmp> sí, tal cual", () => {
    expect(htmlToText("<title>Correo</title><p>Factura</p>")).toBe("Factura");
    expect(htmlToText("<textarea>Nota: PAGADO</textarea>")).toBe("Nota: PAGADO");
    expect(htmlToText("<xmp><b>PAGADO</b></xmp>")).toContain("PAGADO");
  });

  it("CDATA (en SVG o MathML es texto visible)", () => {
    expect(htmlToText(`<svg><text><![CDATA[${RECEIPT}]]></text></svg>`)).toContain(RECEIPT);
  });
});

describe("htmlToText · contenido que algún cliente muestra", () => {
  it("lo que se escribe dentro de <head> fuera de title/style/script se muestra (el navegador lo pasa al cuerpo)", () => {
    const html = `<html><head><title>Factura</title><style>p{}</style><h1>${RECEIPT}</h1></head><body><p>Total</p></body></html>`;
    const out = htmlToText(html);
    expect(out).toContain(RECEIPT);
    expect(out).not.toContain("p{}");
  });

  it("<noscript> (los clientes de correo no corren scripts: lo muestran) y <template>", () => {
    expect(htmlToText(`<noscript>${RECEIPT}</noscript>`)).toBe(RECEIPT);
    expect(htmlToText(`<template>${RECEIPT}</template>`)).toBe(RECEIPT);
  });

  it("texto generado con CSS (content, list-style, quotes), también con escapes, attr() y var()", () => {
    expect(htmlToText(`<style>h1::after{content:"${RECEIPT}"}</style><h1></h1>`)).toContain(RECEIPT);
    expect(htmlToText('<style>h1:before { content : "\\50 \\41 \\47 \\41 \\44 \\4f " }</style><h1></h1>')).toContain("PAGADO");
    expect(htmlToText('<style>.e::after{con\\74 ent:"PAGADO"}</style>')).toContain("PAGADO");
    expect(htmlToText('<style>.e::after{content:/**/"PAGADO; listo"}</style>')).toContain("PAGADO; listo");
    expect(htmlToText(`<style>.e::after{content:attr(data-estado)}</style><span class="e" data-estado='${RECEIPT}'></span>`)).toContain(RECEIPT);
    expect(htmlToText(`<style>.e::after{content:var(--estado)}</style><span class="e" style="--estado:'${RECEIPT}'"></span>`)).toContain(RECEIPT);
    expect(htmlToText('<style>li{list-style-type:"PAGADO "}</style><ul><li>x</li></ul>')).toContain("PAGADO");
    expect(htmlToText('<style>q{quotes:"PAGADO" ""}</style><q></q>')).toContain("PAGADO");
  });

  it("…sin inventar texto: content vacío, viñetas y comentarios de CSS no agregan palabras", () => {
    // El texto generado va al final, en su propio párrafo.
    expect(htmlToText('<style>.c:after{content:"";display:table} /* content:"PAGADO" */ li:before{content:"\\2022"}</style><p>Factura</p>')).toBe(
      "Factura\n\n•",
    );
    expect(htmlToText('<style>p{font-family:"Helvetica Neue",Arial}</style><p>Factura</p>')).toBe("Factura");
  });

  it("texto alternativo de imágenes con cualquier comilla (Outlook lo muestra con las imágenes bloqueadas)", () => {
    expect(htmlToText(`<img src='cid:x' alt='${RECEIPT}'>`)).toContain(RECEIPT);
    expect(htmlToText("<img src=cid:x alt=PAGADO>")).toContain("PAGADO");
    expect(htmlToText(`<area alt="${RECEIPT}" href="#">`)).toContain(RECEIPT);
  });

  it("valor y texto de ayuda de campos de formulario (menos los ocultos)", () => {
    expect(htmlToText(`<input type="text" value="${RECEIPT}">`)).toContain(RECEIPT);
    expect(htmlToText(`<input placeholder="${RECEIPT}">`)).toContain(RECEIPT);
    expect(htmlToText(`<input type="hidden" value="${RECEIPT}">`)).toBe("");
  });
});

describe("htmlToText · etiquetas y entidades como las lee un navegador", () => {
  it("«<» que no abre una etiqueta es texto (antes se perdía todo hasta el siguiente «>»)", () => {
    expect(htmlToText(`<p>Total 1 <3 ${RECEIPT} ></p>`)).toBe(`Total 1 <3 ${RECEIPT} >`);
    expect(htmlToText(`<p>a < ${RECEIPT} > b</p>`)).toBe(`a < ${RECEIPT} > b`);
  });

  it("un «>» dentro de un atributo entre comillas no cierra la etiqueta", () => {
    expect(htmlToText(`<a title=">x<!--">${RECEIPT}</a><!-- y -->`)).toContain(RECEIPT);
    expect(htmlToText(`<p data-x='a>b'>${RECEIPT}</p>`)).toBe(RECEIPT);
  });

  it("entidades sin punto y coma, letras con tilde y letras matemáticas o griegas con nombre", () => {
    expect(htmlToText("PAG&#65DO")).toBe("PAGADO");
    expect(htmlToText("PAG&#x41;DO")).toBe("PAGADO");
    expect(htmlToText("PAG&AacuteDO")).toBe("PAGÁDO");
    expect(htmlToText("&Acirc;&Auml;&Aring;&ouml;")).toBe("ÂÄÅö");
    expect(htmlToText("&Popf;&Afr;&Gscr;")).toBe("PAG");
    expect(htmlToText("&Rho;&Alpha;&Ocy;")).toBe("\u03A1\u0391\u041E"); // Rho y Alfa griegas, O cirílica
    expect(htmlToText("a &foo; b &#0; c &amp d")).toBe("a &foo; b &#0; c & d");
  });
});

describe("htmlToText · tiempo lineal con las reglas nuevas", () => {
  const N = 100_000;
  const elapsed = (fn: () => unknown) => {
    const t = performance.now();
    fn();
    return performance.now() - t;
  };
  it.each([
    ["comillas sin cerrar", '<a b="'.repeat(N / 6)],
    ["«>» entre comillas", '<p a=">">'.repeat(N / 9)],
    ["condicionales sin cerrar", "<!--[if mso]>".repeat(N / 13)],
    ["CSS con content sin valor", `<style>${"a{content:".repeat(N / 10)}</style>`],
    ["CSS con var() y attr()", `<style>${"a::after{content:var(--x) attr(data-x)}".repeat(N / 40)}</style>${'<i style="--x:\'a\'" data-x="b">'.repeat(1000)}`],
    ["cierres casi iguales", `<style>${"</styl".repeat(N / 6)}`],
    ["textarea sin cerrar", "<textarea>".repeat(N / 10)],
    ["«<3» repetido", "<3".repeat(N / 2)],
    ["entidades sin «;»", "&aacute".repeat(N / 7)],
  ])("%s", (_name, html) => {
    expect(elapsed(() => htmlToText(html))).toBeLessThan(1000);
  });
});
