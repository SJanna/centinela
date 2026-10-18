/**
 * Reporte del banco de pruebas para el set de estrés: métricas agregadas por trampa, formato,
 * presentación, idioma y dificultad, con intervalos de confianza exactos (Clopper-Pearson, 95 %),
 * matriz de confusión y, en lectura real, tokens y costo.
 */
import { clopperPearson, type Interval } from "./stats";
import {
  digestLines,
  formatPct,
  groupMetrics,
  PRICES_PER_MILLION,
  readersLine,
  usageByReaderTable,
  usageCostUsd,
  type CaseResult,
  type EvalReport,
  type Metrics,
} from "./lib";

export interface RateWithInterval extends Interval {
  k: number;
  n: number;
}

export interface GroupSummary {
  metrics: Metrics;
  accuracy: RateWithInterval;
  improperPayments: RateWithInterval;
  overEscalations: RateWithInterval;
  overFreezes: RateWithInterval;
  autonomy: RateWithInterval;
  /** Costo estimado del grupo (solo con lectura real). */
  costUsd: number | null;
  tokens: { input: number; output: number } | null;
}

export interface StressSummary {
  total: GroupSummary;
  byTrap: Record<string, GroupSummary>;
  byFormat: Record<string, GroupSummary>;
  byPresentation: Record<string, GroupSummary>;
  byLanguage: Record<string, GroupSummary>;
  byDifficulty: Record<string, GroupSummary>;
  byExpected: Record<string, GroupSummary>;
  byScenarioKind: Record<string, GroupSummary>;
  /** confusion[esperado][obtenido] = casos. */
  confusion: Record<string, Record<string, number>>;
  /** Fallos agrupados por tipo: esperado → obtenido y códigos que faltaron. */
  failureKinds: Array<{ key: string; count: number; examples: string[] }>;
}

function rate(k: number, n: number): RateWithInterval {
  return { ...clopperPearson(k, n), k, n };
}

function caseCost(r: CaseResult): { usd: number; input: number; output: number } {
  let usd = 0;
  let input = 0;
  let output = 0;
  for (const u of r.usage) {
    usd += usageCostUsd(u.model, u.inputTokens, u.outputTokens);
    input += u.inputTokens;
    output += u.outputTokens;
  }
  return { usd, input, output };
}

function summarize(m: Metrics, cases: readonly CaseResult[], live: boolean): GroupSummary {
  let cost: number | null = null;
  let tokens: GroupSummary["tokens"] = null;
  if (live) {
    cost = 0;
    tokens = { input: 0, output: 0 };
    for (const c of cases) {
      const x = caseCost(c);
      cost += x.usd;
      tokens.input += x.input;
      tokens.output += x.output;
    }
  }
  return {
    metrics: m,
    accuracy: rate(m.correct, m.total),
    improperPayments: rate(m.improperPayments, m.shouldNotPay),
    overEscalations: rate(m.overEscalations, m.autonomy.eligible),
    overFreezes: rate(m.overFreezes, m.notFreeze),
    autonomy: rate(m.autonomy.resolved, m.autonomy.eligible),
    costUsd: cost,
    tokens,
  };
}

function grouped(cases: readonly CaseResult[], key: (r: CaseResult) => string | string[], live: boolean): Record<string, GroupSummary> {
  const metrics = groupMetrics(cases, key);
  const members = new Map<string, CaseResult[]>();
  for (const c of cases) for (const k of [key(c)].flat()) members.set(k, [...(members.get(k) ?? []), c]);
  const entries = Object.entries(metrics).map(([k, m]) => [k, summarize(m, members.get(k) ?? [], live)] as const);
  entries.sort((a, b) => b[1].metrics.total - a[1].metrics.total || a[0].localeCompare(b[0]));
  return Object.fromEntries(entries);
}

const scenarioKind = (id: string) => id.replace(/^e\d+-/, "");

