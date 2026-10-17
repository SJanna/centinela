"use client";

import { Plus, RotateCcw, TriangleAlert, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState, type FormEvent } from "react";
import type { Rules } from "@/core/schemas";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { CountryFlag } from "@/components/ui/country-flag";
import { Card, Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import { Eyebrow, Mono } from "@/components/ui/typography";
import { requestJson } from "./api";
import { FieldError, Notice, controlClasses } from "./fields";
import { CURRENCY_COUNTRY, CURRENCY_NAME, formatAmount, formatAmountExact, formatNumber, parseDecimal } from "./format";
import { PillInput } from "./pill-input";

type NumericKey = "approvalThresholdUsd" | "periodLimitUsd" | "initialFundUsd" | "amountTolerancePct";

export interface RulesContext {
  /** Montos en USD de las decisiones registradas (las que tienen monto). */
  decisionAmountsUsd: number[];
  /** Mes calendario en curso, en palabras: "oct 2026". */
  monthLabel: string;
  /** Pagado (PAGAR) en el mes en curso. */
  monthSpentUsd: number;
  /** Pagado (PAGAR) en todo el historial. */
  paidUsd: number;
  /** Moneda → cuántos acuerdos de proveedores la usan. */
  currenciesInUse: Record<string, number>;
}

interface RuleSpec {
  key: NumericKey;
  n: string;
  code: string;
  codeTitle: string;
  before: string;
  after: string;
  unit: "usd" | "pct";
}

const RULES: readonly RuleSpec[] = [
  {
    key: "approvalThresholdUsd",
    n: "01",
    code: "LIM-1",
    codeTitle: "Bajo el umbral de aprobación",
    before: "Escalar a una persona todo pago mayor a",
    after: ".",
    unit: "usd",
  },
  {
    key: "periodLimitUsd",
    n: "02",
    code: "LIM-2",
    codeTitle: "Dentro del límite del mes",
    before: "No pagar más de",
    after: "por mes calendario.",
    unit: "usd",
  },
  {
    key: "initialFundUsd",
    n: "03",
    code: "FON-1",
    codeTitle: "Hay fondo disponible",
    before: "El agente trabaja con un fondo de",
    after: ".",
    unit: "usd",
  },
  {
    key: "amountTolerancePct",
    n: "04",
    code: "ACU-3",
    codeTitle: "Monto pactado",
    before: "Aceptar diferencias de hasta",
    after: "contra lo acordado.",
    unit: "pct",
  },
];

interface FxRow {
  key: string;
  code: string;
  rate: string;
}

function numericStrings(rules: Rules): Record<NumericKey, string> {
  return {
    approvalThresholdUsd: formatNumber(rules.approvalThresholdUsd),
    periodLimitUsd: formatNumber(rules.periodLimitUsd),
    initialFundUsd: formatNumber(rules.initialFundUsd),
    amountTolerancePct: formatNumber(rules.amountTolerancePct, 4),
  };
}

/** USD primero; el resto en orden alfabético. */
function fxRowsOf(fx: Rules["fxToUsd"]): FxRow[] {
  return Object.keys(fx)
    .sort((a, b) => (a === "USD" ? -1 : b === "USD" ? 1 : a.localeCompare(b)))
    .map((code) => ({ key: code, code, rate: formatNumber(fx[code], 10) }));
}

function parseRule(spec: RuleSpec, raw: string): { value: number | null; error: string | null } {
  const value = parseDecimal(raw, { grouping: spec.unit === "usd" });
  if (value == null) return { value: null, error: spec.unit === "usd" ? "Escribe un monto en USD." : "Escribe un porcentaje." };
  if (value < 0) return { value: null, error: "No puede ser negativo." };
  if (spec.unit === "pct" && value > 100) return { value: null, error: "Usa un porcentaje entre 0 y 100." };
  return { value, error: null };
}

function parseRate(raw: string): { value: number | null; error: string | null } {
  const value = parseDecimal(raw, { grouping: false });
  if (value == null) return { value: null, error: "Escribe la tasa." };
  if (value <= 0) return { value: null, error: "La tasa debe ser mayor que 0." };
  return { value, error: null };
}

const usd = (n: number) => formatAmountExact(n, "USD");

/** Una línea que pone la regla en números, con lo que ya está registrado. Determinista. */
function ruleHint(spec: RuleSpec, value: number | null, ctx: RulesContext): string {
  if (value == null) return "";
  switch (spec.key) {
    case "approvalThresholdUsd": {
      const total = ctx.decisionAmountsUsd.length;
      if (total === 0) return "Por encima de este monto decide una persona. Aún no hay facturas registradas.";
      const above = ctx.decisionAmountsUsd.filter((a) => a > value).length;
      return `${above} de ${total} ${total === 1 ? "factura registrada supera" : "facturas registradas superan"} este monto.`;
    }
    case "periodLimitUsd": {
      const left = value - ctx.monthSpentUsd;
      if (left < 0) return `Pagado en ${ctx.monthLabel}: ${usd(ctx.monthSpentUsd)}. Ya supera este límite: los próximos pagos del mes se escalan.`;
      return `Pagado en ${ctx.monthLabel}: ${usd(ctx.monthSpentUsd)}. Quedan ${usd(left)} este mes.`;
    }
    case "initialFundUsd": {
      const left = value - ctx.paidUsd;
      if (left < 0) return `Pagado hasta hoy: ${usd(ctx.paidUsd)}. El fondo no alcanza: los próximos pagos se frenan.`;
      return `Pagado hasta hoy: ${usd(ctx.paidUsd)}. Disponible con este fondo: ${usd(left)}.`;
    }
    case "amountTolerancePct": {
      const low = 1000 * (1 - value / 100);
      const high = 1000 * (1 + value / 100);
      if (value === 0) return "Con un acuerdo de USD 1.000, solo se acepta una factura de USD 1.000 exactos.";
      return `Con un acuerdo de USD 1.000, se aceptan facturas de ${formatAmount(low, "USD")} a ${formatAmount(high, "USD")}.`;
    }
  }
}

/**
 * Editor de las reglas de la empresa: cuatro frases con valores en píldoras y la tabla de tasas.
 * Guarda con PUT /api/company/rules. Los cambios aplican a las próximas facturas.
 */
export function RulesEditor({ rules, context }: { rules: Rules; context: RulesContext }) {
  const router = useRouter();
  const { toast } = useToast();
  const uid = useId();

  const [baseline, setBaseline] = useState<Rules>(rules);
  const [values, setValues] = useState<Record<NumericKey, string>>(() => numericStrings(rules));
  const [fx, setFx] = useState<FxRow[]>(() => fxRowsOf(rules.fxToUsd));
  const [newCode, setNewCode] = useState("");
  const [newRate, setNewRate] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const parsed = useMemo(() => {
    const out = {} as Record<NumericKey, { value: number | null; error: string | null }>;
    for (const spec of RULES) out[spec.key] = parseRule(spec, values[spec.key]);
    return out;
  }, [values]);

  const fxParsed = useMemo(() => fx.map((row) => ({ ...row, ...parseRate(row.rate) })), [fx]);

  const changedKeys = RULES.filter((spec) => parsed[spec.key].value !== baseline[spec.key]).map((s) => s.key);
  const fxChanged = (() => {
    const codes = fx.map((r) => r.code);
    const base = Object.keys(baseline.fxToUsd);
    if (codes.length !== base.length || codes.some((c) => !(c in baseline.fxToUsd))) return true;
    return fxParsed.some((r) => r.value !== baseline.fxToUsd[r.code]);
  })();
  const changeCount = changedKeys.length + (fxChanged ? 1 : 0);
  const dirty = changeCount > 0;
  const invalid = RULES.some((s) => parsed[s.key].error) || fxParsed.some((r) => r.error);

  const missingInUse = Object.entries(context.currenciesInUse)
    .filter(([code]) => !fx.some((r) => r.code === code))
    .map(([code, count]) => ({ code, count }));

  function resetTo(next: Rules) {
    setValues(numericStrings(next));
    setFx(fxRowsOf(next.fxToUsd));
    setNewCode("");
    setNewRate("");
    setAddError(null);
    setServerError(null);
  }

  function formatOnBlur(spec: RuleSpec, raw: string) {
    const { value, error } = parseRule(spec, raw);
    if (error || value == null) return;
    setValues((v) => ({ ...v, [spec.key]: formatNumber(value, spec.unit === "pct" ? 4 : 2) }));
  }

  function addCurrency() {
    const code = newCode.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) return setAddError("Usa el código de 3 letras de la moneda, como EUR.");
    if (fx.some((r) => r.code === code)) return setAddError(`${code} ya está en la tabla.`);
    const rate = parseRate(newRate);
    if (rate.error || rate.value == null) return setAddError(rate.error);
    setFx((rows) => [...rows, { key: `${code}-${Date.now()}`, code, rate: formatNumber(rate.value as number, 10) }]);
    setNewCode("");
    setNewRate("");
    setAddError(null);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!dirty || invalid || saving) return;
    const next: Rules = {
      approvalThresholdUsd: parsed.approvalThresholdUsd.value as number,
      periodLimitUsd: parsed.periodLimitUsd.value as number,
      initialFundUsd: parsed.initialFundUsd.value as number,
      amountTolerancePct: parsed.amountTolerancePct.value as number,
      fxToUsd: Object.fromEntries(fxParsed.map((r) => [r.code, r.value as number])),
    };
    setSaving(true);
    setServerError(null);
    const result = await requestJson<{ company: { rules: Rules } }>("/api/company/rules", { method: "PUT", body: next });
    setSaving(false);
    if (!result.ok) {
      setServerError(result.error);
      toast({ tone: "ERROR", title: "No se guardaron las reglas.", description: result.error });
      return;
    }
    const saved = result.data.company.rules;
    setBaseline(saved);
    resetTo(saved);
    toast({ tone: "NEUTRAL", title: "Reglas guardadas.", description: "Aplican a las próximas facturas." });
    router.refresh();
  }

  return (
    <form onSubmit={save} noValidate aria-describedby={`${uid}-note`}>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        {/* ── Reglas en frases ── */}
        <Sheet padding="none" aria-labelledby={`${uid}-limits`}>
          <header className="flex items-end justify-between gap-4 px-4 pt-6 pb-4 sm:px-6">
            <div className="space-y-1">
              <Eyebrow>Límites y tolerancia</Eyebrow>
              <h2 id={`${uid}-limits`} className="text-h2">
                Lo que la empresa decide.
              </h2>
            </div>
            <p className="hidden text-caption text-muted sm:block">Montos en USD. Edita la cifra en la frase.</p>
          </header>
          <ol className="border-t border-seam">
            {RULES.map((spec) => {
              const state = parsed[spec.key];
              const changed = changedKeys.includes(spec.key);
              const inputId = `${uid}-${spec.key}`;
              const errorId = `${inputId}-error`;
              return (
                <li
                  key={spec.key}
                  id={`regla-${spec.n}`}
                  className={cn(
                    "relative scroll-mt-28 grid grid-cols-[1.5rem_minmax(0,1fr)] target:bg-accent-tint/60 gap-x-3 border-b border-seam px-4 py-5 last:border-b-0 sm:grid-cols-[2.25rem_minmax(0,1fr)_auto] sm:px-6",
                    "transition-colors duration-150",
                    changed && "bg-accent-tint/40",
                  )}
                >
                  {changed ? <span aria-hidden className="absolute inset-y-3 left-0 w-[2px] rounded-full bg-accent" /> : null}
                  <Mono className="pt-[5px] text-small text-ink-3">{spec.n}</Mono>
                  <div className="min-w-0">
                    <p className="text-h2 leading-[1.6] text-navy">
                      {spec.before}
                      <PillInput
                        id={inputId}
                        value={values[spec.key]}
                        onChange={(v) => setValues((prev) => ({ ...prev, [spec.key]: v }))}
                        onBlur={(v) => formatOnBlur(spec, v)}
                        prefix={spec.unit === "usd" ? "USD" : undefined}
                        suffix={spec.unit === "pct" ? "%" : undefined}
                        label={`${spec.before} … ${spec.after}`.replace(" .", "")}
                        changed={changed}
                        invalid={Boolean(state.error)}
                        errorId={errorId}
                        className={spec.after === "." ? "mr-[0.06em]" : undefined}
                      />
                      {spec.after === "." ? "." : ` ${spec.after}`}
                    </p>
                    {state.error ? (
                      <FieldError id={errorId} className="mt-1.5">
                        {state.error}
                      </FieldError>
                    ) : (
                      <p className="mt-1 text-small text-ink-2">{ruleHint(spec, state.value, context)}</p>
                    )}
                    {changed && !state.error ? (
                      <p className="mt-1 text-caption text-muted">
                        Antes:{" "}
                        <span className="tnum">
                          {spec.unit === "usd" ? formatAmount(baseline[spec.key], "USD") : `${formatNumber(baseline[spec.key], 4)} %`}
                        </span>
                      </p>
                    ) : null}
                  </div>
                  <div className="col-start-2 mt-3 sm:col-start-3 sm:mt-[5px]">
                    <Tooltip content={`Se revisa en ${spec.code}: ${spec.codeTitle.toLowerCase()}.`} side="top" align="end">
                      <span
                        tabIndex={0}
                        className="inline-flex h-6 cursor-help items-center rounded-chip bg-surface-2 px-2 font-mono text-caption tracking-[-0.01em] text-ink-2"
                      >
                        {spec.code}
                      </span>
                    </Tooltip>
                  </div>
                </li>
              );
            })}
          </ol>
        </Sheet>

        {/* ── Tasas de cambio ── */}
        <Card padding="none" aria-labelledby={`${uid}-fx`} as="section">
          <header className="space-y-1 px-5 pt-5 pb-4">
            <Eyebrow>Tasas de cambio</Eyebrow>
            <h2 id={`${uid}-fx`} className="text-h3">
              Cuántos USD vale cada moneda.
            </h2>
            <p className="text-small text-ink-2">Tasas fijas. Con ellas se compara cada factura contra los límites.</p>
          </header>
          <div
            aria-hidden
            className="grid grid-cols-[20px_minmax(0,1fr)_6.75rem_2rem] items-center gap-x-3 border-t border-seam bg-surface-1/70 px-5 py-2 text-caption text-muted"
          >
            <span />
            <span>Moneda</span>
            <span className="text-right">1 unidad en USD</span>
            <span />
          </div>
          <ul className="border-t border-seam">
            {fxParsed.map((row) => {
              const isBase = row.code === "USD";
              const inUse = context.currenciesInUse[row.code] ?? 0;
              const original = baseline.fxToUsd[row.code];
              const isNew = original === undefined;
              const changed = !isBase && (isNew || row.value !== original);
              const inputId = `${uid}-fx-${row.code}`;
              return (
                <li key={row.key} className="border-b border-seam px-5 py-2.5 last:border-b-0">
                  <div className="grid grid-cols-[20px_minmax(0,1fr)_6.75rem_2rem] items-center gap-x-3">
                    <CountryFlag country={CURRENCY_COUNTRY[row.code]} size={20} labelled={false} />
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 leading-tight">
                        <span className="font-mono text-[13px] font-medium tracking-[-0.01em] text-navy">{row.code}</span>
                        {changed ? (
                          <span className="rounded-pill bg-accent-wash px-1.5 text-[10.5px] leading-[16px] font-medium text-accent">
                            {isNew ? "Nueva" : "Cambiada"}
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-0.5 truncate text-caption text-muted">
                        {CURRENCY_NAME[row.code] ?? "Moneda"}
                        {isBase ? " · base" : inUse > 0 ? ` · ${inUse} ${inUse === 1 ? "acuerdo" : "acuerdos"}` : ""}
                      </p>
                    </div>
                    <label htmlFor={inputId} className="sr-only">
                      Valor de 1 {row.code} en USD
                    </label>
                    <input
                      id={inputId}
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      spellCheck={false}
                      disabled={isBase}
                      value={isBase ? "1" : row.rate}
                      aria-invalid={row.error ? true : undefined}
                      aria-describedby={row.error ? `${inputId}-error` : undefined}
                      onChange={(e) => {
                        const v = e.target.value;
                        setFx((rows) => rows.map((r) => (r.key === row.key ? { ...r, rate: v } : r)));
                      }}
                      className={controlClasses(
                        Boolean(row.error),
                        cn("tnum h-9 text-right font-mono text-[13px]", changed && !row.error && "border-accent/60 bg-accent-tint"),
                      )}
                    />
                    {isBase ? (
                      <span aria-hidden />
                    ) : (
                      <button
                        type="button"
                        onClick={() => setFx((rows) => rows.filter((r) => r.key !== row.key))}
                        aria-label={`Quitar ${row.code}`}
                        title={`Quitar ${row.code}`}
                        className="grid size-8 shrink-0 place-items-center rounded-full text-ink-3 transition-colors duration-150 hover:bg-hold-wash hover:text-hold"
                      >
                        <X aria-hidden size={15} strokeWidth={1.75} />
                      </button>
                    )}
                  </div>
                  {row.error && !isBase ? (
                    <FieldError id={`${inputId}-error`} className="mt-1.5 pl-8">
                      {row.error}
                    </FieldError>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <div className="border-t border-seam bg-surface-1/70 px-5 py-4">
            <p className="mb-2 text-caption font-medium text-ink-2">Agregar moneda</p>
            <div className="grid grid-cols-[4.75rem_minmax(0,1fr)_auto] items-center gap-2">
              <label htmlFor={`${uid}-new-code`} className="sr-only">
                Código de la moneda
              </label>
              <input
                id={`${uid}-new-code`}
                value={newCode}
                maxLength={3}
                placeholder="EUR"
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => {
                  setNewCode(e.target.value.toUpperCase());
                  setAddError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCurrency();
                  }
                }}
                className={controlClasses(false, "h-9 font-mono text-[13px] uppercase")}
              />
              <label htmlFor={`${uid}-new-rate`} className="sr-only">
                Valor de 1 unidad en USD
              </label>
              <input
                id={`${uid}-new-rate`}
                value={newRate}
                inputMode="decimal"
                placeholder="1 = ? USD"
                autoComplete="off"
                onChange={(e) => {
                  setNewRate(e.target.value);
                  setAddError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCurrency();
                  }
                }}
                className={controlClasses(false, "tnum h-9 text-right font-mono text-[13px]")}
              />
              <Button type="button" size="sm" variant="secondary" icon={<Plus />} onClick={addCurrency}>
                Agregar
              </Button>
            </div>
            {addError ? <FieldError className="mt-2">{addError}</FieldError> : null}
          </div>
          {missingInUse.length > 0 ? (
            <div className="border-t border-seam p-4">
              <Notice tone="warning" icon={<TriangleAlert />} title="Hay acuerdos sin tasa.">
                {missingInUse.map(({ code, count }) => (
                  <span key={code} className="block">
                    {code}: {count} {count === 1 ? "acuerdo" : "acuerdos"}. Sin tasa, sus facturas se escalan.
                  </span>
                ))}
              </Notice>
            </div>
          ) : null}
        </Card>
      </div>

      {/* ── Guardar ── */}
      <div className={cn("z-20 mt-6", dirty && "sticky bottom-4")}>
        <div
          className={cn(
            "flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-panel px-5 py-3.5 transition-[background-color,box-shadow] duration-200 ease-out",
            dirty ? "bg-surface-0 shadow-pop ring-1 ring-seam" : "bg-surface-1/60 ring-1 ring-line",
          )}
        >
          <div className="min-w-0 space-y-0.5">
            {dirty ? (
              <p className="flex items-center gap-2 text-small font-medium text-navy" role="status">
                <span aria-hidden className="size-1.5 rounded-full bg-accent" />
                {changeCount === 1 ? "1 cambio sin guardar." : `${changeCount} cambios sin guardar.`}
              </p>
            ) : null}
            <p id={`${uid}-note`} className="text-small text-ink-2">
              Los cambios aplican a las próximas facturas. Cada decisión guarda las reglas con que se tomó.
            </p>
            {serverError ? <FieldError className="pt-1">{serverError}</FieldError> : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon={<RotateCcw />}
              disabled={!dirty || saving}
              onClick={() => resetTo(baseline)}
            >
              Descartar cambios
            </Button>
            <Button type="submit" size="sm" disabled={!dirty || invalid || saving}>
              {saving ? "Guardando…" : "Guardar reglas"}
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}
