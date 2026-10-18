/**
 * ¿La factura dice (o deja ver) que cobra un mes ANTERIOR al de su fecha? Cuando la factura no trae
 * periodo de servicio, el motor toma el mes de la fecha de emisión; pero una factura emitida el 5 de
 * noviembre «por los servicios prestados durante el mes anterior» cobra octubre: si se pagara como
 * noviembre, octubre se pagaría dos veces (equipo rojo, DUP-B) o, si octubre aún no estaba pagado, una
 * factura posterior «de octubre» volvería a cobrarlo. Este detector, sin modelo, busca esa referencia
 * para que el motor impute el pago a ese mes (o escale si no es claro) y la guardia lo revise.
 *
 * Marcas (sobre el texto plegado: minúsculas, sin tildes), por línea:
 * - relativas («el mes anterior»): mes/periodo/ciclo + hasta dos palabras («inmediato», «calendario»,
 *   «de servicio») + anterior/pasado/previo/precedente/vencido; «el pasado mes», «el último mes», «el
 *   mes que acaba de terminar», «mes recién terminado»; previous/prior/preceding/last/past (+ una
 *   palabra) month/period/billing cycle; «month prior to / before / preceding», «month just ended»,
 *   «in arrears»; «mês anterior/passado». period = null: el mes anterior al de la fecha.
 * - un mes con nombre (español, inglés, portugués) en contexto de cobro: «Servicios de octubre de
 *   2026», «Honorarios agosto 2026», «October 2026 services», «Competência: Setembro/2026». En el texto
 *   del documento y en las notas de las lecturas hace falta una palabra de cobro cerca (servicios,
 *   honorarios, periodo, factura, services, fees, for…); en la descripción de una línea no (la línea
 *   ya es lo que se cobra). No cuenta si lo más cercano antes del mes es una fecha de otra cosa
 *   (contrato firmado, resolución que autoriza, tarifa vigente, válida hasta, vencimiento, fecha de
 *   emisión, «updated»). Solo cuenta si cae ANTES del mes de emisión. Sin año, el último mes con ese
 *   nombre antes del de emisión, si fue hace 3 meses o menos; sin año y sin mes de emisión, se
 *   devuelve el número del mes (`month`) para que el motor y la guardia lo ubiquen contra su fecha de
 *   referencia (la de hoy). «may» (inglés) y «marco» (português sin tilde, «marco» en español) exigen
 *   año: son palabras comunes.
 * Las fechas numéricas («31/10/2026») no cuentan: 10/11 puede ser octubre o noviembre.
 * En las notas de las lecturas (texto del modelo) no cuenta una referencia negada («no menciona el
 * mes anterior»).
 */

export interface EarlierPeriodMarker {
  /** El fragmento del texto alrededor de la referencia (texto original, hasta ~100 caracteres). */
  text: string;
  /** Mes mencionado (YYYY-MM), o null si es una referencia relativa o un mes sin año que no se pudo ubicar. */
  period: string | null;
  /**
   * Solo con period null: número del mes (1-12) de un mes con nombre y sin año cuando no hay mes de
   * emisión con que ubicarlo. Sin él, period null es «el mes anterior».
   */
  month?: number;
}

/** Dónde se busca: el texto del documento, la descripción de una línea o la nota de una lectura. */
export type EarlierPeriodSource = "document" | "line_item" | "reader_note";

const RELATIVE: readonly RegExp[] = [
  // «mes anterior», «mes inmediato anterior», «mes calendario anterior», «periodo de facturación previo», «mes vencido»
  /\b(?:mes|meses|periodo|ciclo)(?:\s+[a-z]+){0,2}?\s+(?:anterior|pasado|passado|previo|precedente|vencido)\b/,
  // «el pasado mes», «el último mes», «último periodo»
  /\b(?:pasado|ultimo)\s+(?:mes|periodo|ciclo)\b/,
  // «mes que acaba de terminar», «mes que terminó», «mes recién terminado»
  /\bmes\s+que\s+(?:acaba\s+de\s+|acabo\s+de\s+)?(?:terminar|termino|finalizar|finalizo|concluir|concluyo|cerrar|cerro|paso)\b/,
  /\b(?:mes|periodo)\s+(?:recien\s+)?(?:terminado|finalizado|concluido|cerrado|transcurrido)\b/,
  // «previous month», «prior calendar month», «last full month», «previous billing cycle»
  /\b(?:previous|prior|preceding|last|past)(?:\s+[a-z]+)?\s+(?:month|period|cycle|billing\s+(?:period|cycle|month))s?\b/,
  // «month prior to», «month before the invoice date», «month preceding», «month (that) just ended»
  /\b(?:month|period)\s+(?:prior|before|preceding)\b/,
  /\bmonth\s+(?:that\s+)?(?:just\s+)?(?:ended|finished|closed)\b/,
  /\bin\s+arrears\b/,
];

