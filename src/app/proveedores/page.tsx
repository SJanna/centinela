import type { Metadata } from "next";
import { connection } from "next/server";
import { PageHeader } from "@/components/shell/page-header";
import { todayIso } from "@/components/config/format";
import { LoadError } from "@/components/config/load-error";
import { vendorActivity } from "@/components/config/vendor-activity";
import { VendorsView } from "@/components/config/vendors-view";
import { ensureCompany } from "@/pipeline";
import { getHistory, listDecisions } from "@/store";

export const metadata: Metadata = {
  title: "Proveedores · Centinela",
};

async function loadVendors() {
  const company = await ensureCompany();
  const [decisions, history] = await Promise.all([listDecisions(), getHistory()]);
  return {
    company,
    activity: vendorActivity(company.vendors, decisions, history),
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

  const { company, activity } = data;
  return (
    <VendorsView
      companyName={company.name}
      vendors={company.vendors}
      activity={activity}
      currencies={Object.keys(company.rules.fxToUsd)}
      tolerancePct={company.rules.amountTolerancePct}
      today={todayIso()}
    />
  );
}
