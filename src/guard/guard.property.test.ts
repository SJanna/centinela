/**
 * Pruebas de propiedades de la guardia (fast-check).
 *
 * Se generan empresas, facturas, historiales y decisiones PAGAR aleatorias (la mayoría «casi
 * correctas», con fallos sembrados de vez en cuando). Si la guardia aprueba, la prueba recalcula
 * POR SU CUENTA (aritmética exacta con BigInt, normalización propia) que se cumplen los
 * invariantes: cuenta registrada, monto ≤ umbral, límite del mes, fondo y archivo no repetido.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { Agreement, Company, Decision, DecisionContext, EngineInput, HistoryEntry, Outcome, Vendor } from "../core/schemas";
import { guardPayment, GUARD_MESSAGES } from "./index";
import { makeDecision, makeInput, type InvoiceSpec } from "./test-fixtures";

// ───────────────────────── Aritmética exacta de la prueba ─────────────────────────

/** Tasas como fracción exacta (numerador / denominador) y como número para la empresa. */
const FX: Record<string, { num: bigint; den: bigint; value: number }> = {
  USD: { num: BigInt(1), den: BigInt(1), value: 1 },
  COP: { num: BigInt(25), den: BigInt(100000), value: 0.00025 },
  MXN: { num: BigInt(55), den: BigInt(1000), value: 0.055 },
  BRL: { num: BigInt(19), den: BigInt(100), value: 0.19 },
  EUR: { num: BigInt(108), den: BigInt(100), value: 1.08 },
};
const CURRENCIES = Object.keys(FX);

/** Centavos de USD exactos (redondeo de mitades hacia arriba) de `cents` en `currency`. */
function exactUsdCents(cents: number, currency: string): number {
  const fx = FX[currency];
  const two = BigInt(2);
  const q = (two * BigInt(cents) * fx.num + fx.den) / (two * fx.den);
  return Number(q);
}

/** Montos de la prueba: siempre enteros de centavos, convertidos con aritmética decimal exacta. */
function units(cents: number): number {
  return cents / 100;
}

/** Normalización de cuenta de la prueba (independiente de la guardia). */
function testAccount(raw: string): string {
  return raw.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
}

// ───────────────────────── Generador de escenarios ─────────────────────────

type Gen = fc.GeneratorValue;

/** Entero uniforme (sin el sesgo de fast-check hacia los extremos, para que las probabilidades sean las escritas). */
const int = (g: Gen, min: number, max: number): number => g(() => fc.noBias(fc.integer({ min, max })));
const pick = <T,>(g: Gen, values: readonly T[]): T => values[int(g, 0, values.length - 1)];
/** true con probabilidad `pct` %. */
const chance = (g: Gen, pct: number): boolean => int(g, 0, 99) < pct;
const digits = (g: Gen, min: number, max: number): string =>
  Array.from({ length: int(g, min, max) }, () => String(int(g, 0, 9))).join("");

/** Inserta separadores al azar (como vendría escrita en una factura). */
function decorate(g: Gen, account: string): string {
  return account
    .split("")
    .map((ch, i) => (i > 0 && chance(g, 20) ? pick(g, [" ", "-", "."]) + ch : ch))
    .join("");
}

const NAMES = [
  { name: "Alfa Servicios S.A.S.", alias: "Alfa" },
  { name: "Beta Labs Inc.", alias: "Beta" },
  { name: "Gamma Ltda", alias: "Gamma Consultores" },
];
const INVOICE_NUMBERS = ["F-001", "F-0001", "F-002", "X-9", "F 1"];
const NOW = "2026-10-20T15:00:00Z";
const NOW_MONTH = "2026-10";

interface Scenario {
  input: EngineInput;
  ctx: DecisionContext;
  decision: Decision;
  spec: InvoiceSpec;
  vendor: Vendor;
  agreement: Agreement;
}