/** Negación justo antes de la referencia, en una nota del modelo («no menciona el mes anterior»). */
const NEGATION_BEFORE = /\b(?:no|sin|ni|not|without|nor)\b[^.;:]{0,25}$/;

const MONTHS: Readonly<Record<string, number>> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8,
  septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8,
  september: 9, october: 10, november: 11, december: 12,
  janeiro: 1, fevereiro: 2, marco: 3, maio: 5, junho: 6, julho: 7,
  setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};
/** Nombres que también son palabras comunes: solo cuentan con año. */
const NEEDS_YEAR = new Set(["may", "marco"]);

/** Nombre del mes y, si lo trae, el año: «octubre de 2026», «October 2026», «November 6, 2026», «Setembro/2026». */
const MONTH_NAME = new RegExp(
  `\\b(${Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|")})\\b` +
    `(?:\\s*(?:\\d{1,2}(?:st|nd|rd|th)?\\s*,?)?\\s*(?:de|del|of|,|/|-|\\.)?\\s*((?:19|20)\\d{2})\\b)?`,
  "g",
);

/** Palabras de cobro: el mes nombrado cerca de una de ellas es el que se cobra. */
const BILLING_CONTEXT =
  /\b(?:servicios?|honorarios|correspond\w*|periodo|mensualidad|cuota|canon|facturacion|facturad[oa]s?|factura|cobro|cobra|prestad[oa]s?|competencia|referente|consumo|suscripcion|services?|fees?|for|billing|billed|invoice|period|retainer|subscription|servicos?|mes|month)\b/g;

/** Fechas de otra cosa: si lo más cercano antes del mes es una de estas, ese mes no es el cobrado. */
const OTHER_DATE =
  /\b(?:contrato|contract|firmad[oa]|firma|signed|resolucion|resolution|autoriz\w*|authoriz\w*|vigente|vigencia|valid[oa]|valid|vence|vencimiento|venc|due|expira\w*|expires?|updated|actualizad[oa]|emitid[oa]|emision|issued?|fecha|date|corte|cutoff|nacimiento|registrad[oa]|aprobad[oa]|approved)\b/g;

/** Un mes sin año cuenta solo si cae hasta este número de meses antes del de emisión. */
const MAX_MONTHS_BACK_WITHOUT_YEAR = 3;

/** Caracteres de contexto que se miran antes del mes (palabras de cobro y fechas de otra cosa) y después. */
const LOOK_BEFORE = 50;
const LOOK_AFTER = 30;

/** Caracteres que se muestran a cada lado de la referencia. */
const EXCERPT_SIDE = 45;

/**
 * Texto plegado (minúsculas, sin tildes) y, para cada carácter plegado, su posición en el original:
 * así el fragmento que se muestra es el texto tal como está escrito.
 */
function foldWithMap(raw: string): { folded: string; at: number[] } {
  let folded = "";
  const at: number[] = [];
  let i = 0;
  for (const ch of raw) {
    const f = ch.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    for (let k = 0; k < f.length; k++) at.push(i);
    folded += f;
    i += ch.length;
  }
  at.push(raw.length);
  return { folded, at };
}

