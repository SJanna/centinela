/**
 * HTML → texto plano para la entrada (cuerpo de un correo y archivos .html). Puro, sin dependencias.
 *
 * Regla: entra al texto todo lo que ALGÚN cliente de correo o navegador puede mostrar. Si sobra
 * texto, lo peor es que la factura escale; si falta, se puede pagar algo que una persona ve como ya
 * pagado (revisión adversarial de V1, docs/REDTEAM.md). Por eso:
 *
 * - Se conserva el texto oculto con CSS (display:none, color blanco, tamaño 0): qué se oculta depende
 *   del cliente, y es el canal típico para esconder instrucciones.
 * - Comentarios: se cierran como en un navegador («-->», «--!>», y los vacíos «<!-->» y «<!--->»).
 *   Un comentario normal no lo muestra ningún cliente y no entra. Los condicionales de Outlook
 *   («<!--[if mso]>…<![endif]-->») sí: Outlook muestra su contenido (salvo los datos <xml> de Office).
 * - «<» que no abre una etiqueta («<3», «< b») es texto, y un «>» dentro de un atributo entre
 *   comillas no cierra la etiqueta.
 * - Elementos de texto crudo (adentro, «<!--» no es comentario): script y style no se muestran (de
 *   style se toma el texto que genera con CSS: content, list-style, quotes, con escapes, attr() y
 *   var()); title e iframe tampoco; textarea, xmp, noembed y noframes se muestran tal cual;
 *   plaintext, todo lo que sigue. CDATA (en SVG o MathML) es texto.
 * - <head> no se salta entero (un navegador pasa al cuerpo lo que no es de la cabecera), y
 *   noscript y template se leen (en un cliente de correo no corren scripts).
 * - Texto alternativo de imágenes y áreas con cualquier comilla (Outlook lo muestra con las imágenes
 *   bloqueadas) y valor y texto de ayuda de los campos de formulario (menos type=hidden).
 * - Entidades como las decodifica un navegador: numéricas sin «;», las clásicas sin «;» («&aacute»),
 *   letras latinas con tilde, griegas y cirílicas, y letras matemáticas («&Popf;» → «P»).
 *
 * Tiempo lineal: un correo hecho a propósito no debe colgar el servidor (las expresiones regulares
 * de antes eran cuadráticas con muchos «<!--», «<script>» o «<» sin cerrar).
 */

// ───────────────────────── Entidades ─────────────────────────

const NAMED: Record<string, string> = {
  nbsp: " ",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
  amp: "&",
  AMP: "&",
  lt: "<",
  LT: "<",
  gt: ">",
  GT: ">",
  quot: '"',
  QUOT: '"',
  COPY: "©",
  REG: "®",
  apos: "'",
  euro: "€",
  trade: "™",
  bull: "•",
  hellip: "…",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  sbquo: "‚",
  ldquo: "“",
  rdquo: "”",
  bdquo: "„",
  zwnj: "\u200C",
  zwj: "\u200D",
  lrm: "\u200E",
  rlm: "\u200F",
  shy: "",
};

/** Nombres que un navegador decodifica aunque falte el «;» (los de HTML 3.2 / Latin-1). */
const LEGACY = new Set(["amp", "AMP", "lt", "LT", "gt", "GT", "quot", "QUOT", "COPY", "REG", "nbsp", "shy"]);

