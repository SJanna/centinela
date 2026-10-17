import type { Metadata } from "next";
import { connection } from "next/server";
import { PageHeader } from "@/components/shell/page-header";
import { CheckCatalog } from "@/components/config/check-catalog";
import { LoadError } from "@/components/config/load-error";
import { RulesEditor, type RulesContext } from "@/components/config/rules-editor";
import { formatMonth } from "@/components/config/format";
import { ensureCompany } from "@/pipeline";
import { getStats, listDecisions } from "@/store";

export const metadata: Metadata = {
  title: "Reglas · Centinela",
};

async function loadRules() {
  const company = await ensureCompany();
  const [stats, decisions] = await Promise.all([getStats(new Date().toISOString()), listDecisions()]);
  const currenciesInUse: Record<string, number> = {};
  for (const vendor of company.vendors) {
    for (const agreement of vendor.agreements) {
      const code = agreement.currency.toUpperCase();
      currenciesInUse[code] = (currenciesInUse[code] ?? 0) + 1;
    }
  }
  const context: RulesContext = {
    decisionAmountsUsd: decisions.map((d) => d.amountUsd).filter((a): a is number => typeof a === "number"),
    monthLabel: formatMonth(stats.month),
    monthSpentUsd: stats.monthSpentUsd,
    paidUsd: stats.paidUsd,
    currenciesInUse,
  };
  return { company, context };
}

export default async function RulesPage() {
  await connection();
  let data: Awaited<ReturnType<typeof loadRules>> | null = null;
  try {
    data = await loadRules();
  } catch (err) {
    console.error("[reglas] No se pudieron leer las reglas:", err);
  }

  return (
    <>
      <PageHeader
        eyebrow={data?.company.name ?? "Empresa"}
        title="Reglas de la empresa."
        description="Centinela decide con estas reglas. Cambia las cifras en las frases; las comprobaciones de abajo no cambian."
      />
      {data ? (
        <RulesEditor key={JSON.stringify(data.company.rules)} rules={data.company.rules} context={data.context} />
      ) : (
        <LoadError what="las reglas" />
      )}
      <CheckCatalog headingId="revisa-siempre" />
    </>
  );
}
