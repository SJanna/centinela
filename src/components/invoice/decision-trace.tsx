"use client";

import { Check, ChevronDown, Copy } from "lucide-react";
import { useMemo, useState } from "react";
import { cn, DECISION_LABEL } from "@/components/ui";
import type { DecisionRecord, Outcome } from "@/core/schemas";
import { buildTrace, traceToText, type TraceTone } from "./trace";

/** Colores sobre noche: los mismos estados, aclarados para leerse en el panel oscuro. */
const TONE_CLASS: Record<TraceTone, string> = {
  ok: "text-[#6fd8b4]",
  warn: "text-[#f3b46a]",
  bad: "text-[#ff8f99]",
  muted: "text-night-muted",
};

const OUTCOME_CLASS: Record<Outcome, string> = {
  PAGAR: "bg-[#00a87e]/18 text-[#6fd8b4] ring-[#00a87e]/35",
  FRENAR: "bg-[#e23b4a]/18 text-[#ff8f99] ring-[#e23b4a]/35",
  ESCALAR: "bg-[#ec7e01]/18 text-[#f3b46a] ring-[#ec7e01]/35",
};

export function DecisionTrace({ record }: { record: DecisionRecord }) {
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  const steps = useMemo(() => buildTrace(record), [record]);
  const outcome = record.decision.outcome;

  async function copy() {
    try {
      await navigator.clipboard.writeText(traceToText(record, steps));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Sin permiso de portapapeles: no pasa nada, la traza sigue a la vista.
    }
  }

  return (
    <section aria-labelledby="traza-titulo" className="glass-night overflow-hidden rounded-panel">
      <div className="flex items-center justify-between gap-3 px-5 py-4">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="traza-contenido"
          className="group flex min-w-0 flex-1 items-center gap-3 rounded-row text-left outline-none focus-visible:ring-2 focus-visible:ring-lavender"
        >
          <ChevronDown
            aria-hidden
            size={16}
            strokeWidth={1.75}
            className={cn("shrink-0 text-night-muted transition-transform duration-180 ease-out", !open && "-rotate-90")}
          />
          <span className="min-w-0">
            <span id="traza-titulo" className="block text-caption font-medium tracking-[0.1em] text-night-muted uppercase">
              Traza de la decisión
            </span>
            <span className="block text-small text-night-text">
              {steps.length} pasos fijos. Ningún texto de esta traza lo escribió un modelo.
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={copy}
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-pill px-2.5 text-caption font-medium text-night-muted ring-1 ring-[#b7c3d3]/20 transition-colors duration-150 ring-inset hover:bg-white/5 hover:text-night-text"
        >
          {copied ? <Check aria-hidden size={13} strokeWidth={2} /> : <Copy aria-hidden size={13} strokeWidth={1.75} />}
          {copied ? "Copiada" : "Copiar"}
        </button>
      </div>

      <div
        id="traza-contenido"
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="min-h-0 overflow-hidden" inert={!open}>
          <ol className="space-y-3 border-t border-[#b7c3d3]/15 px-5 pt-4 pb-5 font-mono text-[12.5px] leading-[1.6] text-night-text">
            {steps.map((step) => (
              <li key={step.n} className="grid grid-cols-[22px_minmax(0,1fr)] gap-x-2">
                <span className="text-night-muted">{step.n}</span>
                <div className="min-w-0">
                  <p className="break-words">
                    <span className="text-white">{step.label}</span>
                    <span className="text-night-muted"> · </span>
                    {step.head.map((line, i) => (
                      <span key={i} className={line.tone ? TONE_CLASS[line.tone] : undefined}>
                        {line.text}
                      </span>
                    ))}
                  </p>
                  {step.details.length > 0 ? (
                    <ul className="mt-0.5 space-y-0.5">
                      {step.details.map((d, i) => (
                        <li key={i} className={cn("flex gap-2 break-words", d.tone ? TONE_CLASS[d.tone] : "text-night-text")}>
                          <span aria-hidden className="text-night-muted/60">
                            └
                          </span>
                          <span className="min-w-0">{d.text}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </li>
            ))}
            <li className="grid grid-cols-[22px_minmax(0,1fr)] gap-x-2 border-t border-[#b7c3d3]/15 pt-3">
              <span className="text-night-muted">=</span>
              <p>
                <span
                  className={cn(
                    "inline-flex items-center rounded-pill px-2 py-px font-sans text-caption font-medium ring-1 ring-inset",
                    OUTCOME_CLASS[outcome],
                  )}
                >
                  {outcome} · {DECISION_LABEL[outcome]}
                </span>
                {record.decision.guardOverride ? <span className="ml-2 text-night-muted">bajada por la guardia</span> : null}
              </p>
            </li>
          </ol>
        </div>
      </div>
    </section>
  );
}