export function buildStressSummary(report: EvalReport): StressSummary {
  const cases = report.cases;
  const live = report.usage != null;
  const ex = (r: CaseResult) => r.extras ?? { trampa: "ninguna", dificultad: "—", idioma: "—", plantilla: "—" };
  const confusion: Record<string, Record<string, number>> = {};
  for (const c of cases) {
    const got = c.outcome ?? "ERROR";
    confusion[c.expected] ??= {};
    confusion[c.expected][got] = (confusion[c.expected][got] ?? 0) + 1;
  }
  const failures = new Map<string, string[]>();
  for (const c of cases.filter((x) => !x.correct)) {
    const missing = c.missingCodes.length ? ` · faltan ${c.missingCodes.join(", ")}` : "";
    const key = `${ex(c).trampa.split("+")[0]}: esperado ${c.expected}, obtenido ${c.outcome ?? "ERROR"}${missing}`;
    failures.set(key, [...(failures.get(key) ?? []), c.caseId]);
  }
  return {
    total: summarize(report.metrics.total, cases, live),
    byTrap: grouped(cases, (r) => ex(r).trampa.split("+"), live),
    byFormat: grouped(cases, (r) => r.formato, live),
    byPresentation: grouped(cases, (r) => ex(r).plantilla, live),
    byLanguage: grouped(cases, (r) => ex(r).idioma, live),
    byDifficulty: grouped(cases, (r) => ex(r).dificultad, live),
    byExpected: grouped(cases, (r) => r.expected, live),
    byScenarioKind: grouped(cases, (r) => scenarioKind(r.escenario), live),
    confusion,
    failureKinds: [...failures].map(([key, ids]) => ({ key, count: ids.length, examples: ids.slice(0, 8) })).sort((a, b) => b.count - a.count),
  };
}

// ───────────────────────── Markdown ─────────────────────────

function pct1(x: number): string {
  return `${(x * 100).toFixed(1).replace(".", ",")}`;
}

/** «12/400 · 3,0 % [1,6–5,2]» (intervalo de Clopper-Pearson al 95 %). */
function withCi(r: RateWithInterval): string {
  if (r.n === 0) return "—";
  return `${r.k}/${r.n} · ${pct1(r.rate)} % [${pct1(r.low)}–${pct1(r.high)}]`;
}

function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

const TRAP_LABELS: Record<string, string> = {
  ninguna: "Legítima (debe pagarse)",
  duplicado_exacto: "Mismo archivo otra vez",
  duplicado_foto: "Foto de una factura ya pagada",
  duplicado_numero: "Mismo número en otro formato",
  duplicado_periodo: "Mismo periodo con otro número",
  duplicado_pago_unico: "Pago único cobrado dos veces",
  proveedor_no_registrado: "Proveedor no registrado",
  proveedor_parecido: "Nombre parecido a uno registrado",
  cuenta_un_digito: "Cuenta con un dígito cambiado",
  cuenta_distinta: "Otra cuenta",
  cuenta_otro_banco: "Mismo número en otro banco",
  cambio_de_banco: "«Cambiamos de banco»",
  monto_fuera_tolerancia: "Monto fuera de tolerancia",
  tarifa_distinta: "Tarifa distinta",
  horas_sobre_maximo: "Horas sobre el máximo",
  impuesto_encima: "Impuesto encima de lo pactado",
  otra_moneda: "Otra moneda",
  acuerdo_vencido: "Acuerdo vencido",
  acuerdo_no_vigente_aun: "Acuerdo aún no vigente",
  periodo_fuera_vigencia: "Periodo fuera de la vigencia",
  fecha_futura: "Fecha de emisión futura",
  periodo_futuro: "Periodo futuro",
  otra_empresa: "Dirigida a otra empresa",
  sobre_umbral: "Sobre el umbral",
  limite_mes: "Límite del mes superado",
  fondo_insuficiente: "Fondo insuficiente",
  aritmetica: "Cuentas que no cuadran",
  sin_datos_bancarios: "Sin datos bancarios",
  total_borroso: "Total ilegible en foto",
  recibo: "Recibo (no es factura)",
  instruccion_escondida: "Instrucciones escondidas",
};