function genVendor(g: Gen, i: number): Vendor {
  const named = chance(g, 15) ? NAMES[0] : NAMES[i];
  const currency = pick(g, CURRENCIES);
  const kind = pick(g, ["fixed_recurring", "hourly", "one_off"] as const);
  const usdTarget = int(g, 50, 6000);
  const amountUnits = Math.max(1, Math.round(usdTarget / FX[currency].value));
  const agreement: Agreement = {
    id: `a-${i}`,
    description: "acuerdo de prueba",
    kind,
    currency,
    amount: kind === "hourly" ? null : amountUnits,
    rate: kind === "hourly" ? Math.max(1, Math.round(amountUnits / 40)) : null,
    maxQuantity: kind === "hourly" ? (chance(g, 10) ? null : int(g, 10, 160)) : null,
    frequency: kind === "one_off" ? "once" : "monthly",
    validFrom: chance(g, 92) ? "2026-01-01" : "2026-11-01",
    validTo: pick(g, [null, null, "2026-12-31", "2026-06-30"]),
  };
  return {
    id: `v-${i}`,
    name: named.name,
    aliases: [named.alias],
    taxId: chance(g, 25) ? null : chance(g, 10) ? "800.000.000-1" : `90${i}.123.456-${i}`,
    country: "CO",
    account: { beneficiaryName: named.name, bankName: "Banco", accountNumber: decorate(g, digits(g, 8, 14)), routingOrSwift: null },
    agreements: [agreement],
  };
}

