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
import { Eyebrow, Mono } from "@/components/ui/typography";
import { invoicesLabel, monthName, sumUsd } from "./format";
import type { DecisionSummary, Stats } from "./types";

function CountValue({ n }: { n: number }) {
  return (
    <span className="inline-flex items-baseline gap-2">
      <CountUp value={n} />
      <span className="text-small font-normal tracking-normal text-ink-3">{n === 1 ? "factura" : "facturas"}</span>
    </span>
  );
}

function UsdCaption({ amount, suffix }: { amount: number; suffix: string }) {
  return (
    <>
      <CountUpMoney amount={amount} size="sm" display="code" className="font-normal text-ink-2" /> {suffix}
    </>
  );
}

export function KpiBand({ stats, decisions }: { stats: Stats; decisions: readonly DecisionSummary[] }) {
  const { byOutcome } = stats;
  const heldUsd = sumUsd(decisions, "FRENAR");
  const escalatedUsd = sumUsd(decisions, "ESCALAR");
  const month = monthName(stats.month);
  const monthPct = stats.periodLimitUsd > 0 ? stats.monthSpentUsd / stats.periodLimitUsd : 0;
  const monthLeftUsd = Math.max(0, Math.round((stats.periodLimitUsd - stats.monthSpentUsd) * 100) / 100);

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
              <Mono className="text-caption text-ink-3">USD</Mono>
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
            <div className="space-y-2.5 pt-4">
              <UsageBar
                value={stats.monthSpentUsd}
                max={stats.periodLimitUsd}
                tone={monthPct >= 0.9 ? "ESCALAR" : "NAVY"}
                markers={[{ value: stats.approvalThresholdUsd, label: "Umbral" }]}
                label={`Pagado en ${month}: ${formatMoneyText(stats.monthSpentUsd, "USD")} de un límite de ${formatMoneyText(stats.periodLimitUsd, "USD")}. Umbral de aprobación por factura: ${formatMoneyText(stats.approvalThresholdUsd, "USD")}.`}
              />
              <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-caption text-muted">
                <span>
                  Pagado en {month}{" "}
                  <CountUpMoney amount={stats.monthSpentUsd} size="sm" display="none" className="text-caption text-ink-2" />
                </span>
                <span>
                  Límite del mes <span className="tnum font-medium text-ink-2">{formatMoneyText(stats.periodLimitUsd, "USD")}</span>
                </span>
              </div>
            </div>
          </Sheet>
        </div>
      </Studio>

      <KpiCard
        eyebrow="Pagado"
        status="PAGAR"
        aside={<Mono className="text-caption text-ink-3">USD</Mono>}
        value={<CountUpMoney amount={stats.paidUsd} />}
        caption={invoicesLabel(byOutcome.PAGAR)}
      />
      <KpiCard
        eyebrow="Frenado"
        status="FRENAR"
        value={<CountValue n={byOutcome.FRENAR} />}
        caption={<UsdCaption amount={heldUsd} suffix="sin pagar" />}
      />
      <KpiCard
        eyebrow="Escalado"
        status="ESCALAR"
        value={<CountValue n={byOutcome.ESCALAR} />}
        caption={<UsdCaption amount={escalatedUsd} suffix="pendientes" />}
      />
      <KpiCard
        eyebrow="Autonomía"
        value={<CountUp value={stats.autonomyRate} percent />}
        caption="Resueltas sin una persona"
        footer={
          <SegmentedBar
            label={`${byOutcome.PAGAR} pagadas, ${byOutcome.FRENAR} frenadas y ${byOutcome.ESCALAR} escaladas`}
            segments={[
              { key: "PAGAR", value: byOutcome.PAGAR, tone: "PAGAR", label: "Pagadas" },
              { key: "FRENAR", value: byOutcome.FRENAR, tone: "FRENAR", label: "Frenadas" },
              { key: "ESCALAR", value: byOutcome.ESCALAR, tone: "ESCALAR", label: "Escaladas" },
            ]}
          />
        }
      />
    </section>
  );
}
