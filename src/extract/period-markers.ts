/**
 * ¿La factura dice (o deja ver) que cobra un mes ANTERIOR al de su fecha? Cuando la factura no trae
 * periodo de servicio, el motor toma el mes de la fecha de emisión; pero una factura emitida el 5 de
 * noviembre «por los servicios prestados durante el mes anterior» cobra octubre, y si octubre ya se
 * pagó se pagaría dos veces (equipo rojo, DUP-B). Este detector, sin modelo, busca esa referencia
 * para que DUP-3 y la guardia revisen también ese mes. Solo puede escalar, nunca pagar.
 *
 * Marcas (sobre el texto plegado: minúsculas, sin tildes), por línea:
 * - relativas («el mes anterior»): mes/periodo/ciclo + anterior/pasado/previo/precedente/vencido
 *   (también «mês passado»), previous/prior/preceding/last/past month (o period, billing period,
 *   billing cycle), «in arrears». period = null: el mes anterior al de la fecha.
 * - un mes con nombre (español, inglés, portugués): «octubre de 2026», «October 2026», «outubro»,
 *   «services for September». Sin año, el último mes con ese nombre antes del de emisión, si fue hace
 *   3 meses o menos (más atrás suele ser otra fecha: «vence el 5 de diciembre» en noviembre).
 *   Solo cuenta si cae ANTES del mes de emisión (la fecha de emisión y el vencimiento no cuentan).
 *   «may» (inglés) y «marco» (português sin tilde, «marco» en español) exigen año: son palabras comunes.
 * Las fechas numéricas («31/10/2026») no cuentan: 10/11 puede ser octubre o noviembre.
 */

export interface EarlierPeriodMarker {
  /** Línea donde aparece (texto original, espacios colapsados, hasta 160 caracteres). */
  text: string;
  /** Mes mencionado (YYYY-MM) o null si es una referencia relativa («el mes anterior»). */
  period: string | null;
}

const RELATIVE: readonly RegExp[] = [
  /\b(?:mes|meses|periodo|ciclo)\s+(?:de\s+(?:servicio|facturacion)\s+)?(?:inmediatamente\s+)?(?:anterior|pasado|passado|previo|precedente|vencido)\b/,
  /\b(?:previous|prior|preceding|last|past)\s+(?:calendar\s+)?(?:month|period|billing\s+(?:period|cycle|month))\b/,
  /\bin\s+arrears\b/,
];

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

/** Un mes sin año cuenta solo si cae hasta este número de meses antes del de emisión. */
const MAX_MONTHS_BACK_WITHOUT_YEAR = 3;

function fold(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function shown(line: string): string {
  const t = line.replace(/\s+/g, " ").trim();
  return t.length > 160 ? `${t.slice(0, 159)}…` : t;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Marcas de un texto (el del documento, la descripción de una línea o la nota de un lector).
 * `issueMonth` (YYYY-MM o null): el mes de emisión leído; sin él, los meses sin año no cuentan.
 */
export function detectEarlierPeriodMarkers(text: string | null | undefined, issueMonth: string | null): EarlierPeriodMarker[] {
  if (!text || !text.trim()) return [];
  const issue = issueMonth != null && /^\d{4}-(0[1-9]|1[0-2])$/.test(issueMonth) ? issueMonth : null;
  const out: EarlierPeriodMarker[] = [];
  const seen = new Set<string>();
  const push = (line: string, period: string | null) => {
    const key = `${period ?? "rel"}|${line}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ text: shown(line), period });
  };
  for (const raw of text.split(/\n+/)) {
    if (!raw.trim()) continue;
    const line = fold(raw);
    if (RELATIVE.some((re) => re.test(line))) push(raw, null);
    for (const m of line.matchAll(MONTH_NAME)) {
      const name = m[1];
      const month = MONTHS[name];
      const year = m[2] != null ? Number(m[2]) : null;
      if (year == null && NEEDS_YEAR.has(name)) continue;
      let period: string;
      if (year != null) {
        period = `${year}-${pad(month)}`;
      } else {
        // Sin año: la última vez que ese mes cayó antes del de emisión, si fue hace poco («factura de
        // diciembre» emitida en enero). Más atrás suele ser otra fecha («vence el 5 de diciembre» en
        // una factura de noviembre sería diciembre del año anterior).
        if (issue == null) continue;
        const issueYear = Number(issue.slice(0, 4));
        const issueMonthNumber = Number(issue.slice(5, 7));
        const back = (issueMonthNumber - month + 12) % 12;
        if (back === 0 || back > MAX_MONTHS_BACK_WITHOUT_YEAR) continue;
        period = `${month < issueMonthNumber ? issueYear : issueYear - 1}-${pad(month)}`;
      }
      if (issue != null && period >= issue) continue;
      push(raw, period);
    }
  }
  return out;
}
