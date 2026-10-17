"use client";

import { useEffect } from "react";
import { Button, Card, EmptyState } from "@/components/ui";

/** Falla al leer la decisión (base no disponible, registro dañado). Next 16: la prop es `retry`. */
export default function InvoiceError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Card padding="none" className="mx-auto mt-6 max-w-[720px]">
      <EmptyState
        headingLevel={1}
        title="No se pudo abrir esta decisión."
        description="La decisión sigue guardada. Puede ser un corte momentáneo de la base de datos."
        action={
          <>
            <Button onClick={() => retry()} arrow="next">
              Reintentar
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
