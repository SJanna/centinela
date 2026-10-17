import { Card } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";

/** Carga de una página con cabecera y tabla (registro, proveedores). */
export function TableSkeleton({ rows = 8, label }: { rows?: number; label: string }) {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      <div className="mb-8 space-y-3">
        <Skeleton shape="text" className="w-28" />
        <Skeleton className="h-8 w-72" />
        <Skeleton shape="text" className="w-96 max-w-full" />
      </div>
      <div className="mb-4 flex items-center justify-between gap-4">
        <Skeleton shape="pill" className="h-10 w-80 max-w-full" />
        <Skeleton shape="pill" className="h-10 w-64" />
      </div>
      <Card padding="none">
        <ul className="divide-y divide-seam">
          {Array.from({ length: rows }, (_, i) => (
            <li key={i} className="flex h-16 items-center gap-4 px-5">
              <Skeleton className="size-5 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton shape="text" className="w-48" />
                <Skeleton shape="text" className="w-24" />
              </div>
              <Skeleton shape="text" className="w-24" />
              <Skeleton shape="pill" className="h-6 w-20" />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
