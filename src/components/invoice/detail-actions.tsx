"use client";

import { Download, FileJson } from "lucide-react";
import { Button, useToast } from "@/components/ui";
import type { DecisionRecord } from "@/core/schemas";
import { safeFilename } from "./format";

/** Descarga el registro completo de la decisión, tal como está guardado, sin pasar por el servidor. */
function downloadRecord(record: DecisionRecord): void {
  const blob = new Blob([`${JSON.stringify(record, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `centinela-${safeFilename(record.id)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

interface DetailActionsProps {
  record: DecisionRecord;
  /** "header": dos botones compactos · "footer": los tres, con "Volver al resumen". */
  variant?: "header" | "footer";
}

export function DetailActions({ record, variant = "header" }: DetailActionsProps) {
  const { toast } = useToast();
  const fileUrl = `/api/invoices/${encodeURIComponent(record.invoiceId)}/file`;
  const size = variant === "header" ? "sm" : "md";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button href={fileUrl} external download={record.filename} variant="secondary" size={size} icon={<Download />}>
        Descargar archivo
      </Button>
      <Button
        variant="secondary"
        size={size}
        icon={<FileJson />}
        onClick={() => {
          downloadRecord(record);
          toast({ title: "Decisión exportada.", description: `centinela-${safeFilename(record.id)}.json` });
        }}
      >
        Exportar decisión (JSON)
      </Button>
      {variant === "footer" ? (
        <Button href="/" variant="ghost" size={size} arrow="next">
          Volver al resumen
        </Button>
      ) : null}
    </div>
  );
}