function groupTable(title: string, groups: Record<string, GroupSummary>, live: boolean, labels: Record<string, string> = {}): string[] {
  const head = ["| Grupo | Casos | Aciertos | Pagos indebidos | Escaladas de más | Frenos de más | Autonomía |"];
  const sep = ["|---|---:|---:|---:|---:|---:|---:|"];
  if (live) {
    head[0] += " Costo (USD) |";
    sep[0] += "---:|";
  }
  const lines = [`## ${title}`, "", ...head, ...sep];
  for (const [k, g] of Object.entries(groups)) {
    const name = labels[k] ? `${labels[k]} (\`${k}\`)` : k;
    let line = `| ${cell(name)} | ${g.metrics.total} | ${withCi(g.accuracy)} | ${withCi(g.improperPayments)} | ${withCi(g.overEscalations)} | ${withCi(g.overFreezes)} | ${withCi(g.autonomy)} |`;
    if (live) line += ` ${g.costUsd != null ? g.costUsd.toFixed(4) : "—"} |`;
    lines.push(line);
  }
  lines.push("");
  return lines;
}

const READER_TEXT: Record<EvalReport["reader"], string> = {
  simulated: "simulado (lectura «perfecta» del manifiesto: prueba la lógica de decisión, no la lectura)",
  cache: "caché (lecturas guardadas; sin llamadas a la API)",
  live: "en vivo (API de Anthropic, con caché)",
};

