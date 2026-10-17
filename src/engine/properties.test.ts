/**
 * Pruebas de propiedades: entradas aleatorias (proveedores, acuerdos, historial, señales y datos
 * con nulos) y garantías que deben cumplirse SIEMPRE. Los límites se recalculan aquí con una
 * implementación propia, sin usar el código del motor.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CHECK_CATALOG } from "../core/checks";
import type {
  Agreement,
  Company,
  Decision,
  DecisionContext,
  EngineInput,
  HistoryEntry,
  InvoiceData,
  ReadingSignals,
  Rules,
  Vendor,
} from "../core/schemas";
import { decide } from "./index";
import { reading } from "./test-fixtures";

// ───────────────────────── Generadores ─────────────────────────

const CURRENCIES = ["USD", "COP", "MXN", "EUR", "XYZ"] as const;
const DATES = ["2025-12-15", "2026-01-01", "2026-03-31", "2026-06-30", "2026-10-05", "2026-12-31", "2027-02-01"] as const;
const NAMES = ["Acme", "Acme S.A.S.", "ACME sas", "Beta Ltda", "Gamma LLC", "Délta", "Delta"] as const;
/** Nombres e identificaciones propios de cada proveedor generado (la mayoría de las veces). */
const OWN_NAMES = ["Omega Uno SAS", "Sigma Dos Ltda", "Kappa Tres Inc"] as const;
const OWN_TAX_IDS = ["111.111.111-1", "222-222-222", "333333333"] as const;
const TAX_IDS = ["900.123.456-7", "9001234567", "800-555", "X1"] as const;
const ACCOUNTS = ["4512-0098-7731", "451200987731", "0001 2222", "999", "4512009877310"] as const;
const NUMBERS = ["F-1", "f1", "F-2", "A 9"] as const;
const HASHES = ["h1", "h2", "h3", "h4"] as const;
const PERIODS = ["2026-09", "2026-10", "2026-11"] as const;
const DECIDED_AT = ["2026-09-30T23:00:00Z", "2026-10-01T10:00:00Z", "2026-10-19T00:00:00Z", "2026-11-02T08:00:00Z"] as const;
const NOWS = ["2026-10-20T15:00:00Z", "2026-11-05T09:00:00Z"] as const;

/** Montos con centavos, a veces enteros redondos (para que coincidan con acuerdos). */
const amount = fc.oneof(
  fc.integer({ min: 0, max: 30 }).map((n) => n * 500),
  fc.integer({ min: 0, max: 2_000_000 }).map((c) => c / 100),
);

const arbAgreement = (id: string): fc.Arbitrary<Agreement> =>
  fc.record({
    id: fc.constant(id),
    description: fc.constant(`Acuerdo ${id}`),
    kind: fc.constantFrom("fixed_recurring", "hourly", "one_off"),
    currency: fc.oneof({ arbitrary: fc.constantFrom("USD", "COP", "MXN"), weight: 6 }, { arbitrary: fc.constantFrom(...CURRENCIES), weight: 1 }),
    amount: fc.option(amount, { nil: null, freq: 6 }),
    rate: fc.option(fc.constantFrom(25, 60, 75.5, 900), { nil: null, freq: 6 }),
    maxQuantity: fc.option(fc.constantFrom(10, 40, 100), { nil: null }),
    frequency: fc.constantFrom("monthly", "once"),
    validFrom: fc.constantFrom(...DATES.slice(0, 4)),
    validTo: fc.option(fc.constantFrom(...DATES.slice(3)), { nil: null }),
  });

const arbVendor = (i: number): fc.Arbitrary<Vendor> =>
  fc
    .record({
      name: fc.oneof({ arbitrary: fc.constant(OWN_NAMES[i]), weight: 4 }, { arbitrary: fc.constantFrom(...NAMES), weight: 1 }),
      aliases: fc.subarray([...NAMES], { maxLength: 2 }),
      taxId: fc.oneof(
        { arbitrary: fc.constant<string | null>(OWN_TAX_IDS[i]), weight: 3 },
        { arbitrary: fc.option(fc.constantFrom(...TAX_IDS), { nil: null }), weight: 1 },
      ),
      accountNumber: fc.constantFrom(...ACCOUNTS),
      agreementCount: fc.oneof({ arbitrary: fc.constant(0), weight: 1 }, { arbitrary: fc.integer({ min: 1, max: 2 }), weight: 5 }),
    })
    .chain((v) =>
      fc.tuple(...Array.from({ length: v.agreementCount }, (_, j) => arbAgreement(`a${i}-${j}`))).map(
        (agreements): Vendor => ({
          id: `v${i}`,
          name: v.name,
          aliases: v.aliases,
          taxId: v.taxId,
          country: "CO",
          account: { beneficiaryName: v.name, bankName: "Banco", accountNumber: v.accountNumber, routingOrSwift: null },
          agreements,
        }),
      ),
    );

