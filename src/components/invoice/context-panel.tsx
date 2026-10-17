import type { ReactNode } from "react";
import { Avatar, Badge, CountryChip, Eyebrow, Mono, Money, Sheet } from "@/components/ui";
import type { CheckResult, DecisionRecord } from "@/core/schemas";
import { idempotencyKeyOf } from "@/pipeline/idempotency";
import { matchedAgreement, matchedVendor } from "./decision-utils";
import { AGREEMENT_KIND_LABEL, formatDateLong, formatNumber, formatPeriod } from "./format";
import { MaskedAccount } from "./reading-table";

const MATCH_BASIS: Record<string, string> = {
  tax_id: "Emparejado por identificación tributaria.",
  name: "Emparejado por nombre o alias.",
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,42%)_1fr] items-baseline gap-3 py-2">
      <dt className="text-caption text-muted">{label}</dt>
      <dd className="min-w-0 text-small break-words text-ink">{children}</dd>
    </div>
  );
}

function num(check: CheckResult | undefined, key: string): number | null {
  const v = check?.params?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function ContextPanel({ record }: { record: DecisionRecord }) {
  const vendor = matchedVendor(record);
  const agreement = matchedAgreement(record, vendor);
  const rules = record.companySnapshot?.rules;
  const data = record.reading?.data ?? null;
  const checks = record.decision.checks ?? [];
  const byCode = new Map(checks.map((c) => [c.code, c]));
  const prv1 = byCode.get("PRV-1");
  const lim2 = byCode.get("LIM-2");
  const fon1 = byCode.get("FON-1");
  const currency = data?.currency ?? agreement?.currency ?? null;
  const fx = currency && rules?.fxToUsd ? rules.fxToUsd[currency] : undefined;
  const month = typeof lim2?.params?.month === "string" ? lim2.params.month : null;
  const spentUsd = num(lim2, "spentUsd");
  const availableUsd = num(fon1, "availableUsd");
  const basis = typeof prv1?.params?.basis === "string" ? MATCH_BASIS[prv1.params.basis] : undefined;
  // Servidor: usa node:crypto. Se calcula al mostrar; no está en el registro.
  const idempotency = idempotencyKeyOf(record);

  return (
    <Sheet padding="none" aria-labelledby="contexto-titulo" className="@container">
      <header className="space-y-1 px-6 pt-6 pb-2">
        <h2 id="contexto-titulo" className="text-h2">
          Contexto usado
        </h2>
        <p className="text-small text-ink-2">La ficha y las reglas tal como estaban al decidir. Si cambian después, esto no cambia.</p>
      </header>

      <div className="grid @lg:grid-cols-2">
        {/* Proveedor */}
        <section aria-label="Proveedor emparejado" className="px-6 pt-4 pb-5">
          <Eyebrow className="mb-3">Proveedor emparejado</Eyebrow>
          {vendor ? (
            <>
              <div className="mb-2 flex items-center gap-3">
                <Avatar name={vendor.name} size={32} />
                <div className="min-w-0">
                  <p className="truncate text-body font-medium text-navy">{vendor.name}</p>
                  <Mono className="text-caption text-ink-3">{vendor.id}</Mono>
                </div>
              </div>
              <CountryChip country={vendor.country} currency={agreement?.currency ?? currency} className="mb-2" />
              <dl className="divide-y divide-seam">
                <Row label="Identificación">
                  <Mono>{vendor.taxId ?? "—"}</Mono>
                </Row>
                <Row label="Beneficiario">{vendor.account.beneficiaryName}</Row>
                <Row label="Banco">{vendor.account.bankName}</Row>
                <Row label="Cuenta registrada">
                  <MaskedAccount value={vendor.account.accountNumber} />
                </Row>
                {vendor.account.routingOrSwift ? (
                  <Row label="SWIFT o ruta">
                    <Mono>{vendor.account.routingOrSwift}</Mono>
                  </Row>
                ) : null}
              </dl>
              {basis ? <p className="mt-2 text-caption text-muted">{basis}</p> : null}
            </>
          ) : (
            <div className="space-y-2">
              <Badge tone="warning">Sin proveedor emparejado</Badge>
              <p className="text-small text-ink-2">
                {data?.vendorName ? (
                  <>
                    «{data.vendorName}» no coincide con ningún proveedor de la ficha.
                  </>
                ) : (
                  "La factura no trae un nombre o identificación que se pueda emparejar."
                )}
              </p>
            </div>
          )}
        </section>

        {/* Acuerdo */}
        <section aria-label="Acuerdo aplicado" className="border-t border-seam px-6 pt-4 pb-5 @lg:border-t-0 @lg:border-l">
          <Eyebrow className="mb-3">Acuerdo aplicado</Eyebrow>
          {agreement ? (
            <>
              <p className="mb-2 text-body font-medium text-pretty text-navy">{agreement.description}</p>
              <dl className="divide-y divide-seam">
                <Row label="Tipo">{AGREEMENT_KIND_LABEL[agreement.kind]}</Row>
                {agreement.kind === "hourly" ? (
                  <>
                    <Row label="Tarifa">
                      <Money amount={agreement.rate} currency={agreement.currency} size="sm" /> por hora
                    </Row>
                    <Row label="Máximo">{agreement.maxQuantity != null ? `${formatNumber(agreement.maxQuantity)} h al mes` : "Sin máximo"}</Row>
                  </>
                ) : (
                  <Row label="Monto pactado">
                    <Money amount={agreement.amount} currency={agreement.currency} size="sm" />
                    {agreement.frequency === "monthly" ? " al mes" : ""}
                  </Row>
                )}
                <Row label="Vigencia">
                  Desde el {formatDateLong(agreement.validFrom)}
                  {agreement.validTo ? ` hasta el ${formatDateLong(agreement.validTo)}` : ", sin fecha de fin"}.
                </Row>
                {record.decision.agreementPeriod ? (
                  <Row label="Periodo imputado">{formatPeriod(record.decision.agreementPeriod)}</Row>
                ) : null}
              </dl>
            </>
          ) : (
            <p className="text-small text-ink-2">
              {vendor ? "No hay un acuerdo aplicable a esta factura." : "Sin proveedor no hay acuerdo que aplicar."}
            </p>
          )}
        </section>
      </div>

      {/* Reglas */}
      {rules ? (
        <section aria-label="Reglas en ese momento" className="border-t border-seam px-6 pt-4 pb-6">
          <Eyebrow className="mb-2">Reglas en ese momento</Eyebrow>
          <dl className="grid gap-x-8 @lg:grid-cols-2">
            <div className="divide-y divide-seam">
              <Row label="Umbral de aprobación">
                <Money amount={rules.approvalThresholdUsd} currency="USD" size="sm" />
              </Row>
              <Row label="Límite mensual">
                <Money amount={rules.periodLimitUsd} currency="USD" size="sm" />
              </Row>
              <Row label={month ? `Pagado en ${formatPeriod(month)}` : "Pagado en el mes"}>
                {spentUsd != null ? <Money amount={spentUsd} currency="USD" size="sm" /> : "—"}
                <span className="block text-caption text-muted">Antes de esta factura.</span>
              </Row>
            </div>
            <div className="divide-y divide-seam">
              <Row label="Fondo inicial">
                <Money amount={rules.initialFundUsd} currency="USD" size="sm" />
              </Row>
              <Row label="Fondo disponible">
                {availableUsd != null ? <Money amount={availableUsd} currency="USD" size="sm" /> : "—"}
                <span className="block text-caption text-muted">Antes de esta factura.</span>
              </Row>
              <Row label="Tolerancia del monto">±{formatNumber(rules.amountTolerancePct)} %</Row>
              <Row label="Tasa de cambio usada">
                {!currency ? (
                  "Sin moneda leída."
                ) : currency === "USD" ? (
                  "USD. Sin conversión."
                ) : fx != null ? (
                  <Mono>
                    1 {currency} = {formatNumber(fx)} USD
                  </Mono>
                ) : (
                  `No hay tasa para ${currency}.`
                )}
              </Row>
            </div>
          </dl>
        </section>
      ) : null}

      {/* Clave de idempotencia */}
      <section aria-labelledby="clave-idempotencia-titulo" className="border-t border-seam px-6 pt-4 pb-6">
        <Eyebrow id="clave-idempotencia-titulo" className="mb-2">
          Clave de idempotencia
        </Eyebrow>
        {idempotency.key ? (
          <>
            <Mono className="block text-small break-all text-ink select-all">{idempotency.key}</Mono>
            <p className="mt-1 text-caption text-muted">
              Sale del proveedor y el número de factura normalizado: <Mono>{idempotency.invoiceKey}</Mono>.
            </p>
          </>
        ) : (
          <p className="text-small text-ink-2">{idempotency.reason}</p>
        )}
        <p className="mt-2 text-small text-ink-2">
          La misma factura produce siempre la misma clave. Quien ejecute el pago puede usarla para no pagarla dos veces.
        </p>
      </section>
    </Sheet>
  );
}
