import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { displayVendorName, InvoiceDetail, invoiceIdsIn, type InvoiceRefs } from "@/components/invoice";
import { DECISION_LABEL } from "@/components/ui";
import type { DecisionRecord } from "@/core/schemas";
import { getDecision, getDecisionByInvoice } from "@/store";

interface PageProps {
  params: Promise<{ id: string }>;
}

/**
 * La decisión por su id (dec_…). También acepta el id de la factura (inv_…): las explicaciones de
 * duplicados citan la factura anterior y así se puede enlazar.
 */
const loadRecord = cache(async (id: string): Promise<DecisionRecord | null> => {
  await connection();
  const decoded = decodeURIComponent(id);
  const byId = await getDecision(decoded);
  if (byId) return byId;
  return decoded.startsWith("inv_") ? getDecisionByInvoice(decoded) : null;
});

/**
 * Las explicaciones de duplicados citan la factura anterior por su id (inv_…). Se resuelve aquí a su
 * número y su decisión, para que la frase diga "factura CM-INV-2026-10-0412" y enlace a ella.
 */
async function loadInvoiceRefs(record: DecisionRecord): Promise<InvoiceRefs> {
  const texts = [record.decision.summary, ...(record.decision.checks ?? []).map((c) => c.explanation)];
  const ids = [...new Set(texts.flatMap((t) => invoiceIdsIn(t ?? "").map((id) => id.toLowerCase())))];
  const entries = await Promise.all(
    ids.map(async (id) => {
      const ref = await getDecisionByInvoice(id).catch(() => null);
      if (!ref) return null;
      const label = ref.reading?.data?.invoiceNumber ?? ref.filename;
      const outcome = DECISION_LABEL[ref.decision.outcome];
      return [id, { href: `/facturas/${ref.id}`, label, title: `${ref.filename} · ${outcome} Ver esa decisión.` }] as const;
    }),
  );
  return Object.fromEntries(entries.filter((e) => e != null));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const record = await loadRecord(id);
  if (!record) return { title: "Decisión no encontrada · Centinela" };
  const number = record.reading?.data?.invoiceNumber ?? record.filename;
  const vendor = displayVendorName(record);
  return {
    title: `${number} · ${DECISION_LABEL[record.decision.outcome].replace(/\.$/, "")} · Centinela`,
    description: vendor ? `${vendor}. ${record.decision.summary}` : record.decision.summary,
  };
}

export default async function InvoiceDetailPage({ params }: PageProps) {
  const { id } = await params;
  const record = await loadRecord(id);
  if (!record) notFound();
  const refs = await loadInvoiceRefs(record);
  // La clave reinicia el estado de cliente (pestaña, filtro, hover) al pasar de una decisión a otra.
  return <InvoiceDetail key={record.id} record={record} refs={refs} />;
}
