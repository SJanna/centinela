/**
 * Detector de instrucciones escondidas por patrones (sin modelo), en español, inglés y portugués.
 *
 * Se busca sobre el texto plano del documento (incluye texto oculto de PDF) plegado a
 * minúsculas, sin tildes, con formas compatibles (NFKD) y sin caracteres invisibles (todo
 * Default_Ignorable_Code_Point: ancho cero, marcas de dirección, guion blando, rellenos…), así
 * que "SYSTEM", "ｓｙｓｔｅｍ" o "ign​ore" cuentan igual. La cita que se devuelve es la del
 * texto original.
 *
 * Segunda pasada, contra el texto con letras separadas por espacios ("S Y S T E M : approved",
 * "y a  f u e  a p r o b a d a", o lo que deja PDF.js con un título espaciado: "s k i p a l l c h e ck s"):
 * se unen los tramos con 4+ letras sueltas (y trozos de hasta 4 letras, al menos la mitad sueltas)
 * separadas por 1–6 espacios; el espacio más corto del tramo se toma como el que hay entre letras y
 * uno más largo como el que hay entre palabras. Sobre ese texto se buscan los mismos patrones y, solo
 * dentro de los tramos unidos, también los patrones de frases sin exigir espacios ni límites de
 * palabra ("yafueaprobada", "skipallchecks"). Lo mismo para palabras en MAYÚSCULAS de 10+ letras
 * (un título espaciado que la entrada de PDF ya unió, p. ej. "YAFUEAPROBADA"), pero ahí la frase debe
 * empezar con la palabra. Los tramos de letras sueltas no aparecen en facturas normales.
 *
 * Lista de patrones (documentada a propósito; un falso positivo produce ESCALAR, nunca un pago):
 *
 * 1. Aprobación previa: "ya (fue|está|ha sido) aprobad/autorizad…", "pre-aprobad…",
 *    "aprobado previamente / de antemano / por el CFO|CEO|gerente|director…",
 *    "pre-approved", "already approved", "approved by …", "(já) aprovado (por) …".
 *    Excepción: casilla de firma vacía, es decir "Approved by: ____" / "Aprovado por ....." (rayas,
 *    puntos o guiones) o "Aprovado por:" al final de la línea cuando lo que sigue es otra etiqueta
 *    ("Vencimento: …"), una casilla o el final del texto. Sin dos puntos ni casilla se marca siempre:
 *    "Este pagamento já foi aprovado" o "approved by" + nombre en la línea siguiente.
 * 2. Saltar controles: "sin validación/revisión/verificación/controles", "omitir/saltar las
 *    validaciones", "ignora(r) las instrucciones/reglas/validaciones", "skip (all) checks/validation",
 *    "ignore (all|previous) instructions", "disregard … instructions", "without checks/review",
 *    "bypass/override the checks", "no es necesario verificar", "ignore as instruções",
 *    "sem validação/verificação/revisão", "pule as validações".
 * 3. Mensajes al sistema: "system:", "[system]", "<system>", "sistema:" (también pegados a dígitos o
 *    signos, "1.200,00SYSTEM:", pero no dentro de una palabra, "ecosystem:"), "nota para el sistema/
 *    agente/asistente/IA", "nota para o sistema", "AI agent/assistant", "agente/asistente de IA",
 *    "assistant:", "dear/hey/note to the assistant/agent/LLM", "(the) AI/LLM processing this invoice",
 *    "agente/sistema que procesa esta…", "if you are an AI…", "si eres un modelo/agente…",
 *    "se você é uma IA…".
 *    Nota: "assistant", "LLM", "AI model" o "modelo de IA" sueltos NO se marcan (pueden ser conceptos
 *    normales de una factura, p. ej. "Executive assistant services" o "LLM monitoring"); solo
 *    cuando se le habla al lector ("Assistant:", "Dear assistant", "AI assistant").
 * 4. Urgencia de pago: "pagar/pague de inmediato", "pagar hoy mismo / cuanto antes",
 *    "pay immediately / right away / ASAP", "urgent payment", "urgente", "urgent(ly)",
 *    "pagar imediatamente". ("Pago inmediato" como condición de pago NO se marca.)
 * 5. Cambio de cuenta: "nueva cuenta" (salvo "nueva cuenta de cobro"), "cuenta nueva/actualizada/
 *    distinta", "nuevos datos bancarios", "cambiamos/cambió de banco/cuenta", "actualizamos los datos
 *    bancarios", "new bank", "new (bank) account" (salvo "new account manager/setup/fee/opening…"),
 *    "updated (our) bank",
 *    "changed banks", "change of bank details", "nova conta", "conta nova", "novos dados bancários",
 *    "atualizamos … dados bancários", "mudamos de banco".
 */

