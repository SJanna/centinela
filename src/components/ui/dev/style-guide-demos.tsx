"use client";

/**
 * Demostraciones interactivas para la guía de estilo (/dev/ui). No las uses en la app.
 */
import { RotateCcw } from "lucide-react";
import { useState } from "react";
import { CHECK_CATALOG } from "@/core/checks";
import { Button } from "../button";
import { CheckIcon, checkIconStatus } from "../check-icon";
import { DropZone } from "../drop-zone";
import { formatMoneyText } from "../money";
import { useToast } from "../toast";
import { Mono } from "../typography";

export function ToastDemo() {
  const { toast } = useToast();
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        size="sm"
        variant="secondary"
        onClick={() =>
          toast({
            tone: "PAGAR",
            title: "Pagada.",
            description: `${formatMoneyText(1200, "USD")} a CloudMetrics Inc. Las 15 comprobaciones pasaron.`,
            action: { label: "Ver decisión →", href: "/registro" },
          })
        }
      >
        Aviso de pago
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={() =>
          toast({
            tone: "FRENAR",
            title: "Frenada.",
            description: "Testa Qualidade Ltda ya cobró la factura NF-2026-0917 este mes.",
          })
        }
      >
        Aviso de freno
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={() =>
          toast({
            tone: "ESCALAR",
            title: "Escalada.",
            description: "Pendiente de una persona: el monto supera el umbral de aprobación.",
          })
        }
      >
        Aviso de escalamiento
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() =>
          toast({ tone: "ERROR", title: "No se pudo leer el archivo.", description: "El PDF está protegido con contraseña." })
        }
      >
        Error
      </Button>
    </div>
  );
}

export function DropZoneDemo() {
  const { toast } = useToast();
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-2">
        <p className="eyebrow">Normal</p>
        <DropZone
          onFiles={(files) =>
            toast({
              tone: "PROCESANDO",
              title: files.length === 1 ? "1 archivo listo." : `${files.length} archivos listos.`,
              description: files.map((f) => f.name).join(", "),
            })
          }
        />
      </div>
      <div className="space-y-2">
        <p className="eyebrow">Arrastrando</p>
        <DropZone forceDragging onFiles={() => undefined} />
      </div>
      <div className="space-y-2">
        <p className="eyebrow">Deshabilitada</p>
        <DropZone disabled disabledHint="Revisando una factura. Espera a que termine." onFiles={() => undefined} />
      </div>
    </div>
  );
}

/** Explicaciones de ejemplo, con el estilo de las plantillas del motor. */
const SAMPLE: Record<string, { status: "pass" | "fail" | "not_evaluable"; explanation: string }> = {
  "LEC-1": { status: "pass", explanation: "Proveedor, número, moneda, total y cuenta destino se leen con claridad." },
  "LEC-2": { status: "pass", explanation: "Lecturas: 2 de 2 coinciden en los 5 datos críticos." },
  "LEC-3": { status: "pass", explanation: "132 h × 900,00 MXN = 118.800,00 MXN, igual al total." },
  "LEC-4": { status: "pass", explanation: "No hay texto que intente dar órdenes." },
  "DUP-1": { status: "pass", explanation: "Archivo nuevo: no coincide con ninguno anterior." },
  "DUP-2": { status: "pass", explanation: "No hay otra factura NOP-0311 de Estudio Nopal." },
  "DUP-3": { status: "pass", explanation: "Octubre de 2026 no se ha pagado en este acuerdo." },
  "PRV-1": { status: "pass", explanation: "Estudio Nopal S. de R.L. está en la ficha de proveedores." },
  "PRV-2": { status: "pass", explanation: "La cuenta •••• 7891 es la registrada." },
  "ACU-1": { status: "pass", explanation: "Acuerdo vigente desde el 1 de enero de 2026." },
  "ACU-2": { status: "pass", explanation: "La factura viene en MXN, como el acuerdo." },
  "ACU-3": { status: "fail", explanation: "Factura 132 h; el acuerdo permite hasta 120 h al mes." },
  "LIM-1": { status: "fail", explanation: "6.534,00 USD supera el umbral de aprobación de 5.000,00 USD." },
  "LIM-2": { status: "pass", explanation: "Con este pago, el mes queda en 19.120,00 de 25.000,00 USD." },
  "FON-1": { status: "pass", explanation: "Fondo disponible: 21.580,00 USD." },
};

export function CheckListDemo() {
  const [run, setRun] = useState(0);
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-4">
        <p className="text-small text-ink-2">
          Factura NOP-0311 de Estudio Nopal. Dos comprobaciones piden a una persona.
        </p>
        <Button size="sm" variant="ghost" icon={<RotateCcw />} onClick={() => setRun((n) => n + 1)}>
          Repetir
        </Button>
      </div>
      <ol key={run} className="divide-y divide-seam rounded-card border border-seam bg-surface-0">
        {CHECK_CATALOG.map((check, i) => {
          const sample = SAMPLE[check.code];
          const icon = checkIconStatus(sample.status, check.outcomeIfFail);
          return (
            <li key={check.code} className="flex items-start gap-3 px-4 py-3">
              <CheckIcon status={icon} delay={i * 0.12} className="mt-px" />
              <div className="min-w-0 flex-1">
                <p className="text-body font-medium text-navy">{check.title}</p>
                <p className="text-small text-ink-2">{sample.explanation}</p>
              </div>
              <Mono className="pt-0.5 text-caption text-ink-3">{check.code}</Mono>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