const FX: [string, number][] = [
  ["USD", 1],
  ["COP", 0.00025],
  ["MXN", 0.055],
  ["EUR", 1.08],
];

const arbRules: fc.Arbitrary<Rules> = fc.record({
  approvalThresholdUsd: fc.integer({ min: 0, max: 12_000 }),
  periodLimitUsd: fc.integer({ min: 0, max: 30_000 }),
  initialFundUsd: fc.integer({ min: 0, max: 40_000 }),
  amountTolerancePct: fc.constantFrom(0, 0.5, 1, 5),
  fxToUsd: fc
    .oneof(
      { arbitrary: fc.constant(FX), weight: 4 },
      { arbitrary: fc.subarray(FX, { minLength: 1 }), weight: 1 },
    )
    .map((entries) => Object.fromEntries(entries)),
});

const arbHistoryEntry = (vendorIds: string[], agreementIds: string[], i: number): fc.Arbitrary<HistoryEntry> =>
  fc.record({
    invoiceId: fc.constant(`H${i}`),
    fileHash: fc.constantFrom(...HASHES),
    outcome: fc.constantFrom("PAGAR", "PAGAR", "FRENAR", "ESCALAR"),
    vendorId: fc.option(fc.constantFrom("v-x", ...vendorIds), { nil: null }),
    invoiceNumber: fc.option(fc.constantFrom(...NUMBERS), { nil: null }),
    agreementId: fc.option(fc.constantFrom("a-x", ...agreementIds), { nil: null }),
    agreementPeriod: fc.option(fc.constantFrom(...PERIODS), { nil: null }),
    amountUsd: fc.option(
      fc.integer({ min: 0, max: 1_500_000 }).map((c) => c / 100),
      { nil: null, freq: 12 },
    ),
    decidedAt: fc.constantFrom(...DECIDED_AT),
  });

/** Lista de señales: casi siempre vacía (para que PAGAR sea posible), a veces con un elemento. */
const sometimes = <T>(item: fc.Arbitrary<T>) =>
  fc.oneof({ arbitrary: fc.constant([] as T[]), weight: 15 }, { arbitrary: fc.array(item, { minLength: 1, maxLength: 2 }), weight: 1 });

const arbSignals: fc.Arbitrary<ReadingSignals> = fc.record({
  missingCriticalFields: sometimes(fc.constantFrom("total", "accountNumber")),
  illegibleCriticalFields: sometimes(fc.constantFrom("total", "invoiceNumber")),
  readersDisagreeOn: sometimes(fc.constantFrom("total", "segunda_lectura_no_disponible")),
  arithmeticIssues: sometimes(fc.constant("Las líneas no suman el subtotal")),
  suspiciousInstructions: sometimes(
    fc.record({
      text: fc.string({ maxLength: 200 }),
      source: fc.constantFrom("model" as const, "heuristic" as const),
      reason: fc.constant("orden al sistema"),
    }),
  ),
  evidenceNotFound: sometimes(fc.constantFrom("total", "vendorName")),
});

/** Sustituye un valor por otro aleatorio con probabilidad baja. */
const KEEP = Symbol("keep");
const maybe = <T>(arb: fc.Arbitrary<T>) =>
  fc.oneof({ arbitrary: fc.constant(KEEP as typeof KEEP), weight: 12 }, { arbitrary: arb, weight: 1 });
const pick = <T>(m: T | typeof KEEP, base: T): T => (m === KEEP ? base : m);

/**
 * Factura construida a partir de un proveedor y acuerdo existentes (para que a veces se pague)
 * y luego perturbada campo por campo con valores aleatorios o nulos.
 */