export interface SuspiciousMatch {
  /** Frase o línea del documento donde aparece (texto original, espacios colapsados). */
  text: string;
  /** Por qué es sospechosa, en español. */
  reason: string;
}

const REASON_APPROVAL = "Afirma que el pago ya está aprobado o autorizado";
const REASON_SKIP = "Pide saltarse validaciones o controles";
const REASON_SYSTEM = "Se dirige al sistema, a una IA o a un agente automático";
const REASON_URGENCY = "Presiona para pagar de inmediato";
const REASON_ACCOUNT = "Anuncia un cambio de banco o de cuenta de pago";

interface Rule {
  reason: string;
  pattern: RegExp;
  /** No marcar si lo que sigue es una casilla vacía ("Approved by: ______"). */
  skipIfBlankField?: boolean;
}

// Todos los patrones se aplican sobre texto plegado (minúsculas, sin tildes).
const RULES: Rule[] = [
  // 1. Aprobación previa
  { reason: REASON_APPROVAL, pattern: /\bya\s+(?:fue\s+|esta\s+|estaba\s+|ha\s+sido\s+|se\s+)?(?:pre-?\s?)?(?:aprobad|autorizad)[oa]s?\b/g },
  { reason: REASON_APPROVAL, pattern: /\bpre-?\s?(?:aprobad|autorizad)[oa]s?\b/g },
  {
    reason: REASON_APPROVAL,
    pattern:
      /\b(?:aprobad|autorizad)[oa]s?\s+(?:previamente|de\s+antemano|por\s+(?:el|la)\s+(?:cfo|ceo|gerente|gerencia|director|directora|jefe|jefa|contralor|contralora|tesorero|tesorera))\b/g,
  },
  { reason: REASON_APPROVAL, pattern: /\bpre-?\s?approved\b/g },
  { reason: REASON_APPROVAL, pattern: /\balready\s+(?:been\s+)?(?:approved|authori[sz]ed)\b/g },
  { reason: REASON_APPROVAL, pattern: /\bapproved\s+by\b/g, skipIfBlankField: true },
  { reason: REASON_APPROVAL, pattern: /\b(?:ja\s+)?(?:pre-?\s?)?aprovad[oa]s?(?:\s+por)?\b/g, skipIfBlankField: true },

  // 2. Saltar controles
  { reason: REASON_SKIP, pattern: /\bsin\s+(?:ninguna\s+|mas\s+)?(?:validacion(?:es)?|revision(?:es)?|verificacion(?:es)?|control(?:es)?)\b/g },
  {
    reason: REASON_SKIP,
    pattern:
      /\b(?:omitir|omita|omitan|saltar|salte|salten|saltarse|saltese)\s+(?:todas\s+las\s+|todos\s+los\s+|las\s+|los\s+)?(?:validaciones|controles|verificaciones|revisiones|reglas)\b/g,
  },
  {
    reason: REASON_SKIP,
    pattern: /\bignor(?:a|ar|e|en|ad)\s+(?:todas\s+)?(?:las\s+)?(?:instrucciones|reglas|validaciones|verificaciones|controles)\b/g,
  },
  { reason: REASON_SKIP, pattern: /\bskip\s+(?:all\s+|any\s+|the\s+)?(?:checks?|validations?|verifications?|reviews?|controls?)\b/g },
  {
    reason: REASON_SKIP,
    pattern: /\bignore\s+(?:all\s+|any\s+)?(?:previous\s+|prior\s+|above\s+|the\s+|your\s+|other\s+)?(?:instructions|rules|checks|validations?)\b/g,
  },
  {
    reason: REASON_SKIP,
    pattern: /\bdisregard\s+(?:all\s+|any\s+)?(?:previous\s+|prior\s+|above\s+|the\s+|your\s+)?(?:instructions|rules|checks)\b/g,
  },
  { reason: REASON_SKIP, pattern: /\bwithout\s+(?:any\s+)?(?:checks?|validations?|verifications?|reviews?)\b/g },
  { reason: REASON_SKIP, pattern: /\b(?:bypass|override)\s+(?:all\s+|the\s+|any\s+)?(?:checks?|validations?|controls?|approvals?|rules)\b/g },
  {
    reason: REASON_SKIP,
    pattern: /\bno\s+(?:es\s+necesario|hace\s+falta|need\s+to)\s+(?:verificar|validar|revisar|verify|validate|check|review)\b/g,
  },
  { reason: REASON_SKIP, pattern: /\bignor(?:e|ar|em)\s+(?:todas\s+)?(?:as\s+)?(?:instrucoes|regras|validacoes|verificacoes)\b/g },
  { reason: REASON_SKIP, pattern: /\bsem\s+(?:nenhuma\s+)?(?:validacao|validacoes|verificacao|verificacoes|revisao|conferencia)\b/g },
  { reason: REASON_SKIP, pattern: /\bpul(?:ar|e|em)\s+(?:as\s+)?(?:validacoes|verificacoes)\b/g },

  // 3. Mensajes al sistema. "system:", "sistema:" y "assistant:" se marcan también pegados a dígitos
  // o signos ("1.200,00SYSTEM: approved"), pero no dentro de otra palabra ("ecosystem:", "subsistema:").
  { reason: REASON_SYSTEM, pattern: /(?<![a-z])system\s*:/g },
  { reason: REASON_SYSTEM, pattern: /\[\s*system\s*\]/g },
  { reason: REASON_SYSTEM, pattern: /<\s*\/?\s*system\s*>/g },
  { reason: REASON_SYSTEM, pattern: /(?<![a-z])sistema\s*:/g },
  {
    reason: REASON_SYSTEM,
    pattern: /\bnota\s+(?:para|al|a\s+la|a\s+el)\s+(?:el\s+|la\s+)?(?:sistema|agente|asistente|ia|modelo|bot|robot)\b/g,
  },
  { reason: REASON_SYSTEM, pattern: /\bnota\s+para\s+(?:o|a)\s+(?:sistema|agente|assistente|ia|modelo|robo)\b/g },
  { reason: REASON_SYSTEM, pattern: /\bai\s+(?:agent|assistant)s?\b/g },
  { reason: REASON_SYSTEM, pattern: /\b(?:agente|asistente|assistente)\s+(?:de\s+)?(?:ia|inteligencia\s+artificial)\b/g },
  { reason: REASON_SYSTEM, pattern: /(?<![a-z])assistant\s*:/g },
  {
    reason: REASON_SYSTEM,
    pattern: /\b(?:dear|hey|hi|hello|attention|note\s+(?:to|for))\s+(?:the\s+)?(?:ai\s+)?(?:assistant|agent|model|system|bot|llm)\b/g,
  },
  {
    reason: REASON_SYSTEM,
    pattern:
      /\b(?:llm|language\s+model|ai|assistant|agent|model|system)\s+(?:reading|processing|reviewing)\s+(?:this|these)\s+(?:invoice|document|email|message)s?\b/g,
  },
  {
    reason: REASON_SYSTEM,
    pattern: /\b(?:ia|agente|asistente|modelo|sistema)\s+que\s+(?:lee|procesa|revisa)\s+(?:esta|este|estos|estas)\b/g,
  },
  { reason: REASON_SYSTEM, pattern: /\bif\s+you\s+are\s+an?\s+(?:ai|language\s+model|llm|assistant|agent|automated)\b/g },
  { reason: REASON_SYSTEM, pattern: /\bsi\s+(?:eres|es\s+usted)\s+(?:un\s+|una\s+)?(?:ia|modelo|agente|asistente|sistema)\b/g },
  { reason: REASON_SYSTEM, pattern: /\bse\s+voce\s+(?:e|for)\s+(?:um\s+|uma\s+)?(?:ia|modelo|agente|assistente|sistema)\b/g },

  // 4. Urgencia de pago
  { reason: REASON_URGENCY, pattern: /\bpag(?:ar|ue|uen|a)\s+(?:de\s+)?inmediat(?:o|amente)\b/g },
  { reason: REASON_URGENCY, pattern: /\bpag(?:ar|ue|uen)\s+(?:hoy\s+mismo|ya\s+mismo|cuanto\s+antes)\b/g },
  { reason: REASON_URGENCY, pattern: /\bpay\s+(?:this\s+(?:invoice\s+)?)?(?:immediately|right\s+away|asap|at\s+once)\b/g },
  { reason: REASON_URGENCY, pattern: /\b(?:immediate|urgent)\s+payment\b/g },
  { reason: REASON_URGENCY, pattern: /\burgente(?:mente)?\b/g },
  { reason: REASON_URGENCY, pattern: /\burgent(?:ly)?\b/g },
  { reason: REASON_URGENCY, pattern: /\bpag(?:ar|ue|uem)\s+(?:de\s+)?imediat(?:o|amente)\b/g },

  // 5. Cambio de cuenta
  { reason: REASON_ACCOUNT, pattern: /\bnueva\s+cuenta\b(?!\s+de\s+cobro)/g },
  { reason: REASON_ACCOUNT, pattern: /\bcuenta\s+(?:bancaria\s+)?(?:nueva|actualizada|diferente|distinta)\b/g },
  { reason: REASON_ACCOUNT, pattern: /\bnuevos\s+datos\s+bancarios\b/g },
  { reason: REASON_ACCOUNT, pattern: /\bdatos\s+bancarios\s+(?:nuevos|actualizados)\b/g },
  { reason: REASON_ACCOUNT, pattern: /\bcambi(?:amos|o|aron|e|en|ar)\s+(?:de\s+|nuestra\s+|la\s+)?(?:banco|cuenta)\b(?!\s+de\s+cobro)/g },
  { reason: REASON_ACCOUNT, pattern: /\bactualiz(?:amos|aron|o|ar|ado|ada)\s+(?:nuestros\s+|los\s+|sus\s+)?datos\s+bancarios\b/g },
  { reason: REASON_ACCOUNT, pattern: /\bnew\s+bank(?:ing)?\b/g },
  {
    reason: REASON_ACCOUNT,
    pattern:
      /\bnew\s+(?:bank\s+)?account\b(?!\s+(?:manager|executive|representative|rep|setup|set\s*-?\s*up|opening|onboarding|creation|activation|fee|credit|bonus|discount)s?\b)/g,
  },
  { reason: REASON_ACCOUNT, pattern: /\bupdated\s+(?:our\s+|the\s+)?bank(?:ing)?\b/g },
  { reason: REASON_ACCOUNT, pattern: /\bupdate\s+(?:our\s+|the\s+|your\s+)?bank(?:ing)?\s+(?:details|information|info|account)\b/g },
  { reason: REASON_ACCOUNT, pattern: /\b(?:changed|switched|moved)\s+(?:our\s+)?banks?\b/g },
  { reason: REASON_ACCOUNT, pattern: /\bchange\s+(?:of|in)\s+(?:our\s+)?bank(?:ing)?\s+(?:details|account|information)\b/g },
  { reason: REASON_ACCOUNT, pattern: /\bnova\s+conta\b/g },
  { reason: REASON_ACCOUNT, pattern: /\bconta\s+(?:nova|atualizada|diferente)\b/g },
  { reason: REASON_ACCOUNT, pattern: /\bnovos\s+dados\s+bancarios\b/g },
  { reason: REASON_ACCOUNT, pattern: /\batualiz(?:amos|e|ar|ou|aram|ados)\b[^\n]{0,80}?\bdados\s+bancarios\b/g },
  { reason: REASON_ACCOUNT, pattern: /\bmud(?:amos|ou|aram)\s+(?:de\s+)?(?:banco|conta)\b/g },
];

