/**
 * Textos y formatos del resumen. Funciones puras: sirven en cliente y servidor.
 */
import { CHECK_BY_CODE, CHECK_CATALOG } from "@/core/checks";
import type { CheckCode, Outcome } from "@/core/schemas";
import { moneyParts } from "@/components/ui/money";
import type { DecisionSummary, Stats, VendorCountries } from "./types";

/**
 * Lo que falló, dicho corto, por comprobación. Solo depende del código: no es texto de un modelo.
 * LEC-1 se precisa con los datos del resumen (readingReason).
 */
const FAILED_REASON: Record<CheckCode, string> = {
  "LEC-1": "Datos clave incompletos o ilegibles",
  "LEC-2": "Las dos lecturas no coinciden",
  "LEC-3": "Las cuentas no cuadran",
  "LEC-4": "Trae instrucciones escondidas",
  "DUP-1": "Archivo ya procesado",
  "DUP-2": "Número de factura repetido",
  "DUP-3": "Periodo ya pagado",
  "PRV-1": "Proveedor no registrado",
  "PRV-2": "Cuenta destino distinta a la registrada",
  "ACU-1": "Sin acuerdo vigente",
  "ACU-2": "Moneda distinta a la pactada",
  "ACU-3": "Monto fuera de lo pactado",
  "LIM-1": "Supera el umbral de aprobación",
  "LIM-2": "Supera el límite del mes",
  "FON-1": "No alcanza el fondo",
};

/** Título del catálogo, para el `title` de los superíndices. */
export function checkTitle(code: CheckCode): string {
  return CHECK_BY_CODE[code]?.title ?? code;
}

const CODE_BY_TITLE = new Map<string, CheckCode>(CHECK_CATALOG.map((c) => [c.title, c.code]));

/**
 * Comprobaciones que nombra el resumen de un ESCALAR. El resumen sale de una plantilla del motor
 * (src/engine/decide.ts): "Se escala a una persona: no cumple «A» y «B»; sin datos para evaluar «C»."
 * Solo nombra las causas: las que quedaron sin evaluar por culpa de otra no aparecen.
 */
function causesInSummary(summary: string): { failed: CheckCode[]; missing: CheckCode[] } {
  const failed: CheckCode[] = [];
  const missing: CheckCode[] = [];
  for (const part of summary.split(";")) {
    const target = part.includes("no cumple") ? failed : part.includes("sin datos para evaluar") ? missing : null;
    if (!target) continue;
    for (const m of part.matchAll(/«([^»]+)»/g)) {
      const code = CODE_BY_TITLE.get(m[1].trim());
      if (code && !target.includes(code)) target.push(code);
    }
  }
  return { failed, missing };
}

export interface Reason {
  /** Frase corta con punto: "Proveedor no registrado." */
  text: string;
  /** Códigos que explican la decisión, el decisivo primero. */
  codes: CheckCode[];
}

/** Datos clave de LEC-1 que trae el resumen (lo leído de la factura), con su nombre en la frase. */
const KEY_FIELDS = [
  ["vendorName", "el proveedor"],
  ["invoiceNumber", "el número de factura"],
  ["currency", "la moneda"],
  ["total", "el total"],
] as const;

type KeyFields = Pick<DecisionSummary, (typeof KEY_FIELDS)[number][0]>;

function isMissing(value: string | number | null | undefined): boolean {
  if (value == null) return true;
  return typeof value === "string" ? value.trim() === "" : !Number.isFinite(value);
}