/** El fragmento del original alrededor de [start, end) del plegado, cortado en palabras completas. */
function excerpt(raw: string, at: number[], start: number, end: number): string {
  const from = at[Math.max(0, start - EXCERPT_SIDE)] ?? 0;
  const to = at[Math.min(at.length - 1, end + EXCERPT_SIDE)] ?? raw.length;
  let text = raw.slice(from, to);
  const cutStart = from > 0;
  const cutEnd = to < raw.length;
  if (cutStart) text = text.replace(/^\S*\s+/, "");
  if (cutEnd) text = text.replace(/\s+\S*$/, "");
  text = text.replace(/\s+/g, " ").trim();
  return `${cutStart ? "…" : ""}${text}${cutEnd ? "…" : ""}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Última posición de una coincidencia de `re` (global) en `text`, o -1. */
function lastIndexOf(re: RegExp, text: string): number {
  let last = -1;
  for (const m of text.matchAll(re)) last = m.index ?? last;
  return last;
}

/**
 * Marcas de un texto (el del documento, la descripción de una línea o la nota de un lector).
 * `issueMonth` (YYYY-MM o null): el mes de emisión leído. `source` cambia cuánto contexto se pide:
 * en una línea no hace falta una palabra de cobro; en una nota no cuenta una referencia negada.
 */
export function detectEarlierPeriodMarkers(
  text: string | null | undefined,
  issueMonth: string | null,
  source: EarlierPeriodSource = "document",
): EarlierPeriodMarker[] {
  if (!text || !text.trim()) return [];
  const issue = issueMonth != null && /^\d{4}-(0[1-9]|1[0-2])$/.test(issueMonth) ? issueMonth : null;
  const out: EarlierPeriodMarker[] = [];
  const seen = new Set<string>();
  const push = (marker: EarlierPeriodMarker) => {
    const key = `${marker.period ?? `m${marker.month ?? "rel"}`}|${marker.text}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(marker);
  };
  for (const raw of text.split(/\n+/)) {
    if (!raw.trim()) continue;
    const { folded: line, at } = foldWithMap(raw);
    for (const re of RELATIVE) {
      const m = re.exec(line);
      if (m == null) continue;
      if (source === "reader_note" && NEGATION_BEFORE.test(line.slice(0, m.index))) continue;
      push({ text: excerpt(raw, at, m.index, m.index + m[0].length), period: null });
      break;
    }
    for (const m of line.matchAll(MONTH_NAME)) {
      const name = m[1];
      const month = MONTHS[name];
      const year = m[2] != null ? Number(m[2]) : null;
      if (year == null && NEEDS_YEAR.has(name)) continue;
      const index = m.index ?? 0;
      const before = line.slice(Math.max(0, index - LOOK_BEFORE), index);
      const after = line.slice(index + m[0].length, index + m[0].length + LOOK_AFTER);
      // Lo más cercano antes del mes manda: «Servicios de octubre» sí; «contrato de servicios firmado
      // el 15 de enero» no.
      const otherDate = lastIndexOf(OTHER_DATE, before);
      const billing = lastIndexOf(BILLING_CONTEXT, before);
      if (otherDate > billing) continue;
      if (source !== "line_item" && billing < 0 && lastIndexOf(BILLING_CONTEXT, after) < 0) continue;
      if (source === "reader_note" && NEGATION_BEFORE.test(line.slice(0, index))) continue;
      const shown = excerpt(raw, at, index, index + m[0].length);
      if (year != null) {
        const period = `${year}-${pad(month)}`;
        if (issue != null && period >= issue) continue;
        push({ text: shown, period });
        continue;
      }
      if (issue == null) {
        // Sin año y sin mes de emisión: el motor y la guardia lo ubican contra su fecha de referencia.
        push({ text: shown, period: null, month });
        continue;
      }
      // Sin año: la última vez que ese mes cayó antes del de emisión, si fue hace poco («factura de
      // diciembre» emitida en enero). Más atrás suele ser otra fecha («vence el 5 de diciembre» en
      // una factura de noviembre sería diciembre del año anterior).
      const issueYear = Number(issue.slice(0, 4));
      const issueMonthNumber = Number(issue.slice(5, 7));
      const back = (issueMonthNumber - month + 12) % 12;
      if (back === 0 || back > MAX_MONTHS_BACK_WITHOUT_YEAR) continue;
      push({ text: shown, period: `${month < issueMonthNumber ? issueYear : issueYear - 1}-${pad(month)}` });
    }
  }
  return out;
}
