"use client";

import { TriangleAlert } from "lucide-react";
import { useDetail } from "./detail-context";

/** Barra fina roja arriba del detalle cuando el documento trae texto que intenta dar órdenes. */
export function SuspiciousBar({ count }: { count: number }) {
  const { showExtractedText } = useDetail();
  return (
    <div
      role="status"
      className="mb-6 flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1 rounded-row bg-suspicious-solid px-4 py-1.5 text-small text-white shadow-[0_1px_2px_#8a1c2433]"
    >
      <TriangleAlert aria-hidden size={15} strokeWidth={2} className="shrink-0" />
      <p className="min-w-0 flex-1 font-medium">
        Instrucción sospechosa detectada. Centinela no la siguió.
        {count > 1 ? <span className="font-normal text-white/80"> {count} fragmentos.</span> : null}
      </p>
      <button
        type="button"
        onClick={showExtractedText}
        className="shrink-0 rounded-pill px-2 py-0.5 text-caption font-medium text-white/90 underline decoration-white/40 underline-offset-2 transition-colors duration-150 hover:bg-white/10 hover:text-white"
      >
        Ver el texto →
      </button>
    </div>
  );
}
