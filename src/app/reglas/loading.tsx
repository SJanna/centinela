import { Card, Sheet } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";

/** Carga de /reglas: cabecera, las cuatro frases y la tabla de tasas. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Cargando las reglas.</span>
      <div className="mb-8 space-y-3">
        <Skeleton shape="text" className="w-28" />
        <Skeleton className="h-8 w-72" />
        <Skeleton shape="text" className="w-96 max-w-full" />
      </div>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Sheet padding="none">
          <div className="space-y-2 px-6 pt-6 pb-4">
            <Skeleton shape="text" className="w-32" />
            <Skeleton className="h-5 w-56" />
          </div>
          <ul className="divide-y divide-seam border-t border-seam">
            {[0, 1, 2, 3].map((i) => (
              <li key={i} className="flex items-start gap-4 px-6 py-5">
                <Skeleton shape="text" className="mt-2 w-5" />
                <div className="flex-1 space-y-2.5">
                  <Skeleton className="h-7 w-[min(440px,90%)]" />
                  <Skeleton shape="text" className="w-64 max-w-full" />
                </div>
              </li>
            ))}
          </ul>
        </Sheet>
        <Card padding="none">
          <div className="space-y-2 px-5 pt-5 pb-4">
            <Skeleton shape="text" className="w-28" />
            <Skeleton className="h-4 w-52" />
          </div>
          <ul className="divide-y divide-seam border-t border-seam">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <li key={i} className="flex items-center gap-3 px-5 py-3">
                <Skeleton className="size-5 rounded-full" />
                <Skeleton shape="text" className="w-24" />
                <Skeleton className="ml-auto h-8 w-24" />
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