/** Lo que sigue a "approved by" cuando es una casilla para firmar: rayas, puntos o guiones. */
const BLANK_MARKERS = /^[ \t]*:?[ \t]*(?:_{2,}|\.{3,}|-{3,}|…)/;
/** "Aprovado por:" sin nada más en la línea. */
const COLON_AT_LINE_END = /^[ \t]*:[ \t]*$/;
/** Una línea que es otra etiqueta de formulario ("Vencimento: …", "Date:") o una casilla. */
const FORM_LABEL_LINE = /^[ \t]*(?:[^:\n]{1,40}:|_{2,}|\.{3,}|-{3,}|…)/;

/**
 * ¿La coincidencia que termina en `end` es la etiqueta de una casilla de firma vacía? Solo si la
 * siguen rayas/puntos, o dos puntos al final de la línea y después otra etiqueta o nada. Sin eso
 * ("Pagamento aprovado", "approved by" + nombre en la línea siguiente) es una afirmación.
 */
function isBlankSignatureField(folded: string, end: number): boolean {
  const nl = folded.indexOf("\n", end);
  const lineEnd = nl === -1 ? folded.length : nl;
  const rest = folded.slice(end, lineEnd);
  if (BLANK_MARKERS.test(rest)) return true;
  if (!COLON_AT_LINE_END.test(rest)) return false;
  const next = nl === -1 ? undefined : folded.slice(nl + 1).split("\n").find((line) => line.trim() !== "");
  return next === undefined || FORM_LABEL_LINE.test(next);
}

