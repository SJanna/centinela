import { cn } from "./cn";

interface SkeletonProps {
  className?: string;
  /** "row" (radio 12, por defecto), "pill" o "text" (línea de 10px). */
  shape?: "row" | "pill" | "text";
}

const SHAPE = {
  row: "rounded-row",
  pill: "rounded-pill",
  text: "h-2.5 rounded-pill",
} as const;

/** Bloque de carga con un brillo lento. Se queda quieto con prefers-reduced-motion. */
export function Skeleton({ className, shape = "row" }: SkeletonProps) {
  return (
    <span
      aria-hidden
      className={cn(
        "block animate-shimmer bg-[linear-gradient(90deg,var(--color-surface-2)_0%,var(--color-surface-2)_35%,#f7f8fa_50%,var(--color-surface-2)_65%,var(--color-surface-2)_100%)] bg-size-[200%_100%]",
        SHAPE[shape],
        className,
      )}
    />
  );
}

/** Varias líneas de texto en carga; la última más corta. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <span aria-hidden className={cn("flex flex-col gap-2", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} shape="text" className={i === lines - 1 ? "w-3/5" : "w-full"} />
      ))}
    </span>
  );
}
