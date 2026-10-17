"use client";

/**
 * Banda de indicadores: fondo disponible (hoja grande sobre el estudio, con la cinta detrás),
 * pagado, frenado, escalado y autonomía. Las cifras suben desde 0 y se animan al cambiar.
 */
import { SegmentedBar, UsageBar } from "@/components/ui/bars";
import { CountUp, CountUpMoney } from "@/components/ui/count-up";
import { KpiCard } from "@/components/ui/kpi-card";
import { formatMoneyText, Money } from "@/components/ui/money";
import { Ribbon } from "@/components/ui/ribbon";
import { Sheet, Studio } from "@/components/ui/sheet";
import { TONE } from "@/components/ui/tones";
import { Eyebrow, Mono } from "@/components/ui/typography";
import { cn } from "@/components/ui/cn";
import { invoicesLabel, monthName } from "./format";
import type { Outcome, Stats } from "./types";

const USD_ASIDE = <Mono className="text-caption text-ink-3">USD</Mono>;

const SEGMENTS: { key: Outcome; label: string; one: string }[] = [
  { key: "PAGAR", label: "pagadas", one: "pagada" },
  { key: "FRENAR", label: "frenadas", one: "frenada" },
  { key: "ESCALAR", label: "escaladas", one: "escalada" },
];

/**
 * Conteos bajo la barra de autonomía, cada uno al inicio de su segmento y en su color:
 * así la barra se lee sin leyenda aparte ("9 · 3 · 11" bajo verde, rojo y naranja).
 */
function SegmentCounts({ counts }: { counts: Record<Outcome, number> }) {
  const total = SEGMENTS.reduce((sum, s) => sum + counts[s.key], 0);
  if (total === 0) return null;
  return (
    <div aria-hidden className="mt-1.5 flex w-full gap-[3px]">
      {SEGMENTS.filter((s) => counts[s.key] > 0).map((s) => (
        <span
          key={s.key}
          className={cn("tnum min-w-0 text-caption leading-none font-medium whitespace-nowrap", TONE[s.key].text)}
          style={{ width: `${(counts[s.key] / total) * 100}%` }}
        >
          {counts[s.key]}
        </span>
      ))}
    </div>
  );
}

export function KpiBand({ stats }: { stats: Stats }) {
  const { byOutcome } = stats;
  const month = monthName(stats.month);
  const monthPct = stats.periodLimitUsd > 0 ? stats.monthSpentUsd / stats.periodLimitUsd : 0;
  const monthLeftUsd = Math.max(0, Math.round((stats.periodLimitUsd - stats.monthSpentUsd) * 100) / 100);
  const resolved = byOutcome.PAGAR + byOutcome.FRENAR;

  return (
    <section aria-label="Indicadores" className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <Studio className="md:col-span-2 xl:row-span-2">
        <div aria-hidden className="absolute inset-0 [mask-image:linear-gradient(to_right,transparent_28%,#000_72%)]">
          <Ribbon lines={72} />
        </div>
        <div className="relative flex h-full p-3 sm:p-4 sm:pr-[20%]">
          <Sheet as="article" aria-labelledby="kpi-fondo" className="@container flex min-h-[264px] w-full flex-col">
            <div className="flex items-center justify-between gap-3">
              <Eyebrow id="kpi-fondo">Fondo disponible</Eyebrow>
              {USD_ASIDE}
            </div>
            <div className="mt-4 text-navy">
              <CountUpMoney amount={stats.fundAvailableUsd} size="display" display="symbol" />
            </div>
            <p className="mt-2 text-small text-ink-2">
              De un fondo inicial de {formatMoneyText(stats.initialFundUsd, "USD")}.
            </p>
            {/* Las dos reglas que más escalan: el umbral por factura y lo que queda del límite del mes. */}
            <div aria-hidden className="min-h-5 flex-1" />
            <dl className="grid grid-cols-2 gap-x-6 border-t border-seam pt-4 @max-[22rem]:grid-cols-1 @max-[22rem]:gap-y-3">
              <div className="min-w-0">
                <dt className="text-caption text-muted">Pago sin una persona hasta</dt>
                <dd className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5">
                  <Money amount={stats.approvalThresholdUsd} currency="USD" size="md" className="text-navy" />
                  <span className="text-caption text-ink-3">por factura</span>
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-caption text-muted">Queda del límite de {month}</dt>
                <dd className="mt-0.5">
                  <CountUpMoney
                    amount={monthLeftUsd}
                    size="md"
                    display="code"
                    className={monthPct >= 0.9 ? "text-escalate" : "text-navy"}
                  />
                </dd>
              </div>
            </dl>
            {/* Solo el consumo del mes contra su límite: el umbral es por factura y no se marca sobre el acumulado. */}
            <div className="space-y-2 pt-4">
              <UsageBar
                value={stats.monthSpentUsd}
                max={stats.periodLimitUsd}
                tone={monthPct >= 0.9 ? "ESCALAR" : "NAVY"}
                label={`Pagado en ${month}: ${formatMoneyText(stats.monthSpentUsd, "USD")} de un límite de ${formatMoneyText(stats.periodLimitUsd, "USD")}.`}
              />
              <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-caption text-muted">
                <span>
                  Pagado en {month}{" "}
                  <CountUpMoney amount={stats.monthSpentUsd} size="sm" display="code" className="text-caption text-ink-2" />
                </span>
                <span>
                  Límite{" "}
                  <Money amount={stats.periodLimitUsd} currency="USD" size="sm" display="code" className="text-caption text-ink-2" />
                </span>
              </div>
            </div>
          </Sheet>
        </div>
      </Studio>

      {/* Las tres decisiones con la misma jerarquía: monto arriba, cuántas facturas debajo. */}
      <KpiCard
        eyebrow="Pagado"
        status="PAGAR"
        aside={USD_ASIDE}
        value={<CountUpMoney amount={stats.paidUsd} />}
        caption={invoicesLabel(byOutcome.PAGAR)}
      />
      <KpiCard
        eyebrow="Frenado"
        status="FRENAR"
        aside={USD_ASIDE}
        value={<CountUpMoney amount={stats.heldUsd} />}
        caption={`${invoicesLabel(byOutcome.FRENAR)} sin pagar`}
      />
      <KpiCard
        eyebrow="Escalado"
        status="ESCALAR"
        aside={USD_ASIDE}
        value={<CountUpMoney amount={stats.escalatedUsd} />}
        caption={
          byOutcome.ESCALAR === 1
            ? "1 factura espera a una persona"
            : `${invoicesLabel(byOutcome.ESCALAR)} esperan a una persona`
        }
      />
      <KpiCard
        eyebrow="Autonomía"
        value={<CountUp value={stats.autonomyRate} percent />}
        caption={
          stats.total === 0
            ? "Resueltas sin una persona"
            : `${resolved} de ${stats.total} resueltas sin una persona`
        }
        footer={
          <div>
            <SegmentedBar
              label={SEGMENTS.map((s) => `${byOutcome[s.key]} ${byOutcome[s.key] === 1 ? s.one : s.label}`).join(", ")}
              segments={SEGMENTS.map((s) => ({ key: s.key, value: byOutcome[s.key], tone: s.key, label: s.label }))}
            />
            <SegmentCounts counts={byOutcome} />
          </div>
        }
      />
    </section>
  );
}
