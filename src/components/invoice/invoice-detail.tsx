import { HeaderCrumb } from "@/components/shell";
import type { DecisionRecord } from "@/core/schemas";
import { ChecksPanel } from "./checks-panel";
import { ContextPanel } from "./context-panel";
import { DecisionHeader } from "./decision-header";
import { DecisionTrace } from "./decision-trace";
import { uniqueSuspicious } from "./decision-utils";
import { DetailActions } from "./detail-actions";
import { DetailProvider } from "./detail-context";
import { DocumentPanel } from "./document-panel";
import { fieldEvidence } from "./fields";
import type { InvoiceRefs } from "./invoice-links";
import { ReadingTable } from "./reading-table";
import { SuspiciousBar } from "./suspicious-bar";

/**
 * Detalle completo de una decisión: encabezado con el porqué; a la izquierda (55 %) el documento,
 * los datos leídos y el contexto; a la derecha (45 %) las comprobaciones y la traza. Servidor.
 *
 * Las columnas dependen del ancho del contenido (@container), no de la ventana: con la barra lateral,
 * una ventana de 1024 px deja ~720 px y dos columnas no caben. En una columna el orden es documento,
 * comprobaciones, datos leídos, contexto y traza.
 */
export function InvoiceDetail({ record, refs = {} }: { record: DecisionRecord; refs?: InvoiceRefs }) {
  const suspicious = uniqueSuspicious(record);
  const needles = suspicious.map((s) => ({ text: s.text, reason: s.reason }));
  const evidence = fieldEvidence(record.reading);

  return (
    <DetailProvider>
      <div className="@container">
        <HeaderCrumb>{record.reading?.data?.invoiceNumber ?? record.filename}</HeaderCrumb>
        {suspicious.length > 0 ? <SuspiciousBar count={suspicious.length} /> : null}

        <DecisionHeader record={record} refs={refs} />

        <div className="mt-8 flex flex-col gap-6 @4xl:grid @4xl:grid-cols-[minmax(0,55fr)_minmax(0,45fr)] @4xl:items-start">
          <div className="contents @4xl:block @4xl:min-w-0 @4xl:space-y-6">
            <div className="order-1 min-w-0">
              <DocumentPanel invoiceId={record.invoiceId} filename={record.filename} needles={needles} evidence={evidence} />
            </div>
            <div className="order-3 min-w-0">
              <ReadingTable reading={record.reading} />
            </div>
            <div className="order-4 min-w-0">
              <ContextPanel record={record} />
            </div>
          </div>
          <div className="contents @4xl:block @4xl:min-w-0 @4xl:space-y-6">
            <div className="order-2 min-w-0">
              <ChecksPanel decision={{ ...record.decision, checks: record.decision.checks ?? [] }} refs={refs} />
            </div>
            <div className="order-5 min-w-0">
              <DecisionTrace record={record} />
            </div>
          </div>
        </div>

        <footer className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-6">
          <p className="max-w-[60ch] text-small text-ink-2">
            Registro inmutable. Centinela no mueve dinero: deja la decisión y su porqué.
          </p>
          <DetailActions record={record} variant="footer" />
        </footer>
      </div>
    </DetailProvider>
  );
}