function addRange(names: string, first: number, legacy: boolean): void {
  names.split(" ").forEach((name, i) => {
    if (name === "-") return;
    NAMED[name] ??= String.fromCodePoint(first + i);
    if (legacy) LEGACY.add(name);
  });
}
// U+00A0–U+00FF (nbsp y shy ya están, como espacio y nada).
addRange(
  "nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute " +
    "micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig " +
    "Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash " +
    "Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc " +
    "euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml " +
    "yacute thorn yuml",
  0xa0,
  true,
);
// Griego (U+0391–U+03A9 y U+03B1–U+03C9): se ven como letras latinas («&Rho;&Alpha;» ≈ «PA»).
addRange("Alpha Beta Gamma Delta Epsilon Zeta Eta Theta Iota Kappa Lambda Mu Nu Xi Omicron Pi Rho - Sigma Tau Upsilon Phi Chi Psi Omega", 0x391, false);
addRange("alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigmaf sigma tau upsilon phi chi psi omega", 0x3b1, false);
// Cirílico (U+0410–U+044F y algunas letras sueltas).
addRange(
  "Acy Bcy Vcy Gcy Dcy IEcy ZHcy Zcy Icy Jcy Kcy Lcy Mcy Ncy Ocy Pcy Rcy Scy Tcy Ucy Fcy KHcy TScy CHcy SHcy SHCHcy " +
    "HARDcy Ycy SOFTcy Ecy YUcy YAcy acy bcy vcy gcy dcy iecy zhcy zcy icy jcy kcy lcy mcy ncy ocy pcy rcy scy tcy ucy " +
    "fcy khcy tscy chcy shcy shchcy hardcy ycy softcy ecy yucy yacy",
  0x410,
  false,
);
for (const [name, code] of [
  ["IOcy", 0x401], ["DScy", 0x405], ["Iukcy", 0x406], ["YIcy", 0x407], ["Jsercy", 0x408], ["Ubrcy", 0x40e],
  ["iocy", 0x451], ["dscy", 0x455], ["iukcy", 0x456], ["yicy", 0x457], ["jsercy", 0x458], ["ubrcy", 0x45e],
] as const) {
  NAMED[name] = String.fromCodePoint(code);
}

/** Letras matemáticas con nombre («&Aopf;» 𝔸, «&Afr;» 𝔄, «&Ascr;» 𝒜): se ven como la letra (NFKD también las pliega). */
const MATH_LETTER = /^([A-Za-z])(?:opf|fr|scr)$/;

function namedEntity(name: string): string | null {
  return NAMED[name] ?? MATH_LETTER.exec(name)?.[1] ?? null;
}

const ENTITY = /&(?:#(\d{1,8})|#[xX]([0-9a-fA-F]{1,7})|([A-Za-z][A-Za-z0-9]{0,31}))(;?)/g;

/** Decodifica entidades como un navegador en el texto (numéricas y clásicas también sin «;»). */
export function decodeEntities(s: string): string {
  return s.replace(ENTITY, (whole: string, dec: string | undefined, hex: string | undefined, name: string | undefined, semi: string) => {
    if (dec != null || hex != null) {
      const code = dec != null ? parseInt(dec, 10) : parseInt(hex ?? "", 16);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return whole;
      return String.fromCodePoint(code);
    }
    const n = name ?? "";
    if (semi) {
      const full = namedEntity(n);
      if (full != null) return full;
    }
    // Sin «;» (o desconocida): el nombre clásico más largo al principio («&aacuteDO» → «áDO»).
    for (let k = Math.min(n.length, 6); k >= 2; k--) {
      const prefix = n.slice(0, k);
      if (LEGACY.has(prefix)) return NAMED[prefix] + n.slice(k) + semi;
    }
    return whole;
  });
}

// ───────────────────────── Etiquetas ─────────────────────────

/** Etiquetas de bloque: salto de línea al abrir y al cerrar. */
const BLOCK_TAGS = new Set([
  "p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "table", "section", "article", "header", "footer",
  "blockquote", "pre", "address", "xmp", "noembed", "noframes", "center",
]);

/** Etiquetas que dan salto de línea solo al cerrar. */
const BLOCK_CLOSE_TAGS = new Set([
  "tr", "li", "ul", "ol", "thead", "tbody", "tfoot", "dl", "dt", "dd", "form", "fieldset", "figure",
  "figcaption", "caption",
]);

/**
 * Filas y elementos de lista: al abrir empiezan línea nueva si no la hay. En HTML el cierre es
 * opcional («<tr><td>Total<td>1.200<tr>…»); sin esto las filas y celdas quedaban pegadas.
 */
const LINE_START_TAGS = new Set(["tr", "li"]);

/** Texto crudo que no se muestra (hasta su cierre). De style se toma el texto generado con CSS. */
const RAW_HIDDEN = new Set(["script", "style", "title", "iframe"]);
/** Texto crudo que se muestra tal cual (hasta su cierre). */
const RAW_SHOWN = new Set(["textarea", "xmp", "noembed", "noframes"]);

function isSpace(c: number): boolean {
  return c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0c || c === 0x0d;
}

function isAsciiAlpha(c: number): boolean {
  return (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
}

/** ¿Es espacio horizontal (espacio, tabulación o espacio duro)? */
function isBlank(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0xa0;
}

function trimBlanks(line: string): string {
  let a = 0;
  let b = line.length;
  while (a < b && isBlank(line.charCodeAt(a))) a++;
  while (b > a && isBlank(line.charCodeAt(b - 1))) b--;
  return a === 0 && b === line.length ? line : line.slice(a, b);
}

/** Minúsculas solo en ASCII: mismo largo que el original, así los índices coinciden. */
function asciiLower(s: string): string {
  return s.replace(/[A-Z]+/g, (m) => m.toLowerCase());
}

/**
 * indexOf que no vuelve a recorrer: recuerda, por patrón, la última búsqueda. Si se pide desde una
 * posición entre la anterior y lo que encontró, la respuesta es la misma.
 */
class Finder {
  private readonly cache = new Map<string, { from: number; at: number }>();
  constructor(private readonly s: string) {}
  next(pattern: string, from: number): number {
    const c = this.cache.get(pattern);
    if (c && from >= c.from && (c.at === -1 || c.at >= from)) return c.at;
    const at = this.s.indexOf(pattern, from);
    this.cache.set(pattern, { from, at });
    return at;
  }
}

/** Valor de un atributo dentro de una etiqueta (sin «<» ni «>»), con comillas dobles, simples o sin comillas. */
function attribute(tag: string, name: string): string | null {
  const re = new RegExp(`(?:^|[\\s/"'])${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\`]+))`, "i");
  const m = re.exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3] ?? "") : null;
}

