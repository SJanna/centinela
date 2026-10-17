import { FlaskConical, ScanText } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { Tooltip } from "@/components/ui/tooltip";
import type { ReadingMode } from "./config";

const READING_COPY: Record<ReadingMode, { label: string; help: string }> = {
  live: {
    label: "Lectura real",
    help: "Dos modelos leen cada factura por separado. Si no coinciden en un dato crítico, la factura se escala. Decidir lo hacen las reglas, no el modelo.",
  },
  simulated: {
    label: "Lectura simulada",
    help: "No hay clave de API. Las facturas de ejemplo usan una lectura de referencia: sirve para probar las reglas, no mide la calidad de lectura. Un archivo nuevo se escala.",
  },
};

/** Chip del modo de lectura, con explicación al pasar el cursor. Bajo 768px queda solo el icono. */
export function ReadingModeChip({ mode }: { mode: ReadingMode }) {
  const copy = READING_COPY[mode];
  const Icon = mode === "live" ? ScanText : FlaskConical;
  return (
    <Tooltip content={copy.help} side="bottom" align="end" maxWidth={280}>
      <span
        tabIndex={0}
        className={cn(
          "inline-flex h-7 cursor-help items-center gap-1.5 rounded-pill px-2.5 text-caption font-medium whitespace-nowrap text-ink-2",
          "max-md:w-7 max-md:justify-center max-md:px-0",
          mode === "live"
            ? "bg-surface-0/80 ring-1 ring-seam ring-inset"
            : "border border-dashed border-faint bg-transparent",
        )}
      >
        <Icon aria-hidden size={13} strokeWidth={1.5} className="shrink-0 text-ink-3" />
        <span className="max-md:sr-only">{copy.label}</span>
      </span>
    </Tooltip>
  );
}

/** Chip lima "Agente IA" con un punto que respira. Uno de los dos usos del lima. Bajo 768px queda solo el punto. */
export function AgentChip() {
  return (
    <Tooltip
      content="El modelo solo lee la factura. La decisión la toman 15 comprobaciones fijas, siempre las mismas."
      side="bottom"
      align="end"
    >
      <span
        tabIndex={0}
        className="inline-flex h-7 cursor-help items-center gap-2 rounded-pill bg-lime pr-3 pl-2.5 text-caption font-medium whitespace-nowrap text-night ring-1 ring-lime-edge ring-inset max-md:w-7 max-md:justify-center max-md:px-0"
      >
        <span aria-hidden className="relative inline-flex size-1.5">
          <span className="absolute -inset-[3px] animate-breathe rounded-full bg-[#5d7f16]/25" />
          <span className="relative inline-block size-1.5 rounded-full bg-[#4a6a0f]" />
        </span>
        <span className="max-md:sr-only">Agente IA</span>
      </span>
    </Tooltip>
  );
}
