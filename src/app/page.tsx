// Marcador provisional del resumen. Otro módulo lo reemplaza con los KPIs y el tablero de facturas.
import { Button, Card, EmptyState, Mono } from "@/components/ui";

const STEPS = [
  { n: "01", title: "Lee.", body: "Dos lecturas independientes de cada factura: PDF, foto, correo o chat." },
  { n: "02", title: "Comprueba.", body: "15 comprobaciones fijas: lectura, duplicados, proveedor, acuerdo, límites y fondo." },
  { n: "03", title: "Decide.", body: "Pagar, frenar o escalar a una persona. Cada decisión queda con su porqué." },
] as const;

export default function HomePage() {
  return (
    <div className="space-y-6">
      <EmptyState
        variant="first-use"
        headingLevel={1}
        eyebrow="Agente de pagos"
        description="Centinela lee las facturas de tus proveedores y decide, con las reglas de tu empresa, si se pagan, se frenan o las revisa una persona. No mueve dinero."
        action={
          <>
            <Button href="/reglas" arrow="next">
              Revisar las reglas
            </Button>
            <Button href="/proveedores" variant="ghost">
              Ver proveedores
            </Button>
          </>
        }
      />
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