/** Texto que muestran los atributos de una etiqueta de apertura. */
function attributeText(name: string, tag: string): string[] {
  const out: string[] = [];
  const push = (v: string | null) => {
    if (v != null && v.trim() !== "") out.push(v);
  };
  if (name === "img" || name === "area") push(attribute(tag, "alt"));
  else if (name === "input") {
    const type = (attribute(tag, "type") ?? "").trim().toLowerCase();
    if (type !== "hidden") {
      push(attribute(tag, "value"));
      push(attribute(tag, "placeholder"));
      if (type === "image") push(attribute(tag, "alt"));
    }
  } else if (name === "textarea") push(attribute(tag, "placeholder"));
  else if (name === "option" || name === "optgroup") push(attribute(tag, "label"));
  return out;
}

// ───────────────────────── Texto generado con CSS ─────────────────────────

/** Escape de CSS en `s[i]` («\\50 » → «P», «\\"» → «"»): [carácter, largo]. */
function cssEscape(s: string, i: number): [string, number] {
  const m = /^\\([0-9a-fA-F]{1,6})(\r\n|[ \t\n\r\f])?/.exec(s.slice(i, i + 8));
  if (m) {
    const code = parseInt(m[1], 16);
    const ch = code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) ? "\uFFFD" : String.fromCodePoint(code);
    return [ch, m[0].length];
  }
  if (i + 1 >= s.length) return ["", 1];
  if (s[i + 1] === "\n") return ["", 2];
  return [s[i + 1], 2];
}

/** Lee una cadena de CSS que empieza en `s[i]`: [contenido sin escapes, índice después del cierre]. */
function cssString(s: string, i: number): [string, number] {
  const quote = s[i];
  let out = "";
  let j = i + 1;
  while (j < s.length && s[j] !== quote && s[j] !== "\n") {
    if (s[j] === "\\") {
      const [ch, len] = cssEscape(s, j);
      out += ch;
      j += len;
    } else out += s[j++];
  }
  return [out, j + 1];
}

