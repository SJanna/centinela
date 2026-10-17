import { Button, Card, EmptyState } from "@/components/ui";

export default function InvoiceNotFound() {
  return (
    <Card padding="none" className="mx-auto mt-6 max-w-[720px]">
      <EmptyState
        headingLevel={1}
        title="No encontramos esa decisión."
        description="El enlace puede estar incompleto o la demo se reinició. Las decisiones no se borran una por una."
        action={
          <>
            <Button href="/" arrow="next">
              Volver al resumen
            </Button>
            <Button href="/registro" variant="ghost">
              Ver el registro
            </Button>
          </>
        }
      />
    </Card>
  );
}