/**
 * Invisibles que se quitan antes de buscar: ancho cero (U+200B–U+200D, U+2060, U+FEFF), guion blando,
 * marcas y forzados de dirección, operadores invisibles, rellenos Hangul, selectores de variante,
 * caracteres etiqueta… (la propiedad Unicode Default_Ignorable_Code_Point completa).
 */
const INVISIBLE = /\p{Default_Ignorable_Code_Point}/u;
const COMBINING = /[̀-ͯ]/g;

interface Folded {
  folded: string;
  /** map[i] = índice en el texto original del carácter plegado i (con un elemento extra al final). */
  map: number[];
}

/** Minúsculas, sin tildes, NFKD y sin caracteres invisibles, con mapa de índices al original. */
export function foldText(text: string): Folded {
  let folded = "";
  const map: number[] = [];
  let i = 0;
  while (i < text.length) {
    const cp = text.codePointAt(i) ?? 0;
    const ch = String.fromCodePoint(cp);
    if (!INVISIBLE.test(ch)) {
      const piece = ch.normalize("NFKD").replace(COMBINING, "").toLowerCase();
      for (let k = 0; k < piece.length; k++) map.push(i);
      folded += piece;
    }
    i += ch.length;
  }
  map.push(text.length);
  return { folded, map };
}

