/**
 * Detector de instrucciones escondidas por patrones (sin modelo), en español, inglés y portugués.
 *
 * Se busca sobre el texto plano del documento (incluye texto oculto de PDF) plegado a
 * minúsculas, sin tildes, con formas compatibles (NFKD) y sin caracteres de ancho cero, así
 * que "SYSTEM", "ｓｙｓｔｅｍ" o "ign​ore" cuentan igual. La cita que se devuelve es la del
 * texto original.
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

const ZERO_WIDTH = /[​-‍⁠﻿­]/;
const COMBINING = /[̀-ͯ]/g;

interface Folded {
  folded: string;
  /** map[i] = índice en el texto original del carácter plegado i (con un elemento extra al final). */
  map: number[];
}

/** Minúsculas, sin tildes, NFKD y sin caracteres de ancho cero, con mapa de índices al original. */
export function foldText(text: string): Folded {
  let folded = "";
  const map: number[] = [];
  let i = 0;
  while (i < text.length) {
    const cp = text.codePointAt(i) ?? 0;
    const ch = String.fromCodePoint(cp);
    if (!ZERO_WIDTH.test(ch)) {
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

  for (const rule of RULES) {
    for (const m of folded.matchAll(rule.pattern)) {
      const fStart = m.index ?? 0;
      const fEnd = fStart + m[0].length;
      if (rule.skipIfBlankField && isBlankSignatureField(folded, fEnd)) continue;
      const start = map[fStart];
      const end = Math.max(map[Math.min(fEnd, map.length - 1)], start + 1);
      const snippet = snippetAround(text, start, end);
      if (!snippet) continue;
      const entry = bySnippet.get(snippet);
      if (entry) {
        entry.reasons.add(rule.reason);
        entry.position = Math.min(entry.position, start);
      } else {
        bySnippet.set(snippet, { position: start, reasons: new Set([rule.reason]) });
      }
    }
  }

  return [...bySnippet.entries()]
    .sort((a, b) => a[1].position - b[1].position)
    .map(([snippet, { reasons }]) => ({ text: snippet, reason: [...reasons].join("; ") }));
}