const arbInvoice = (vendors: Vendor[]): fc.Arbitrary<InvoiceData> =>
  fc
    .record({
      vendorIdx: fc.nat(),
      agreementIdx: fc.nat(),
      quantity: fc.constantFrom(1, 10, 37.5, 40, 101),
      vendorName: maybe(fc.option(fc.constantFrom(...NAMES, ...OWN_NAMES, "Desconocido"), { nil: null })),
      vendorTaxId: maybe(fc.option(fc.constantFrom(...TAX_IDS, ...OWN_TAX_IDS), { nil: null })),
      invoiceNumber: maybe(fc.option(fc.constantFrom(...NUMBERS), { nil: null })),
      issueDate: maybe(fc.option(fc.constantFrom(...DATES, "05/10/2026"), { nil: null })),
      servicePeriod: maybe(fc.option(fc.constantFrom(...PERIODS), { nil: null })),
      currency: maybe(fc.option(fc.constantFrom(...CURRENCIES, "usd"), { nil: null })),
      total: maybe(fc.option(fc.oneof(amount, fc.constantFrom(-100, 0, Number.NaN)), { nil: null })),
      unitPrice: maybe(fc.option(fc.constantFrom(25, 60, 75.5, 900, 1000), { nil: null })),
      accountNumber: maybe(fc.option(fc.constantFrom(...ACCOUNTS), { nil: null })),
      lineQuantity: maybe(fc.option(fc.constantFrom(-5, 0, 2, 50, 150), { nil: null })),
    })
    .map((r): InvoiceData => {
      const vendor = vendors.length > 0 ? vendors[r.vendorIdx % vendors.length] : null;
      const agreement =
        vendor && vendor.agreements.length > 0 ? vendor.agreements[r.agreementIdx % vendor.agreements.length] : null;
      const isHourly = agreement?.kind === "hourly";
      const qty = isHourly ? r.quantity : 1;
      const unit = isHourly ? (agreement?.rate ?? 0) : null;
      const baseTotal = agreement ? (isHourly ? qty * (agreement.rate ?? 0) : (agreement.amount ?? 100)) : 100;
      const quantity = pick(r.lineQuantity, isHourly ? qty : null);
      const unitPrice = pick(r.unitPrice, unit);
      const total = pick(r.total, baseTotal);
      return {
        documentType: "invoice",
        vendorName: pick(r.vendorName, vendor?.name ?? "Desconocido"),
        vendorTaxId: pick(r.vendorTaxId, vendor?.taxId ?? null),
        invoiceNumber: pick(r.invoiceNumber, "F-1"),
        issueDate: pick(r.issueDate, agreement?.validFrom ?? "2026-10-05"),
        dueDate: null,
        servicePeriod: pick(r.servicePeriod, "2026-10"),
        currency: pick(r.currency, agreement?.currency ?? "USD"),
        subtotal: total,
        tax: 0,
        total,
        lineItems: [{ description: "Servicio", quantity, unitPrice, amount: total ?? 0 }],
        beneficiaryName: vendor?.name ?? null,
        bankName: null,
        accountNumber: pick(r.accountNumber, vendor?.account.accountNumber ?? "0001 2222"),
        routingOrSwift: null,
      };
    });

interface Scenario {
  input: EngineInput;
  ctx: DecisionContext;
}

const arbScenario: fc.Arbitrary<Scenario> = fc
  .record({
    vendorCount: fc.oneof({ arbitrary: fc.constant(0), weight: 1 }, { arbitrary: fc.integer({ min: 1, max: 3 }), weight: 6 }),
    rules: arbRules,
  })
  .chain(({ vendorCount, rules }) =>
    fc.tuple(...Array.from({ length: vendorCount }, (_, i) => arbVendor(i))).chain((vendors) => {
      const vendorIds = vendors.map((v) => v.id);
      const agreementIds = vendors.flatMap((v) => v.agreements.map((a) => a.id));
      return fc
        .record({
          historySize: fc.integer({ min: 0, max: 4 }),
          data: fc.option(arbInvoice(vendors), { nil: null, freq: 15 }),
          signals: arbSignals,
          fileHash: fc.oneof({ arbitrary: fc.constant("nuevo"), weight: 4 }, { arbitrary: fc.constantFrom(...HASHES), weight: 1 }),
          now: fc.constantFrom(...NOWS),
        })
        .chain((r) =>
          fc
            .tuple(...Array.from({ length: r.historySize }, (_, i) => arbHistoryEntry(vendorIds, agreementIds, i)))
            .map((history): Scenario => {
              const company: Company = { name: "Prueba", rules, vendors };
              return {
                input: { invoiceId: "INV", fileHash: r.fileHash, reading: reading(r.data, r.signals) },
                ctx: { company, history, now: r.now },
              };
            }),
        );
    }),
  );

// ───────────────────────── Recalculo independiente ─────────────────────────