function genScenario(g: Gen): Scenario {
  const vendors = Array.from({ length: int(g, 1, 3) }, (_, i) => genVendor(g, i));
  const fxToUsd: Record<string, number> = {};
  for (const c of CURRENCIES) if (c === "USD" || chance(g, 95)) fxToUsd[c] = FX[c].value;
  const company: Company = {
    name: "Empresa de prueba",
    rules: {
      approvalThresholdUsd: int(g, 500, 10000),
      periodLimitUsd: int(g, 1000, 30000),
      initialFundUsd: int(g, 1000, 50000),
      amountTolerancePct: pick(g, [0, 1, 2.5]),
      fxToUsd,
    },
    vendors,
  };

  // Factura dirigida a un proveedor (con fallos sembrados)
  const vendor = pick(g, vendors);
  const agreement = vendor.agreements[0];
  const currency = chance(g, 92) ? agreement.currency : pick(g, CURRENCIES);
  let totalCents: number;
  let lineItems: InvoiceSpec["lineItems"];
  if (agreement.kind === "hourly") {
    const rateCents = Math.round((agreement.rate ?? 1) * 100) + (chance(g, 8) ? 100 : 0);
    const hours = int(g, 1, (agreement.maxQuantity ?? 160) + (chance(g, 10) ? 30 : 0));
    const split = hours > 1 && chance(g, 40) ? int(g, 1, hours - 1) : hours;
    const parts = split === hours ? [hours] : [split, hours - split];
    lineItems = parts.map((q) => ({ description: "horas", quantity: q, unitPrice: units(rateCents), amount: units(q * rateCents) }));
    totalCents = parts.reduce((s, q) => s + q * rateCents, 0) + (chance(g, 8) ? int(g, -5000, 5000) : 0);
  } else {
    const agreed = Math.round((agreement.amount ?? 0) * 100);
    const r = int(g, 0, 99);
    totalCents = r < 70 ? agreed : r < 90 ? agreed + Math.round((agreed * int(g, -150, 150)) / 10000) : int(g, 1, agreed * 2 + 100);
    lineItems = [{ description: "servicio", quantity: 1, unitPrice: units(totalCents), amount: units(totalCents) }];
  }
  totalCents = Math.max(1, totalCents);

  const r = int(g, 0, 99);
  const vendorName = r < 60 ? vendor.name : r < 92 ? vendor.aliases[0] : "Desconocido S.A.";
  const t = int(g, 0, 99);
  const vendorTaxId = t < 65 ? vendor.taxId : t < 92 ? null : "999.999.999-9";
  const accountNumber = chance(g, 88) ? decorate(g, testAccount(vendor.account.accountNumber)) : digits(g, 8, 14);
  const issueDate = pick(g, ["2026-10-05", "2026-10-05", "2026-10-05", "2026-10-15", "2026-07-15", null]);
  const servicePeriod = chance(g, 70) ? (issueDate ?? "2026-10").slice(0, 7) : null;
  const spec: InvoiceSpec = {
    vendorName,
    vendorTaxId,
    invoiceNumber: pick(g, INVOICE_NUMBERS),
    issueDate,
    servicePeriod,
    currency,
    total: units(totalCents),
    lineItems,
    accountNumber,
  };

  const signals = chance(g, 90)
    ? {}
    : pick(g, [{ missingCriticalFields: ["total"] }, { readersDisagreeOn: ["accountNumber"] }, { arithmeticIssues: ["no cuadra"] }]);
  const fileHash = `h-${int(g, 0, 5)}`;
  const input = makeInput(spec, { invoiceId: "inv-x", fileHash, signals });

  // Historial
  const history: HistoryEntry[] = Array.from({ length: int(g, 0, 4) }, (_, i) => {
    const hv = pick(g, vendors);
    const outcome: Outcome = chance(g, 70) ? "PAGAR" : pick(g, ["FRENAR", "ESCALAR"] as const);
    return {
      invoiceId: `prev-${i}`,
      fileHash: chance(g, 10) ? fileHash : `prev-hash-${i}`,
      outcome,
      vendorId: hv.id,
      invoiceNumber: pick(g, INVOICE_NUMBERS),
      agreementId: hv.agreements[0].id,
      agreementPeriod: pick(g, ["2026-10", "2026-09", "2026-08"]),
      amountUsd: units(int(g, 0, 300000)),
      decidedAt: pick(g, ["2026-10-02T10:00:00Z", "2026-10-19T23:00:00Z", "2026-09-28T10:00:00Z"]),
    };
  });

  // Decisión PAGAR fabricada (casi siempre con los datos correctos)
  const period = servicePeriod ?? (issueDate ?? NOW).slice(0, 7);
  const usd = currency in fxToUsd ? exactUsdCents(totalCents, currency) : int(g, 1, 100000);
  const decision = makeDecision(input, {
    vendorId: chance(g, 95) ? vendor.id : pick(g, vendors).id,
    agreementId: agreement.id,
    agreementPeriod: chance(g, 95) ? period : "2026-01",
    amountUsd: units(usd + (chance(g, 5) ? 1 : 0)),
  });

  return { input, ctx: { company, history, now: NOW }, decision, spec, vendor, agreement };
}

// ───────────────────────── Invariantes recalculados ─────────────────────────

function sumCents(history: HistoryEntry[], filter: (h: HistoryEntry) => boolean): number {
  return history.filter((h) => h.outcome === "PAGAR" && filter(h)).reduce((s, h) => s + Math.round((h.amountUsd ?? 0) * 100), 0);
}

function assertInvariants(s: Scenario): void {
  const { input, ctx, decision, spec } = s;
  const rules = ctx.company.rules;

  // Cuenta registrada del proveedor de la decisión
  const vendor = ctx.company.vendors.find((v) => v.id === decision.vendorId);
  expect(vendor).toBeDefined();
  expect(testAccount(spec.accountNumber ?? "")).toBe(testAccount(vendor!.account.accountNumber));

  // Monto en USD exacto ≤ umbral, y coincide con la decisión
  const currency = spec.currency ?? "";
  expect(currency in rules.fxToUsd).toBe(true);
  const totalCents = Math.round((spec.total ?? 0) * 100);
  const usd = exactUsdCents(totalCents, currency);
  expect(Math.round((decision.amountUsd ?? 0) * 100)).toBe(usd);
  expect(usd).toBeLessThanOrEqual(rules.approvalThresholdUsd * 100);

  // Límite del mes y fondo
  const paidMonth = sumCents(ctx.history, (h) => h.decidedAt.startsWith(NOW_MONTH));
  expect(paidMonth + usd).toBeLessThanOrEqual(rules.periodLimitUsd * 100);
  const paidAll = sumCents(ctx.history, () => true);
  expect(rules.initialFundUsd * 100 - paidAll).toBeGreaterThanOrEqual(usd);

  // Sin duplicado por archivo
  expect(ctx.history.some((h) => h.fileHash === input.fileHash)).toBe(false);
}