/**
 * CSS sin comentarios y con los escapes de los nombres resueltos («con\\74 ent» → «content»); las
 * cadenas quedan como están (con sus comillas). Un «/*» dentro de una cadena no es comentario.
 */
function cleanCss(css: string): string {
  const out: string[] = [];
  let i = 0;
  let start = 0;
  while (i < css.length) {
    const ch = css[i];
    if (ch === "/" && css[i + 1] === "*") {
      out.push(css.slice(start, i), " ");
      const end = css.indexOf("*/", i + 2);
      i = end === -1 ? css.length : end + 2;
      start = i;
    } else if (ch === '"' || ch === "'") {
      i = cssString(css, i)[1];
    } else if (ch === "\\") {
      const [decoded, len] = cssEscape(css, i);
      out.push(css.slice(start, i), /^[\w-]$/.test(decoded) ? decoded : css.slice(i, i + len));
      i += len;
      start = i;
    } else i++;
  }
  out.push(css.slice(start));
  return out.join("");
}

/** Propiedades que escriben texto en pantalla. */
const GENERATED_PROPERTY = /(?:^|[^-\w])(?:content|list-style-type|list-style|quotes)\s*:/gi;

interface CssValue {
  strings: string[];
  attrs: string[];
  vars: string[];
  end: number;
}

/** Valor de una declaración desde `start` hasta «;», «}» o «{» fuera de cadenas y paréntesis. */
function cssValue(css: string, start: number, firstStringOnly = false): CssValue {
  const strings: string[] = [];
  let i = start;
  let depth = 0;
  while (i < css.length) {
    const ch = css[i];
    if (ch === '"' || ch === "'") {
      const [text, next] = cssString(css, i);
      strings.push(text);
      i = next;
      if (firstStringOnly) break;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === "{" || (depth === 0 && (ch === ";" || ch === "}"))) break;
    i++;
  }
  const raw = css.slice(start, i);
  return {
    strings,
    attrs: [...raw.matchAll(/attr\(\s*([-\w]+)/gi)].map((m) => m[1]),
    vars: [...raw.matchAll(/var\(\s*(--[-\w]+)/gi)].map((m) => m[1]),
    end: i,
  };
}

const MAX_GENERATED_CHARS = 20_000;
const MAX_REFERENCES = 20;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Texto que una hoja de estilos escribe en pantalla (::before/::after con content, list-style-type
 * con una cadena, quotes): las cadenas, los atributos que lee con attr() y las variables con var().
 */
function cssGeneratedText(blocks: readonly string[], html: string): string[] {
  const out: string[] = [];
  const attrs = new Set<string>();
  const vars = new Set<string>();
  const cleaned = blocks.map(cleanCss);
  for (const css of cleaned) {
    GENERATED_PROPERTY.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = GENERATED_PROPERTY.exec(css))) {
      const v = cssValue(css, m.index + m[0].length);
      out.push(...v.strings);
      v.attrs.forEach((a) => attrs.add(a.toLowerCase()));
      v.vars.forEach((x) => vars.add(x));
      GENERATED_PROPERTY.lastIndex = Math.max(GENERATED_PROPERTY.lastIndex, v.end);
    }
  }
  if (vars.size > 0) {
    // Declaraciones «--nombre: "…"» en las hojas de estilo y en los atributos style (con entidades).
    const sources = [...cleaned, cleanCss(decodeEntities(html))];
    for (const name of [...vars].slice(0, MAX_REFERENCES)) {
      const re = new RegExp(`${escapeRegex(name)}\\s*:`, "g");
      for (const src of sources) {
        for (const m of src.matchAll(re)) out.push(...cssValue(src, (m.index ?? 0) + m[0].length, true).strings);
      }
    }
  }
  for (const name of [...attrs].slice(0, MAX_REFERENCES)) {
    const re = new RegExp(`[\\s"'/]${escapeRegex(name)}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\`]+))`, "gi");
    for (const m of html.matchAll(re)) out.push(m[1] ?? m[2] ?? m[3] ?? "");
  }
  const kept: string[] = [];
  let size = 0;
  for (const s of out) {
    const t = s.trim();
    if (t === "" || size + t.length > MAX_GENERATED_CHARS) continue;
    kept.push(t);
    size += t.length;
  }
  return kept;
}