export function renderStressMarkdown(report: EvalReport, s: StressSummary = buildStressSummary(report)): string {
  const live = report.usage != null;
  const t = s.total;
  const lines: string[] = [];
  lines.push("# Banco de pruebas · set de estrés", "");
  lines.push(`- Fecha: ${report.generatedAt}`);
  lines.push(`- Lector: ${READER_TEXT[report.reader]}`);
  lines.push(`- Modelos: ${report.models.join(", ")} · versión del prompt: ${report.promptVersion}`);
  const profileLine = readersLine(report);
  if (profileLine) lines.push(`- Perfil de lectura: ${profileLine}`);
  lines.push(`- Casos: ${report.cases.length}${report.sample ? ` (muestra estratificada por trampa y formato, semilla ${report.sample.seed})` : ""} · split: ${report.split} · escenarios en paralelo: ${report.concurrency}`);
  if (report.contextCases.length > 0) lines.push(`- Procesados solo como historial (no cuentan): ${report.contextCases.length}${report.sample && report.reader !== "simulated" ? " (con lectura simulada)" : ""}`);
  if (report.reader === "cache") lines.push(`- Lecturas que no estaban en la caché: ${report.cacheMisses}`);
  for (const w of report.warnings) lines.push(`- **Aviso:** ${w}`);
  lines.push("- Intervalos: Clopper-Pearson al 95 % entre corchetes. La etiqueta de cada factura sale de su receta (dataset/stress/plan.ts), no del motor.");
  lines.push("");

  lines.push("## Resumen", "", "| Métrica | Valor |", "|---|---:|");
  lines.push(`| Aciertos | ${withCi(t.accuracy)} |`);
  lines.push(`| Pagos indebidos (sobre las que no se debían pagar) | ${withCi(t.improperPayments)} |`);
  lines.push(`| Escaladas de más (sobre PAGAR/FRENAR esperados) | ${withCi(t.overEscalations)} |`);
  lines.push(`| Frenos de más (sobre las que no debían frenarse) | ${withCi(t.overFreezes)} |`);
  lines.push(`| Autonomía (PAGAR/FRENAR resueltos sin escalar) | ${withCi(t.autonomy)} |`);
  if (report.usage) {
    const n = report.cases.length || 1;
    lines.push(`| Tokens (entrada / salida) | ${report.usage.total.inputTokens} / ${report.usage.total.outputTokens} |`);
    lines.push(`| Costo estimado | USD ${report.usage.total.costUsd.toFixed(4)} (USD ${(report.usage.total.costUsd / n).toFixed(5)} por factura) |`);
  }
  lines.push("");

  lines.push("## Matriz de confusión (filas: esperado; columnas: obtenido)", "", "| Esperado | PAGAR | FRENAR | ESCALAR | ERROR |", "|---|---:|---:|---:|---:|");
  for (const exp of ["PAGAR", "FRENAR", "ESCALAR"]) {
    const row = s.confusion[exp] ?? {};
    lines.push(`| ${exp} | ${row.PAGAR ?? 0} | ${row.FRENAR ?? 0} | ${row.ESCALAR ?? 0} | ${row.ERROR ?? 0} |`);
  }
  lines.push("");

  lines.push(...groupTable("Por trampa (una factura con varias trampas cuenta en cada una)", s.byTrap, live, TRAP_LABELS));
  lines.push(...groupTable("Por formato", s.byFormat, live));
  lines.push(...groupTable("Por presentación", s.byPresentation, live));
  lines.push(...groupTable("Por idioma", s.byLanguage, live));
  lines.push(...groupTable("Por dificultad", s.byDifficulty, live));
  lines.push(...groupTable("Por decisión esperada", s.byExpected, live));
  lines.push(...groupTable("Por tipo de escenario", s.byScenarioKind, live));

  if (report.usage) {
    lines.push("## Consumo por modelo", "");
    lines.push("Precios usados (USD por millón de tokens, entrada / salida): " + Object.entries(PRICES_PER_MILLION).map(([m, p]) => `${m} ${p.input} / ${p.output}`).join(" · ") + ".", "");
    lines.push("| Modelo | Tokens de entrada | Tokens de salida | Costo estimado |", "|---|---:|---:|---:|");
    for (const [model, c] of Object.entries(report.usage.byModel)) lines.push(`| ${model} | ${c.inputTokens} | ${c.outputTokens} | USD ${c.costUsd.toFixed(4)} |`);
    lines.push("");
    lines.push(...usageByReaderTable(report));
  }

  lines.push("## Fallos por tipo", "");
  if (s.failureKinds.length === 0) lines.push("Ninguno.");
  for (const f of s.failureKinds) lines.push(`- **${f.count}** · ${cell(f.key)} · p. ej. ${f.examples.join(", ")}`);
  lines.push("");

  const failures = report.cases.filter((c) => !c.correct);
  lines.push("## Detalle de fallos", "");
  if (failures.length === 0) lines.push("Ninguno.");
  for (const r of failures.slice(0, 300)) {
    const notPassing = [...r.failCodes, ...r.notEvaluableCodes.map((c) => `${c} (sin datos)`)];
    const parts = [
      `**${r.caseId}** (${r.escenario}, ${r.formato}${r.extras ? `, ${r.extras.plantilla}, ${r.extras.trampa}` : ""})`,
      cell(r.descripcion),
      `esperado ${r.expected}${r.expectedCodes.length ? ` [${r.expectedCodes.join(", ")}]` : ""}, obtenido ${r.outcome ?? "—"}${r.guardOverride ? " (guardia)" : ""} [${notPassing.join(", ") || "—"}]`,
    ];
    if (r.improperPayment) parts.push("PAGO INDEBIDO");
    if (r.error) parts.push(`error: ${cell(r.error)}`);
    if (r.summary) parts.push(`resumen: ${cell(r.summary)}`);
    if (r.readerErrors.length) parts.push(`lecturas fallidas: ${cell(r.readerErrors.join("; "))}`);
    lines.push(`- ${parts.join(" · ")}`);
    if (r.reading && report.reader !== "simulated") for (const l of digestLines(r.reading)) lines.push(`  - ${cell(l)}`);
  }
  if (failures.length > 300) lines.push(`- … y ${failures.length - 300} más (ver el JSON).`);
  lines.push("");
  return lines.join("\n");
}

/** JSON del reporte: resumen + casos (el resumen de texto solo en los que fallaron, para aligerarlo). */
export function stressJson(report: EvalReport, s: StressSummary = buildStressSummary(report)): string {
  const cases = report.cases.map((c) => (c.correct ? { ...c, summary: "" } : c));
  return `${JSON.stringify({ ...report, cases, stress: s }, null, 1)}\n`;
}

/** Línea de progreso por escenario para la consola. */
export function scenarioLine(id: string, results: readonly CaseResult[]): string {
  const ok = results.filter((r) => r.correct).length;
  const improper = results.filter((r) => r.improperPayment).length;
  return `  ${id.padEnd(22)} ${String(ok).padStart(3)}/${String(results.length).padEnd(3)} correctas${improper ? ` · ${improper} PAGO(S) INDEBIDO(S)` : ""} (${formatPct(results.length ? ok / results.length : 0)})`;
}
