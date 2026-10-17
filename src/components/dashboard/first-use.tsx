"use client";

/**
 * Primer uso (sin decisiones): "Tu agente paga. Tú decides." con la cinta y tres pasos.
 */
import { FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Card } from "@/components/ui/sheet";
import { Mono } from "@/components/ui/typography";
import { SIMULATED_NOTE } from "./intake";

const STEPS = [
  { n: "01", title: "Lee.", body: "Dos lecturas independientes de cada factura: PDF, foto, correo o chat." },
  {
    n: "02",
    title: "Comprueba.",
    body: "15 comprobaciones fijas, escritas en código: lectura, duplicados, proveedor, acuerdo, límites y fondo.",
  },
  {
    n: "03",
    title: "Decide.",
    body: "Pagar, frenar o escalar a una persona, con su porqué. Una guardia independiente confirma cada pago.",
  },
] as const;

interface FirstUseProps {
  simulated: boolean;
  onTryExamples: () => void;
  onUpload: () => void;
}

export function FirstUse({ simulated, onTryExamples, onUpload }: FirstUseProps) {
  return (
    <div className="space-y-6">
      <EmptyState
        variant="first-use"
        headingLevel={1}
        // Bajo 1280 px la cinta se corre a la derecha: si no, sus líneas cruzan por detrás del texto.
        className="max-xl:[&>div[aria-hidden]]:w-[52%]"
        eyebrow="Agente de pagos"
        description="Centinela lee las facturas de tus proveedores y decide, con las reglas de tu empresa, si se pagan, se frenan o las revisa una persona. No mueve dinero."
        action={
          <>
            <Button arrow="next" onClick={onTryExamples}>
              Probar con ejemplos
            </Button>
            <Button variant="ghost" arrow="external" onClick={onUpload}>
              Subir facturas
            </Button>
          </>
        }
      >
        {simulated ? (
          <p className="flex max-w-[46ch] gap-2 pt-2 text-caption text-muted">
            <FlaskConical aria-hidden size={14} strokeWidth={1.5} className="mt-px shrink-0 text-ink-3" />
            <span>{SIMULATED_NOTE}</span>
          </p>
        ) : null}
      </EmptyState>
      <ol className="grid gap-4 md:grid-cols-3">
        {STEPS.map((step) => (
          <Card as="li" key={step.n} padding="md" className="space-y-2">
            <Mono className="block text-caption text-ink-3">{step.n}</Mono>
            <p className="text-h3 text-navy">{step.title}</p>
            <p className="text-small text-ink-2">{step.body}</p>
          </Card>
        ))}
      </ol>
    </div>
  );
}