const RUNS = 1500;

describe("guardPayment · propiedades", () => {
  it("si aprueba, los invariantes se cumplen recalculados en la prueba (y aprueba a veces)", () => {
    let approvals = 0;
    let rejections = 0;
    fc.assert(
      fc.property(fc.gen(), (g) => {
        const s = genScenario(g);
        const before = structuredClone({ input: s.input, ctx: s.ctx, decision: s.decision });
        const r = guardPayment(s.input, s.ctx, s.decision);
        // No modifica sus argumentos
        expect({ input: s.input, ctx: s.ctx, decision: s.decision }).toEqual(before);
        // aprobado ⇔ sin violaciones
        expect(r.approved).toBe(r.violations.length === 0);
        if (r.approved) {
          approvals += 1;
          assertInvariants(s);
        } else {
          rejections += 1;
          for (const m of r.violations) expect(m.trim().length).toBeGreaterThan(0);
        }
      }),
      { numRuns: RUNS },
    );
    // La propiedad no es vacía: hay aprobaciones y rechazos.
    expect(approvals).toBeGreaterThan(RUNS * 0.05);
    expect(rejections).toBeGreaterThan(RUNS * 0.05);
  });

  it("si aprueba, cualquier cambio que rompa un invariante hace que deje de aprobar", () => {
    fc.assert(
      fc.property(fc.gen(), fc.integer({ min: 0, max: 4 }), (g, mutation) => {
        const s = genScenario(g);
        if (!guardPayment(s.input, s.ctx, s.decision).approved) return;
        const usdCents = Math.round((s.decision.amountUsd ?? 0) * 100);
        const rules = s.ctx.company.rules;
        let ctx = s.ctx;
        let input = s.input;
        switch (mutation) {
          case 0: // mismo archivo ya procesado
            ctx = { ...ctx, history: [...ctx.history, { ...s.ctx.history[0], invoiceId: "dup", fileHash: s.input.fileHash, outcome: "ESCALAR", amountUsd: 0, decidedAt: NOW } as HistoryEntry] };
            break;
          case 1: { // otra cuenta destino (en las dos lecturas y en los datos)
            const other = `${testAccount(s.spec.accountNumber ?? "")}9`;
            input = makeInput({ ...s.spec, accountNumber: other }, { invoiceId: s.input.invoiceId, fileHash: s.input.fileHash });
            break;
          }
          case 2: // umbral un centavo por debajo
            ctx = { ...ctx, company: { ...ctx.company, rules: { ...rules, approvalThresholdUsd: (usdCents - 1) / 100 } } };
            break;
          case 3: { // fondo un centavo por debajo de lo necesario
            const paidAll = sumCents(ctx.history, () => true);
            ctx = { ...ctx, company: { ...ctx.company, rules: { ...rules, initialFundUsd: (paidAll + usdCents - 1) / 100 } } };
            break;
          }
          case 4: { // límite del mes un centavo por debajo de lo necesario
            const paidMonth = sumCents(ctx.history, (h) => h.decidedAt.startsWith(NOW_MONTH));
            ctx = { ...ctx, company: { ...ctx.company, rules: { ...rules, periodLimitUsd: (paidMonth + usdCents - 1) / 100 } } };
            break;
          }
        }
        const r = guardPayment(input, ctx, { ...s.decision });
        expect(r.approved).toBe(false);
        expect(r.violations.length).toBeGreaterThan(0);
      }),
      { numRuns: RUNS },
    );
  });

  it("si aprueba, una entrada del historial mal formada hace que deje de aprobar", () => {
    const corruptions: ((s: Scenario) => unknown)[] = [
      () => null,
      () => "PAGAR",
      () => ({ invoiceId: "x", fileHash: "otro", outcome: "pagar", vendorId: null, invoiceNumber: null, agreementId: null, agreementPeriod: null, amountUsd: 0, decidedAt: NOW }),
      (s) => ({ invoiceId: "x", fileHash: "otro", outcome: "PAGAR", vendorId: null, invoiceNumber: "Z-1", agreementId: s.agreement.id, agreementPeriod: "2026-01", amountUsd: 0, decidedAt: NOW }),
      (s) => ({ invoiceId: "x", fileHash: "otro", outcome: "PAGAR", vendorId: s.vendor.id, invoiceNumber: "Z-1", agreementId: null, agreementPeriod: "2026-01", amountUsd: 0, decidedAt: NOW }),
      () => ({ invoiceId: "x", fileHash: null, outcome: "ESCALAR", vendorId: null, invoiceNumber: null, agreementId: null, agreementPeriod: null, amountUsd: null, decidedAt: NOW }),
    ];
    let checked = 0;
    fc.assert(
      fc.property(fc.gen(), fc.integer({ min: 0, max: corruptions.length - 1 }), fc.nat(), (g, which, at) => {
        const s = genScenario(g);
        if (!guardPayment(s.input, s.ctx, s.decision).approved) return;
        checked += 1;
        const history = [...s.ctx.history] as unknown[];
        history.splice(at % (history.length + 1), 0, corruptions[which](s));
        const r = guardPayment(s.input, { ...s.ctx, history: history as HistoryEntry[] }, s.decision);
        expect(r.approved).toBe(false);
        expect(r.violations).not.toContain(GUARD_MESSAGES.internalError);
      }),
      { numRuns: 600 },
    );
    expect(checked).toBeGreaterThan(0);
  });

  it("nunca aprueba una decisión que no sea PAGAR", () => {
    fc.assert(
      fc.property(fc.gen(), fc.constantFrom<Outcome>("FRENAR", "ESCALAR"), (g, outcome) => {
        const s = genScenario(g);
        const r = guardPayment(s.input, s.ctx, { ...s.decision, outcome });
        expect(r).toEqual({ approved: false, violations: ["la decisión no es un pago"] });
      }),
      { numRuns: 300 },
    );
  });

  it("nunca lanza, aunque los datos leídos sean basura", () => {
    const junk = fc.oneof(fc.string(), fc.double(), fc.constant(null), fc.integer());
    fc.assert(
      fc.property(fc.gen(), junk, junk, junk, (g, a, b, c) => {
        const s = genScenario(g);
        const data = { ...s.input.reading.data!, vendorName: a, accountNumber: b, total: c, currency: b } as unknown as NonNullable<EngineInput["reading"]["data"]>;
        const input = { ...s.input, reading: { ...s.input.reading, data } };
        const r = guardPayment(input, s.ctx, s.decision);
        expect(typeof r.approved).toBe("boolean");
        // La guardia nunca lanza (lo atrapa todo), así que lo que se prueba es que la basura se
        // rechaza por la regla que corresponde y no cae en el error interno.
        expect(r.violations).not.toContain(GUARD_MESSAGES.internalError);
        if (r.approved) assertInvariants({ ...s, input, spec: { ...s.spec, accountNumber: String(b), total: Number(c), currency: String(b) } });
      }),
      { numRuns: 500 },
    );
  });
});