/** "a", "a y b", "a, b y c". */
function listEs(items: readonly string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

/**
 * Motivo corto de LEC-1 con lo que se sabe: el resumen trae el proveedor, el número, la moneda y el
 * total leídos (no la cuenta destino ni si un dato se leyó con dudas). Si falta alguno, se nombra;
 * si faltan todos, no se leyó nada; si no falta ninguno, la causa es otra (la cuenta, un dato
 * ilegible o sin respaldo en el texto) y no se adivina cuál.
 */
function readingReason(d: KeyFields): string {
  const missing = KEY_FIELDS.filter(([key]) => isMissing(d[key])).map(([, label]) => label);
  if (missing.length === KEY_FIELDS.length) return "No se pudieron leer los datos de la factura.";
  if (missing.length === 1) return `Falta ${missing[0]}.`;
  if (missing.length > 1) return `Faltan ${listEs(missing)}.`;
  return `${FAILED_REASON["LEC-1"]}.`;
}

function failedReason(code: CheckCode, d: KeyFields): string {
  if (code === "LEC-1") return readingReason(d);
  return `${FAILED_REASON[code] ?? checkTitle(code)}.`;
}

/**
 * Motivo corto de la decisión y los códigos que lo explican.
 * PAGAR → todas cumplen · FRENAR → la primera que frena · ESCALAR → la causa que nombra el resumen
 * (no la primera que no pasó: un proveedor sin registrar deja "sin evaluar" los duplicados, que no son la causa).
 * Si la causa es LEC-1, dice qué dato falta cuando el resumen lo permite ("Falta el total.").
 */
export function reasonOf(d: Pick<DecisionSummary, "outcome" | "failedChecks" | "guardOverride" | "summary"> & KeyFields): Reason {
  if (d.outcome === "PAGAR") return { text: `Las ${CHECK_CATALOG.length} comprobaciones se cumplen.`, codes: [] };
  const failed = d.failedChecks;

  if (d.outcome === "FRENAR") {
    const holds = failed.filter((c) => CHECK_BY_CODE[c]?.outcomeIfFail === "FRENAR");
    const codes = [...holds, ...failed.filter((c) => !holds.includes(c))];
    const decisive = codes[0];
    return { text: decisive ? failedReason(decisive, d) : "Una comprobación frena el pago.", codes };
  }

  if (d.guardOverride) return { text: "La guardia independiente no confirmó el pago.", codes: failed };

  const causes = causesInSummary(d.summary ?? "");
  const named = [...causes.failed, ...causes.missing].filter((c) => failed.includes(c));
  if (causes.failed[0]) {
    const first = causes.failed[0];
    return { text: failedReason(first, d), codes: named.length > 0 ? named : [first] };
  }
  if (causes.missing[0]) {
    return { text: `Sin datos para evaluar «${checkTitle(causes.missing[0])}».`, codes: named };
  }
  // Resumen sin causas nombradas (p. ej. "5 comprobaciones no se pudieron evaluar"): faltan datos.
  if (failed.length > 0) return { text: "Faltan datos para evaluarla.", codes: failed };
  return { text: "Pendiente de una persona.", codes: [] };
}

/** Monto con el código delante, como en los avisos: "COP 12.000.000,00". */
export function moneyLabel(amount: number, currency: string): string {
  const p = moneyParts(amount, currency);
  return `${p.code} ${p.sign}${p.integer}${p.fraction}`;
}

/** Cierra la frase con punto, sin duplicarlo ("… Dev S.A.S." no lleva otro). */
function withPeriod(text: string): string {
  return /[.!?…]$/.test(text) ? text : `${text}.`;
}

const DONE_LABEL: Record<Outcome, string> = { PAGAR: "Pagada.", FRENAR: "Frenada.", ESCALAR: "Escalada." };

/** Aviso de una decisión: "Pagada." + "COP 12.000.000,00 a Camila Restrepo Dev S.A.S." */
export function decisionToast(d: DecisionSummary): { title: string; description: string } {
  const amount = d.total != null && d.currency ? moneyLabel(d.total, d.currency) : null;
  const vendor = d.vendorName?.trim() || null;
  let description: string;
  if (amount && vendor) description = withPeriod(`${amount} a ${vendor}`);
  else if (vendor) description = `Factura de ${vendor}, sin monto legible.`;
  else if (amount) description = `${amount}. Proveedor sin identificar.`;
  else description = withPeriod(d.filename);
  return { title: DONE_LABEL[d.outcome], description };
}

/** Mapa nombre/alias (minúsculas) → país, desde la ficha de proveedores. */
export function vendorCountriesOf(
  vendors: readonly { name: string; aliases?: readonly string[]; country: string }[],
): VendorCountries {
  const map: VendorCountries = {};
  for (const v of vendors) {
    const country = v.country?.trim().toUpperCase();
    if (!country) continue;
    for (const name of [v.name, ...(v.aliases ?? [])]) {
      const key = name?.trim().toLowerCase();
      if (key && !(key in map)) map[key] = country;
    }
  }
  return map;
}

/**
 * País del proveedor: el que guardó la decisión (copia de la ficha al decidir); si no lo trae,
 * el de la ficha actual por nombre o alias. null si el proveedor no está registrado.
 */
export function countryOf(
  d: Pick<DecisionSummary, "vendorCountry" | "vendorName">,
  countries: VendorCountries,
): string | null {
  const saved = d.vendorCountry?.trim().toUpperCase();
  if (saved) return saved;
  if (!d.vendorName) return null;
  return countries[d.vendorName.trim().toLowerCase()] ?? null;
}

/** "hace 3 min" · "hace 2 h" · "hace 4 d". Sin depender de la zona horaria. */
export function relativeTime(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const seconds = Math.max(0, Math.round((now - t) / 1000));
  if (seconds < 45) return "ahora";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  return days === 1 ? "ayer" : `hace ${days} d`;
}

const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

/** "2026-10" → "octubre de 2026". */
export function monthLabel(period: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) return period;
  const name = MONTHS[Number(m[2]) - 1];
  return name ? `${name} de ${m[1]}` : period;
}

