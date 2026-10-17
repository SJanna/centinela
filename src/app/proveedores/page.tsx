import type { Metadata } from "next";
import { connection } from "next/server";
import { PageHeader } from "@/components/shell/page-header";
import { todayIso } from "@/components/config/format";
import { LoadError } from "@/components/config/load-error";
import { accountAlerts, vendorActivity } from "@/components/config/vendor-activity";
import { VendorsView } from "@/components/config/vendors-view";
import type { DecisionRecord } from "@/core/schemas";
import { ensureCompany } from "@/pipeline";
import { getDecision, listDecisions } from "@/store";

export const metadata: Metadata = {
  title: "Proveedores · Centinela",
};

async function loadVendors() {
  const company = await ensureCompany();
  const decisions = await listDecisions();
  // Solo se abren las decisiones donde PRV-2 no pasó (pocas): para saber si la cuenta no coincidía o faltaba el dato.
  const candidates = decisions.filter((d) => d.vendorId && d.failedChecks.includes("PRV-2"));
  const records = (await Promise.all(candidates.map((d) => getDecision(d.id)))).filter(
    (r): r is DecisionRecord => r !== null,
  );
  return {
    company,
    activity: vendorActivity(company.vendors, decisions),
    alerts: accountAlerts(records),
  };
}

export default async function VendorsPage() {
  await connection();
  let data: Awaited<ReturnType<typeof loadVendors>> | null = null;
  try {
    data = await loadVendors();
  } catch (err) {
    console.error("[proveedores] No se pudo leer la ficha:", err);
  }

  if (!data) {
    return (
      <>
        <PageHeader eyebrow="Empresa" title="Proveedores." />
        <LoadError what="los proveedores" />
      </>
    );
  }

  const { company, activity, alerts } = data;
  return (
    <VendorsView
      companyName={company.name}
      vendors={company.vendors}
      activity={activity}
      alerts={alerts}
      currencies={Object.keys(company.rules.fxToUsd)}
      tolerancePct={company.rules.amountTolerancePct}
      today={todayIso()}
    />
  );
}