const MAX_SNIPPET = 240;
const WINDOW = 120;

function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function isSentenceEnd(text: string, i: number): boolean {
  return /[.!?;]/.test(text[i] ?? "") && (i + 1 >= text.length || /\s/.test(text[i + 1]));
}

/** La línea donde está la coincidencia; si es muy larga, la frase alrededor (máx. ~240 caracteres). */
function snippetAround(text: string, start: number, end: number): string {
  const lineStart = start === 0 ? 0 : text.lastIndexOf("\n", start - 1) + 1;
  const nl = text.indexOf("\n", end);
  const lineEnd = nl === -1 ? text.length : nl;
  const line = collapse(text.slice(lineStart, lineEnd));
  if (line.length <= MAX_SNIPPET) return line;

  let s = start;
  const minS = Math.max(lineStart, start - WINDOW);
  while (s > minS && !isSentenceEnd(text, s - 1)) s--;
  let e = end;
  const maxE = Math.min(lineEnd, end + WINDOW);
  while (e < maxE && !isSentenceEnd(text, e)) e++;
  if (e < lineEnd && isSentenceEnd(text, e)) e++;
  const prefix = s > lineStart ? "…" : "";
  const suffix = e < lineEnd ? "…" : "";
  return `${prefix}${collapse(text.slice(s, e))}${suffix}`;
}

