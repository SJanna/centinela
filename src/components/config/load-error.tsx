import { Card } from "@/components/ui/sheet";
import { EmptyState } from "@/components/ui/empty-state";

/** Estado de error cuando la base no responde. Recargar es el único paso útil. */
export function LoadError({ what }: { what: string }) {
  return (
    <Card padding="none">
      <EmptyState
        title={`No se pudieron leer ${what}.`}
        description="La base de datos no respondió. Recarga la página; si sigue igual, revisa el registro del servidor."
      />
    </Card>
  );
}
