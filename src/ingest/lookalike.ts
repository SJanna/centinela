/**
 * Texto que una persona ve distinto de como lo lee el código (sin modelo).
 *
 * - Letras de otros alfabetos que se ven como latinas: «РАGАDО» con Р, А y О cirílicas se ve
 *   «PAGADO», pero no es «pagado» para una comparación o una expresión regular. Lo mismo con griegas
 *   (Α, Ρ, Ο…) y versalitas latinas (ᴘ, ᴀ, ɢ…), que NFKD no pliega.
 * - Forzados de dirección: «ODAGAP» precedido de U+202E (o dentro de <bdo dir="rtl">, o con
 *   unicode-bidi: bidi-override) se ve «PAGADO».
 *
 * En un correo de una empresa de la región (español, inglés, portugués) ninguna de las dos cosas
 * tiene un uso legítimo dentro de una palabra latina.
 */

/** [letra parecida, letra latina que imita], por punto de código (sin caracteres raros en el fuente). */
const PAIRS: readonly [number, string][] = [
  // Cirílico, mayúsculas y minúsculas
  [0x0410, "A"], [0x0412, "B"], [0x0415, "E"], [0x041a, "K"], [0x041c, "M"], [0x041d, "H"], [0x041e, "O"],
  [0x0420, "P"], [0x0421, "C"], [0x0422, "T"], [0x0423, "Y"], [0x0425, "X"], [0x0405, "S"], [0x0406, "I"],
  [0x0408, "J"], [0x04ae, "Y"], [0x04ba, "H"], [0x04c0, "I"], [0x051a, "Q"], [0x051c, "W"],
  [0x0430, "a"], [0x0432, "b"], [0x0435, "e"], [0x043a, "k"], [0x043c, "m"], [0x043d, "h"], [0x043e, "o"],
  [0x0440, "p"], [0x0441, "c"], [0x0442, "t"], [0x0443, "y"], [0x0445, "x"], [0x0455, "s"], [0x0456, "i"],
  [0x0458, "j"], [0x04af, "y"], [0x04bb, "h"], [0x04cf, "l"], [0x0501, "d"], [0x051b, "q"], [0x051d, "w"],
  // Griego
  [0x0391, "A"], [0x0392, "B"], [0x0395, "E"], [0x0396, "Z"], [0x0397, "H"], [0x0399, "I"], [0x039a, "K"],
  [0x039c, "M"], [0x039d, "N"], [0x039f, "O"], [0x03a1, "P"], [0x03a4, "T"], [0x03a5, "Y"], [0x03a7, "X"],
  [0x03b1, "a"], [0x03b5, "e"], [0x03b9, "i"], [0x03ba, "k"], [0x03bd, "v"], [0x03bf, "o"], [0x03c1, "p"],
  [0x03c4, "t"], [0x03c5, "u"], [0x03c7, "x"], [0x03b3, "y"], [0x03c9, "w"],
  // Versalitas y variantes latinas que NFKD no pliega
  [0x1d00, "a"], [0x0299, "b"], [0x1d04, "c"], [0x1d05, "d"], [0x1d07, "e"], [0xa730, "f"], [0x0262, "g"],
  [0x029c, "h"], [0x026a, "i"], [0x1d0a, "j"], [0x1d0b, "k"], [0x029f, "l"], [0x1d0d, "m"], [0x0274, "n"],
  [0x1d0f, "o"], [0x1d18, "p"], [0x0280, "r"], [0xa731, "s"], [0x1d1b, "t"], [0x1d1c, "u"], [0x1d20, "v"],
  [0x1d21, "w"], [0x028f, "y"], [0x1d22, "z"], [0x0131, "i"], [0x0251, "a"], [0x0261, "g"],
];

const LOOKALIKES: ReadonlyMap<string, string> = new Map(PAIRS.map(([code, latin]) => [String.fromCodePoint(code), latin]));
const LOOKALIKE_RE = new RegExp(`[${[...LOOKALIKES.keys()].join("")}]`, "gu");

/** Cambia cada letra parecida por la latina que imita («РАGАDО» → «PAGADO»). */
export function latinSkeleton(s: string): string {
  return s.replace(LOOKALIKE_RE, (ch) => LOOKALIKES.get(ch) ?? ch);
}

/**
 * Palabras que mezclan letras latinas (ASCII) con letras parecidas de otro alfabeto: «РАGАDО».
 * Una palabra entera en griego o cirílico («Αθήνα», «Москва») no cuenta, ni «µ» (signo de micro).
 */
export function mixedScriptWords(text: string, limit = 3): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/[\p{L}\p{M}]+/gu)) {
    const w = m[0];
    if (!/[A-Za-z]/.test(w)) continue;
    LOOKALIKE_RE.lastIndex = 0;
    if (!LOOKALIKE_RE.test(w)) continue;
    if (!out.includes(w)) out.push(w);
    if (out.length >= limit) break;
  }
  LOOKALIKE_RE.lastIndex = 0;
  return out;
}

/** Forzados de dirección que invierten el orden de las letras al mostrarlas (LRO, RLO). */
const OVERRIDE_CHAR = /[\u202D\u202E]/;
/** En HTML: <bdo dir="rtl"> o unicode-bidi: bidi-override / isolate-override. */
const OVERRIDE_HTML = /<bdo\b[^>]*\bdir\s*=\s*["']?\s*rtl|(?:bidi|isolate)-override/i;

/**
 * Lo que se lee al revés: el texto que sigue a un forzado de dirección (hasta su cierre U+202C, un
 * salto de línea o 40 caracteres), o el de un <bdo dir="rtl">. null si no hay ninguno.
 */
export function reversedSegment(text: string, rawHtml: string | null): { shown: string; read: string } | null {
  const m = /[\u202D\u202E]([^\u202C\n]{1,40})/.exec(text);
  if (m) return { read: m[1].trim(), shown: [...m[1]].reverse().join("").trim() };
  if (rawHtml && OVERRIDE_HTML.test(rawHtml)) {
    const bdo = /<bdo\b[^>]*>([^<]{1,40})/i.exec(rawHtml);
    return bdo ? { read: bdo[1].trim(), shown: [...bdo[1]].reverse().join("").trim() } : { read: "", shown: "" };
  }
  return null;
}

export function hasDirectionOverride(text: string, rawHtml: string | null): boolean {
  return OVERRIDE_CHAR.test(text) || (rawHtml != null && OVERRIDE_HTML.test(rawHtml));
}