/**
 * Busca frases que intentan dar órdenes a quien procesa la factura. Devuelve una entrada por
 * frase (si una frase activa varias reglas, las razones se unen con "; ").
 */
export function detectSuspiciousInstructions(text: string): SuspiciousMatch[] {
  if (!text) return [];
  const { folded, map } = foldText(text);
  const bySnippet = new Map<string, { position: number; reasons: Set<string> }>();

  /** Registra una coincidencia [fStart, fEnd) del texto plegado. */
  const add = (rule: Rule, fStart: number, fEnd: number) => {
    if (rule.skipIfBlankField && isBlankSignatureField(folded, fEnd)) return;
    const start = map[fStart];
    const end = Math.max(map[Math.min(fEnd, map.length - 1)], start + 1);
    const snippet = snippetAround(text, start, end);
    if (!snippet) return;
    const entry = bySnippet.get(snippet);
    if (entry) {
      entry.reasons.add(rule.reason);
      entry.position = Math.min(entry.position, start);
    } else {
      bySnippet.set(snippet, { position: start, reasons: new Set([rule.reason]) });
    }
  };

  for (const rule of RULES) {
    for (const m of folded.matchAll(rule.pattern)) add(rule, m.index, m.index + m[0].length);
  }

  // Segunda pasada: letras sueltas unidas (y palabras largas en mayúsculas sin espacios).
  const re = rejoinSpacedLetters(folded, text, map);
  if (re) {
    const toFolded = (i: number) => re.map[Math.min(i, re.map.length - 1)];
    if (re.regions.some((r) => r.joined)) {
      for (const rule of RULES) {
        for (const m of re.text.matchAll(rule.pattern)) add(rule, toFolded(m.index), toFolded(m.index + m[0].length));
      }
    }
    for (const rule of RELAXED_RULES) {
      for (const m of re.text.matchAll(rule.pattern)) {
        const s = m.index;
        const e = s + m[0].length;
        const region = regionAt(re.regions, s, e);
        // En un tramo unido basta tocarlo; en una palabra larga la frase debe empezar con ella.
        if (!region || (!region.joined && region.start !== s)) continue;
        add(rule, toFolded(s), toFolded(e));
      }
    }
  }

  return [...bySnippet.entries()]
    .sort((a, b) => a[1].position - b[1].position)
    .map(([snippet, { reasons }]) => ({ text: snippet, reason: [...reasons].join("; ") }));
}

// ───────────────────────── Letras sueltas ─────────────────────────

/**
 * Los patrones de frases (con espacios obligatorios) sin exigir espacios ni límites de palabra, para
 * texto que perdió los espacios entre palabras ("yafueaprobada"). Se dejan fuera los de casillas de
 * firma, que con una sola palabra («aprovado») ya coinciden.
 */
const RELAXED_RULES: Rule[] = RULES.filter((r) => r.pattern.source.includes("\\s+") && !r.skipIfBlankField).map((r) => ({
  ...r,
  pattern: new RegExp(r.pattern.source.replace(/\\s\+/g, "\\s*").replace(/\\b/g, ""), r.pattern.flags),
}));

/** Mínimo de letras sueltas de un tramo para unirlo. */
const MIN_SPACED_LETTERS = 4;
/** Letras de un trozo que puede ir dentro de un tramo (las que PDF.js dejó juntas por el kerning). */
const MAX_CLUSTER_LETTERS = 4;
/** Espacios horizontales entre dos letras o palabras de un tramo (más es otra columna). */
const MAX_SPACES = 6;
/** Letras de una palabra en mayúsculas que se revisa sin espacios. */
const MIN_LONG_WORD = 10;

