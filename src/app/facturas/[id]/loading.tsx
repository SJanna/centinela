import { Sheet, Skeleton, SkeletonText } from "@/components/ui";

/** Esqueleto del detalle mientras llega la decisión: misma estructura, sin saltos al cargar. */
export default function Loading() {
  return (
    <div className="@container" role="status" aria-live="polite">
      <span className="sr-only">Cargando la decisión.</span>
      <div className="flex items-center justify-between gap-6">
        <Skeleton shape="text" className="w-56" />
        <div className="flex gap-2">
          <Skeleton shape="pill" className="h-8 w-40" />
          <Skeleton shape="pill" className="h-8 w-48" />
        </div>
      </div>
      <div className="mt-6 flex flex-wrap items-end justify-between gap-6">
        <div className="space-y-4">
          <Skeleton shape="pill" className="h-8 w-28" />
          <div className="flex items-center gap-4">
            <Skeleton className="size-10" />
            <div className="space-y-2">
              <Skeleton className="h-8 w-80" />
              <Skeleton shape="text" className="w-48" />
            </div>
          </div>
        </div>
        <div className="space-y-2">
          <Skeleton shape="text" className="ml-auto w-28" />
          <Skeleton className="h-9 w-52" />
        </div>
      </div>
      <Sheet className="mt-6 space-y-4">
        <Skeleton shape="text" className="w-16" />
        <Skeleton className="h-6 w-4/5" />
        <SkeletonText lines={3} className="max-w-[560px]" />
      </Sheet>
      <div className="mt-8 flex flex-col gap-6 @4xl:grid @4xl:grid-cols-[minmax(0,55fr)_minmax(0,45fr)]">
        <Sheet padding="none" className="overflow-hidden">
          <div className="border-b border-seam px-5 py-4">
            <Skeleton shape="text" className="w-40" />
          </div>
          <div className="studio grid h-[min(76vh,780px)] min-h-[480px] place-items-center p-6">
            <div className="aspect-[1/1.414] h-full max-w-full rounded-[6px] bg-white p-8 shadow-receipt">
              <Skeleton className="mb-8 h-12 w-full" />
              <SkeletonText lines={9} />
            </div>
          </div>
        </Sheet>
        <Sheet className="space-y-5">
          <Skeleton className="h-6 w-48" />
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex gap-3">
              <Skeleton shape="pill" className="size-5 shrink-0" />
              <SkeletonText lines={2} className="flex-1" />
            </div>
          ))}
        </Sheet>
      </div>
    </div>
  );
}