const cents = (n: number) => Math.round(n * 100);
const usdCents = (s: Scenario): number | null => {
  const d = s.input.reading.data;
  if (!d || typeof d.total !== "number" || !Number.isFinite(d.total) || !d.currency) return null;
  const rate = s.ctx.company.rules.fxToUsd[d.currency.trim().toUpperCase()];
  if (typeof rate !== "number") return null;
  return cents(d.total * rate);
};
const isPaid = (h: HistoryEntry) => h.outcome === "PAGAR";
const paidCents = (entries: HistoryEntry[]) => entries.reduce((sum, h) => sum + cents(h.amountUsd ?? 0), 0);
const accountKey = (raw: string | null | undefined) => (raw ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");

const RUNS = { numRuns: 3000, seed: 20261017 };

describe("propiedades del motor", () => {
  it("el generador produce todos los resultados (PAGAR incluido)", () => {
    const outcomes = fc.sample(arbScenario, { numRuns: 3000, seed: 7 }).map((s) => decide(s.input, s.ctx).outcome);
    // Con la semilla fija salen ~200 PAGAR de 3000: las propiedades sobre PAGAR no son vacías.
    expect(outcomes.filter((o) => o === "PAGAR").length).toBeGreaterThan(100);
    expect(outcomes.filter((o) => o === "FRENAR").length).toBeGreaterThan(100);
    expect(outcomes.filter((o) => o === "ESCALAR").length).toBeGreaterThan(100);
  });

  it("forma: 15 comprobaciones en orden, resultado coherente con los estados, determinista", () => {
    fc.assert(
      fc.property(arbScenario, (s) => {
        const d = decide(s.input, s.ctx);
        expect(d.checks.map((c) => c.code)).toEqual(CHECK_CATALOG.map((c) => c.code));
        const effects = d.checks.map((c) =>
          c.status === "pass" ? "PAGAR" : c.status === "not_evaluable" ? "ESCALAR" : c.outcomeIfFail,
        );
        const expected = effects.includes("FRENAR") ? "FRENAR" : effects.includes("ESCALAR") ? "ESCALAR" : "PAGAR";
        expect(d.outcome).toBe(expected);
        expect(d.humanAction === null).toBe(d.outcome !== "ESCALAR");
        if (d.outcome === "ESCALAR") expect((d.humanAction ?? "").length).toBeGreaterThan(0);
        expect(decide(s.input, s.ctx)).toEqual(d);
      }),
      RUNS,
    );
  });

  it("(1) si el resultado es PAGAR, las 15 comprobaciones están en pass", () => {
    fc.assert(
      fc.property(arbScenario, (s) => {
        const d = decide(s.input, s.ctx);
        if (d.outcome === "PAGAR") expect(d.checks.every((c) => c.status === "pass")).toBe(true);
      }),
      RUNS,
    );
  });

  it("(2) nunca PAGAR si alguna señal de lectura no está vacía", () => {
    fc.assert(
      fc.property(arbScenario, (s) => {
        const sig = s.input.reading.signals;
        const anySignal =
          sig.missingCriticalFields.length +
            sig.illegibleCriticalFields.length +
            sig.readersDisagreeOn.length +
            sig.arithmeticIssues.length +
            sig.suspiciousInstructions.length +
            sig.evidenceNotFound.length >
          0;
        if (anySignal || s.input.reading.data == null) expect(decide(s.input, s.ctx).outcome).not.toBe("PAGAR");
      }),
      RUNS,
    );
  });

  it("(3) nunca PAGAR por encima del umbral, del límite mensual o del fondo", () => {
    fc.assert(
      fc.property(arbScenario, (s) => {
        const d = decide(s.input, s.ctx);
        if (d.outcome !== "PAGAR") return;
        const amount = usdCents(s);
        expect(amount).not.toBeNull();
        const a = amount as number;
        const rules = s.ctx.company.rules;
        const paid = s.ctx.history.filter(isPaid);
        const month = s.ctx.now.slice(0, 7);
        const paidThisMonth = paid.filter((h) => h.decidedAt.slice(0, 7) === month);
        expect(a).toBeLessThanOrEqual(cents(rules.approvalThresholdUsd));
        expect(paidCents(paidThisMonth) + a).toBeLessThanOrEqual(cents(rules.periodLimitUsd));
        expect(a).toBeLessThanOrEqual(cents(rules.initialFundUsd) - paidCents(paid));
        expect(cents(d.amountUsd ?? Number.NaN)).toBe(a);
      }),
      RUNS,
    );
  });

  it("(4) nunca PAGAR si la cuenta normalizada no es la registrada del proveedor", () => {
    fc.assert(
      fc.property(arbScenario, (s) => {
        const d: Decision = decide(s.input, s.ctx);
        if (d.outcome !== "PAGAR") return;
        const vendor = s.ctx.company.vendors.find((v) => v.id === d.vendorId);
        expect(vendor).toBeDefined();
        const invoiceAccount = accountKey(s.input.reading.data?.accountNumber);
        expect(invoiceAccount.length).toBeGreaterThan(0);
        expect(invoiceAccount).toBe(accountKey(vendor?.account.accountNumber));
      }),
      RUNS,
    );
  });

  it("nunca PAGAR un archivo ya visto ni un periodo ya pagado", () => {
    fc.assert(
      fc.property(arbScenario, (s) => {
        const d = decide(s.input, s.ctx);
        if (d.outcome !== "PAGAR") return;
        expect(s.ctx.history.some((h) => h.fileHash === s.input.fileHash)).toBe(false);
        const paid = s.ctx.history.filter(isPaid);
        expect(d.agreementId).not.toBeNull();
        if (d.agreementPeriod == null) {
          expect(paid.some((h) => h.agreementId === d.agreementId)).toBe(false);
        } else {
          expect(paid.some((h) => h.agreementId === d.agreementId && h.agreementPeriod === d.agreementPeriod)).toBe(false);
        }
      }),
      RUNS,
    );
  });

  /** Una sola corrupción del contexto o de la lectura que, por sí sola, debe impedir el pago. */
  const NUMERIC_RULES = ["approvalThresholdUsd", "periodLimitUsd", "initialFundUsd", "amountTolerancePct"] as const;
  const arbCorruption = fc.oneof(
    fc.record({
      kind: fc.constant("rule" as const),
      rule: fc.constantFrom(...NUMERIC_RULES),
      value: fc.constantFrom<unknown>(Number.NaN, undefined, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, "5000"),
    }),
    fc.record({ kind: fc.constant("now" as const), now: fc.constantFrom("", "ayer", "10/20/2026", "2026-13-01T00:00:00Z") }),
    fc.record({
      kind: fc.constant("history" as const),
      decidedAt: fc.constantFrom("", "20 de octubre", "2026-10-20T15:00:00Z"),
      amountUsd: fc.constantFrom<number | null>(-1, -50_000, Number.NaN, null),
    }),
    fc.record({ kind: fc.constant("secondary" as const) }),
  );

  function corrupt(s: Scenario, c: typeof arbCorruption extends fc.Arbitrary<infer T> ? T : never): Scenario {
    switch (c.kind) {
      case "rule": {
        const rules = { ...s.ctx.company.rules, [c.rule]: c.value } as unknown as Rules;
        return { ...s, ctx: { ...s.ctx, company: { ...s.ctx.company, rules } } };
      }
      case "now":
        return { ...s, ctx: { ...s.ctx, now: c.now } };
      case "history": {
        // Si la fecha es válida, el monto es el corrupto; si no, la fecha. Un pago real nunca se ignora.
        const amountUsd = c.decidedAt === "2026-10-20T15:00:00Z" ? c.amountUsd : 100;
        const entry: HistoryEntry = {
          invoiceId: "CORRUPTO",
          fileHash: "otra-huella",
          outcome: "PAGAR",
          vendorId: "v-ajeno",
          invoiceNumber: null,
          agreementId: "a-ajeno",
          agreementPeriod: null,
          amountUsd,
          decidedAt: c.decidedAt,
        };
        return { ...s, ctx: { ...s.ctx, history: [...s.ctx.history, entry] } };
      }
      case "secondary":
        return { ...s, input: { ...s.input, reading: { ...s.input.reading, secondary: null } } };
    }
  }

  it("nunca PAGAR con una regla no numérica, una fecha actual ilegible, un pago corrupto o sin segunda lectura", () => {
    let wouldPay = 0;
    fc.assert(
      fc.property(arbScenario, arbCorruption, (s, c) => {
        if (decide(s.input, s.ctx).outcome === "PAGAR") wouldPay += 1;
        const bad = corrupt(s, c);
        expect(decide(bad.input, bad.ctx).outcome).not.toBe("PAGAR");
      }),
      RUNS,
    );
    // La propiedad no es vacía: muchos de estos escenarios se pagarían sin la corrupción.
    expect(wouldPay).toBeGreaterThan(100);
  });
});