/** "2026-10" → "octubre". */
export function monthName(period: string): string {
  const m = /^\d{4}-(\d{2})$/.exec(period);
  return (m && MONTHS[Number(m[1]) - 1]) || period;
}

/** "1 factura" · "3 facturas". */
export function invoicesLabel(n: number): string {
  return n === 1 ? "1 factura" : `${n} facturas`;
}

/**
 * Frase bajo el título del resumen: cómo se repartieron las decisiones y, si hubo pagos, la garantía
 * que los respalda (15 comprobaciones en verde y la guardia de src/guard, por construcción).
 */
export function overviewLine(stats: Pick<Stats, "total" | "byOutcome">): string {
  if (stats.total === 0) return "Todavía no hay facturas revisadas.";
  const { PAGAR, FRENAR, ESCALAR } = stats.byOutcome;
  const split = `${PAGAR} ${PAGAR === 1 ? "pagada" : "pagadas"}, ${FRENAR} ${FRENAR === 1 ? "frenada" : "frenadas"} y ${ESCALAR} ${ESCALAR === 1 ? "escalada" : "escaladas"} a una persona.`;
  if (PAGAR === 0) return `${split} Ningún pago todavía.`;
  const n = CHECK_CATALOG.length;
  return `${split} ${PAGAR === 1 ? "El pago pasó" : "Cada pago pasó"} las ${n} comprobaciones y una segunda revisión independiente.`;
}

/** Suma en USD de las decisiones de un resultado (las que tienen monto). */
export function sumUsd(decisions: readonly DecisionSummary[], outcome: Outcome): number {
  let cents = 0;
  for (const d of decisions) {
    if (d.outcome === outcome && typeof d.amountUsd === "number" && Number.isFinite(d.amountUsd)) {
      cents += Math.round(d.amountUsd * 100);
    }
  }
  return cents / 100;
}

/** Nombre visible de cada escenario del dataset. */
export const SCENARIO_LABEL: Record<string, string> = {
  base: "Escenario base",
  reservado: "Escenario reservado",
  cierre_mes: "Cierre de mes",
  fondo_bajo: "Fondo bajo",
};

/** Escenarios que corren con las reglas de la empresa. Los demás cambian reglas y van al banco de pruebas. */
export const PLAYABLE_SCENARIOS = new Set(["base", "reservado"]);

export const SCENARIO_NOTE: Record<string, string> = {
  base: "Las facturas de octubre en orden: pagos normales, duplicados, cambios de cuenta, montos fuera de lo pactado e instrucciones escondidas.",
  reservado: "Casos reservados para medir: formatos nuevos y otras trampas.",
  cierre_mes: "Usa otro límite mensual.",
  fondo_bajo: "Usa otro fondo inicial.",
};

/** Tipo de archivo por formato del dataset (algunos servidores entregan .eml como texto). */
export const SAMPLE_MEDIA_TYPE: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  eml: "message/rfc822",
  txt: "text/plain",
};
