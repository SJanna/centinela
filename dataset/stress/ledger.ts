/**
 * Libro de un escenario del set de estrés: lleva lo que la receta dice que ya se pagó y, con las
 * reglas de la empresa (dataset/company.json + rulesOverride del escenario), agrega a cada factura
 * las comprobaciones que dependen del historial y de los montos:
 *
 * - DUP-1: el mismo archivo ya se procesó (cualquier decisión).
 * - DUP-2: ya se PAGÓ una factura del mismo proveedor con el mismo número (normalizado como dice
 *   docs/ARCHITECTURE.md: alfanumérico en mayúsculas, sin tildes y sin ceros a la izquierda).
 * - DUP-3: ya se PAGÓ el mismo acuerdo y periodo (o el acuerdo de pago único).
 * - LIM-1: monto en USD > umbral. LIM-2: pagado en el mes + monto > límite. FON-1: fondo − pagado < monto.
 *   Todos los pagos de un escenario ocurren en el mes de su «now».
 *
 * La decisión sale de la regla del catálogo: alguna FRENAR → FRENAR; si no, alguna → ESCALAR; si no → PAGAR.
 * No usa src/engine: es la cuenta que haría una persona con la receta y las reglas en la mano.
 */
import { CHECK_BY_CODE } from "../../src/core/checks";
import type { CheckCode, Outcome, Rules } from "../../src/core/schemas";

/** Hechos de una factura según su receta. */
export interface Facts {
  /** Proveedor registrado que la factura identifica (null si no hay: no registrado, impostor…). */
  vendorId: string | null;
  /** Acuerdo que corresponde (null si el proveedor no se identifica o el acuerdo no está vigente). */
  agreementId: string | null;
  /** Mes facturado (YYYY-MM) de un acuerdo mensual, o "once" para el de pago único. */
  period: string | null;
  /** Número de factura normalizado (para DUP-2). */
  numberKey: string | null;
  /** Id del caso cuyo archivo es este (las copias exactas comparten el del original). */
  fileKey: string;
  /** Monto en centavos de USD, o null si no se puede calcular (total ilegible, moneda sin tasa). */
  usdCents: number | null;
  /** Comprobaciones que fallan por lo que trae el documento (catalog.ts). */
  intrinsic: CheckCode[];
}

export interface Label {
  outcome: Outcome;
  /** Todas las comprobaciones que deben quedar sin pasar, en el orden del catálogo. */
  codes: CheckCode[];
  /** Las que agregó el libro (historial, umbral, límite, fondo). */
  added: CheckCode[];
}

const ORDER: CheckCode[] = ["LEC-1", "LEC-2", "LEC-3", "LEC-4", "DUP-1", "DUP-2", "DUP-3", "PRV-1", "PRV-2", "ACU-1", "ACU-2", "ACU-3", "LIM-1", "LIM-2", "FON-1"];

/** Número de factura comparable (docs/ARCHITECTURE.md, «Pago doble entre instancias»). */
export function invoiceNumberKey(raw: string): string {
  return raw
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean)
    .map((t) => t.replace(/\d+/g, (d) => d.replace(/^0+/, "") || "0"))
    .join("");
}

const cents = (usd: number) => Math.round(usd * 100);

/** Monto de un documento en centavos de USD con la tasa fija de las reglas (mitades lejos de cero). */
export function usdCentsOf(total: number, currency: string, rules: Rules): number | null {
  const fx = Object.prototype.hasOwnProperty.call(rules.fxToUsd, currency) ? rules.fxToUsd[currency] : undefined;
  if (fx == null) return null;
  const totalCents = Number((total * 100).toPrecision(15));
  const raw = Number((Math.round(totalCents) * fx).toPrecision(15));
  return Math.round(raw);
}

interface Entry {
  fileKey: string;
  outcome: Outcome;
  vendorId: string | null;
  numberKey: string | null;
  agreementId: string | null;
  period: string | null;
  usdCents: number | null;
}

export class Ledger {
  private readonly entries: Entry[] = [];

  constructor(readonly rules: Rules) {}

  /** Lo pagado hasta ahora en el escenario (centavos de USD). */
  get spentCents(): number {
    return this.entries.filter((e) => e.outcome === "PAGAR").reduce((s, e) => s + (e.usdCents ?? 0), 0);
  }

  /** Cuánto se puede pagar todavía sin pasar el límite del mes ni el fondo. */
  get roomCents(): number {
    return Math.min(cents(this.rules.periodLimitUsd), cents(this.rules.initialFundUsd)) - this.spentCents;
  }

  isPaid(agreementId: string, period: string): boolean {
    return this.entries.some((e) => e.outcome === "PAGAR" && e.agreementId === agreementId && e.period === period);
  }

  /** Etiqueta que corresponde a una factura con estos hechos, en este punto del escenario. */
  label(f: Facts): Label {
    const added = new Set<CheckCode>();
    const paid = this.entries.filter((e) => e.outcome === "PAGAR");
    if (this.entries.some((e) => e.fileKey === f.fileKey)) added.add("DUP-1");
    if (f.vendorId && f.numberKey && paid.some((e) => e.vendorId === f.vendorId && e.numberKey === f.numberKey)) added.add("DUP-2");
    if (f.agreementId && f.period && paid.some((e) => e.agreementId === f.agreementId && e.period === f.period)) added.add("DUP-3");
    if (f.usdCents != null) {
      const spent = this.spentCents;
      if (f.usdCents > cents(this.rules.approvalThresholdUsd)) added.add("LIM-1");
      if (spent + f.usdCents > cents(this.rules.periodLimitUsd)) added.add("LIM-2");
      if (cents(this.rules.initialFundUsd) - spent < f.usdCents) added.add("FON-1");
    }
    const all = new Set<CheckCode>([...f.intrinsic, ...added]);
    const codes = ORDER.filter((c) => all.has(c));
    let outcome: Outcome = "PAGAR";
    if (codes.some((c) => CHECK_BY_CODE[c].outcomeIfFail === "FRENAR")) outcome = "FRENAR";
    else if (codes.length > 0) outcome = "ESCALAR";
    return { outcome, codes, added: ORDER.filter((c) => added.has(c) && !f.intrinsic.includes(c)) };
  }

  commit(f: Facts, outcome: Outcome): void {
    this.entries.push({
      fileKey: f.fileKey,
      outcome,
      vendorId: f.vendorId,
      numberKey: f.numberKey,
      agreementId: f.agreementId,
      period: f.period,
      usdCents: f.usdCents,
    });
  }
}