// ───────────────────────── HTML → texto ─────────────────────────

/** HTML → texto plano con lo que algún cliente puede mostrar (ver el encabezado del archivo). */
export function htmlToText(html: string): string {
  const lower = asciiLower(html);
  const find = new Finder(html);
  const findLower = new Finder(lower);
  const out: string[] = [];
  /** Último carácter emitido que no es espacio (para no duplicar saltos de línea). */
  let last = "";
  const emit = (s: string) => {
    if (s === "") return;
    out.push(s);
    for (let k = s.length - 1; k >= 0; k--) {
      if (!isBlank(s.charCodeAt(k))) {
        last = s[k];
        break;
      }
    }
  };
  /** Elementos sin cierre: no volver a buscar su cierre (evita recorrer el resto una y otra vez). */
  const unclosed = new Set<string>();
  const styles: string[] = [];
  /** Dentro de un comentario condicional de Outlook («<!--[if mso]>»). */
  let conditional = 0;

  /** Cierre </name> desde `from` (inicio y fin), o null. */
  const closing = (name: string, from: number): { start: number; end: number } | null => {
    if (unclosed.has(name)) return null;
    const needle = `</${name}`;
    let at = findLower.next(needle, from);
    while (at !== -1) {
      const after = lower.charCodeAt(at + needle.length);
      if (after === 0x3e || after === 0x2f || isSpace(after)) {
        const gt = find.next(">", at + needle.length);
        if (gt === -1) break;
        return { start: at, end: gt + 1 };
      }
      at = findLower.next(needle, at + 1);
    }
    unclosed.add(name);
    return null;
  };

  /** Fin de la etiqueta que empieza en `lt`: el primer «>» fuera de un valor de atributo entre comillas. */
  const tagEnd = (lt: number): number => {
    let j = lt + 1;
    for (;;) {
      const gt = find.next(">", j);
      if (gt === -1) return -1;
      let q = gt;
      const dq = find.next('"', j);
      const sq = find.next("'", j);
      if (dq !== -1 && dq < q) q = dq;
      if (sq !== -1 && sq < q) q = sq;
      if (q === gt) return gt;
      // ¿La comilla abre un valor («=» antes, con espacios)? Si no, es parte de un nombre.
      let k = q - 1;
      while (k > lt && isSpace(html.charCodeAt(k))) k--;
      if (html[k] !== "=") {
        j = q + 1;
        continue;
      }
      const close = find.next(html[q], q + 1);
      if (close === -1) return gt; // comilla sin cerrar: el primer «>», como antes
      j = close + 1;
    }
  };

  /** Fin de un comentario «<!--» en `lt`, o -1 si no se cierra. Un condicional de Outlook se abre y se lee. */
  const commentEnd = (lt: number): number => {
    const p = lt + 4;
    if (html.charCodeAt(p) === 0x3e) return p + 1; // <!-->
    if (html.startsWith("->", p)) return p + 2; // <!--->
    if (html.charCodeAt(p) === 0x5b) {
      const opener = /^\[if\b[^\]>]{0,120}\]>/.exec(lower.slice(p, p + 130));
      if (opener) {
        conditional++;
        return p + opener[0].length;
      }
    }
    const a = find.next("-->", p);
    const b = find.next("--!>", p);
    const end = a === -1 ? (b === -1 ? -1 : b + 4) : b === -1 || a < b ? a + 3 : b + 4;
    if (end !== -1 && lower.startsWith("<![endif]", p)) conditional = Math.max(0, conditional - 1);
    return end;
  };

  let i = 0;
  while (i < html.length) {
    const lt = find.next("<", i);
    if (lt === -1) {
      emit(html.slice(i));
      break;
    }
    emit(html.slice(i, lt));
    const c1 = html.charCodeAt(lt + 1);

    if (c1 === 0x21 /* ! */) {
      if (html.startsWith("<!--", lt)) {
        const end = commentEnd(lt);
        if (end !== -1) {
          i = end;
          continue;
        }
        // Comentario sin cerrar: se trata como cualquier otra etiqueta (su texto queda).
      } else if (html.startsWith("[CDATA[", lt + 2)) {
        const end = find.next("]]>", lt + 9);
        emit(html.slice(lt + 9, end === -1 ? html.length : end));
        if (end === -1) break;
        i = end + 3;
        continue;
      } else if (lower.startsWith("[endif]", lt + 2)) {
        conditional = Math.max(0, conditional - 1);
      }
      // <!doctype>, <![endif]>, otras declaraciones: se quitan hasta el primer «>».
      const gt = find.next(">", lt + 2);
      if (gt === -1) {
        emit(html.slice(lt));
        break;
      }
      i = gt + 1;
      continue;
    }
    if (c1 === 0x3f /* ? */) {
      const gt = find.next(">", lt + 2);
      if (gt === -1) {
        emit(html.slice(lt));
        break;
      }
      i = gt + 1;
      continue;
    }
    let closingTag = false;
    let nameStart = lt + 1;
    if (c1 === 0x2f /* / */) {
      const c2 = html.charCodeAt(lt + 2);
      if (c2 === 0x3e) {
        i = lt + 3; // «</>»: nada
        continue;
      }
      if (!isAsciiAlpha(c2)) {
        // «</ x>», «</3>»: comentario raro hasta el primer «>»
        const gt = find.next(">", lt + 2);
        if (gt === -1) {
          emit(html.slice(lt));
          break;
        }
        i = gt + 1;
        continue;
      }
      closingTag = true;
      nameStart = lt + 2;
    } else if (!isAsciiAlpha(c1)) {
      // «<3», «< b», «<» al final: es texto.
      emit("<");
      i = lt + 1;
      continue;
    }

    const gt = tagEnd(lt);
    if (gt === -1) {
      emit(html.slice(lt));
      break;
    }
    i = gt + 1;
    let nameEnd = nameStart;
    while (nameEnd < gt && !isSpace(html.charCodeAt(nameEnd)) && html.charCodeAt(nameEnd) !== 0x2f) nameEnd++;
    const name = lower.slice(nameStart, nameEnd);
    const tag = html.slice(nameEnd, gt);

    if (!closingTag) {
      if (RAW_HIDDEN.has(name) || (name === "xml" && conditional > 0)) {
        const r = closing(name, i);
        if (r) {
          if (name === "style") styles.push(html.slice(i, r.start));
          i = r.end;
        }
        continue;
      }
      if (RAW_SHOWN.has(name)) {
        for (const t of attributeText(name, tag)) emit(` ${t} `);
        const r = closing(name, i);
        if (r) {
          emit(name === "textarea" ? " " : "\n");
          emit(html.slice(i, r.start));
          emit(name === "textarea" ? " " : "\n");
          i = r.end;
        }
        continue;
      }
      if (name === "plaintext") {
        emit("\n");
        emit(html.slice(i));
        break;
      }
    } else if (RAW_HIDDEN.has(name) || RAW_SHOWN.has(name)) {
      continue;
    }

    if (name === "br" || name === "hr") emit("\n");
    else if (name === "td" || name === "th") emit("\t");
    else if (BLOCK_TAGS.has(name) || (closingTag && BLOCK_CLOSE_TAGS.has(name))) emit("\n");
    else if (!closingTag && LINE_START_TAGS.has(name)) {
      if (last !== "\n") emit("\n");
    } else if (!closingTag) {
      for (const t of attributeText(name, tag)) emit(` ${t} `);
    }
  }

  const generated = cssGeneratedText(styles, html);
  if (generated.length > 0) emit(`\n${generated.join("\n")}\n`);

  // Rachas de espacios: con tabulación → una tabulación; de dos o más → un espacio.
  const collapsed = decodeEntities(out.join("").replace(/\r\n?/g, "\n")).replace(/[ \t ]+/g, (run) =>
    run.includes("\t") ? "\t" : run.length > 1 ? " " : run,
  );
  return collapsed
    .split("\n")
    .map(trimBlanks)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