const LETTER_RUN = /\p{L}+/gu;
const HORIZONTAL_SPACES = /^[^\S\n]+$/;

interface Region {
  /** [start, end) en el texto de la segunda pasada. */
  start: number;
  end: number;
  /** true si son letras sueltas unidas; false si es una palabra larga en mayúsculas. */
  joined: boolean;
}

interface Rejoined {
  /** Texto plegado con los tramos de letras sueltas unidos. */
  text: string;
  /** map[i] = índice en el texto plegado del carácter i de `text` (con uno extra al final). */
  map: number[];
  /** Tramos unidos y palabras largas en mayúsculas, en orden y sin solaparse. */
  regions: Region[];
}

function isUppercase(s: string): boolean {
  return s === s.toUpperCase() && s !== s.toLowerCase();
}

/** La región que se solapa con [s, e), o null. Búsqueda binaria: las regiones están en orden y no se solapan. */
function regionAt(regions: readonly Region[], s: number, e: number): Region | null {
  let lo = 0;
  let hi = regions.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (regions[mid].start < e) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found >= 0 && regions[found].end > s ? regions[found] : null;
}

/**
 * Une los tramos de letras sueltas del texto plegado y marca las palabras largas en mayúsculas (según
 * el texto original). Devuelve null si no hay ninguno. Tiempo lineal: cada palabra se mira una vez.
 */
function rejoinSpacedLetters(folded: string, original: string, foldMap: readonly number[]): Rejoined | null {
  const words: { start: number; end: number; letters: number }[] = [];
  for (const m of folded.matchAll(LETTER_RUN)) {
    words.push({ start: m.index, end: m.index + m[0].length, letters: [...m[0]].length });
  }
  const parts: string[] = [];
  const map: number[] = [];
  const regions: Region[] = [];
  let outLength = 0;
  let copied = 0;
  const copyTo = (end: number) => {
    if (end <= copied) return;
    parts.push(folded.slice(copied, end));
    for (let i = copied; i < end; i++) map.push(i);
    outLength += end - copied;
    copied = end;
  };
  const spacesBefore = (k: number) => folded.slice(words[k - 1].end, words[k].start);
  const continuesRun = (k: number) => {
    const gap = spacesBefore(k);
    return words[k].letters <= MAX_CLUSTER_LETTERS && gap.length <= MAX_SPACES && HORIZONTAL_SPACES.test(gap);
  };

  let i = 0;
  while (i < words.length) {
    let j = i + 1;
    if (words[i].letters <= MAX_CLUSTER_LETTERS) while (j < words.length && continuesRun(j)) j++;
    let singles = 0;
    for (let k = i; k < j; k++) if (words[k].letters === 1) singles++;
    if (singles >= MIN_SPACED_LETTERS && singles * 2 >= j - i) {
      // El espacio más corto del tramo separa letras; uno más largo, palabras.
      let minGap = Infinity;
      for (let k = i + 1; k < j; k++) minGap = Math.min(minGap, words[k].start - words[k - 1].end);
      copyTo(words[i].start);
      const start = outLength;
      for (let k = i; k < j; k++) {
        if (k > i && words[k].start - words[k - 1].end > minGap) {
          parts.push(" ");
          map.push(words[k - 1].end);
          outLength += 1;
        }
        copied = words[k].start;
        copyTo(words[k].end);
      }
      regions.push({ start, end: outLength, joined: true });
    } else {
      for (let k = i; k < j; k++) {
        const w = words[k];
        if (w.letters < MIN_LONG_WORD || !isUppercase(original.slice(foldMap[w.start], foldMap[w.end]))) continue;
        // Fuera de un tramo se copia tal cual: su posición es la del texto plegado menos lo que ya se quitó.
        const shift = copied - outLength;
        regions.push({ start: w.start - shift, end: w.end - shift, joined: false });
      }
    }
    i = j;
  }
  if (regions.length === 0) return null;
  copyTo(folded.length);
  map.push(folded.length);
  return { text: parts.join(""), map, regions };
}
