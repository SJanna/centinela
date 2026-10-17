import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/page-header";
import { isLedgerFilter, type LedgerFilter } from "@/components/config/ledger-filters";
import { LedgerView } from "@/components/config/ledger-view";
import { LoadError } from "@/components/config/load-error";
import { getShellStatus } from "@/components/shell/status";
import { listDecisions } from "@/store";

export const metadata: Metadata = {
  title: "Registro · Centinela",
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const rawFilter = first(params.decision);
  const filter: LedgerFilter = isLedgerFilter(rawFilter) ? rawFilter : "todas";
  const query = (first(params.q) ?? "").slice(0, 120);

  const { companyName } = await getShellStatus();
  let decisions: Awaited<ReturnType<typeof listDecisions>> | null = null;
  try {
    decisions = await listDecisions();
  } catch (err) {
    console.error("[registro] No se pudo leer el registro:", err);
  }

  if (!decisions) {
    return (
      <>
        <PageHeader eyebrow={companyName} title="Registro de decisiones." />
        <LoadError what="las decisiones" />
      </>
    );
  }

  return <LedgerView companyName={companyName} decisions={decisions} initialFilter={filter} initialQuery={query} />;
}
