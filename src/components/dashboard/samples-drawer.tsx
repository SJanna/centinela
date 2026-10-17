"use client";

/**
 * "Probar con ejemplos": facturas del dataset agrupadas por escenario, con su decisión esperada.
 * Se reproduce un escenario completo o se sube un ejemplo suelto.
 */
import { ChevronDown, FileImage, FileText, Mail, MessageSquare, Play } from "lucide-react";
import { useState } from "react";
import { OUTCOME_LABEL } from "@/core/checks";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Skeleton } from "@/components/ui/skeleton";
import { DecisionChip, StatusDot } from "@/components/ui/status";
import { Mono } from "@/components/ui/typography";
import { PLAYABLE_SCENARIOS, SCENARIO_LABEL, SCENARIO_NOTE } from "./format";
import { Drawer } from "./overlay";
import type { Sample, SampleResult } from "./types";

const FORMAT_ICON = { pdf: FileText, png: FileImage, jpg: FileImage, jpeg: FileImage, eml: Mail, txt: MessageSquare } as const;

const FORMAT_LABEL: Record<string, string> = {
  pdf: "PDF",
  png: "Imagen",
  jpg: "Foto",
  jpeg: "Foto",
  eml: "Correo",
  txt: "Chat",
};

/** Escenarios en el orden en que aparecen en el dataset. */
function groupByScenario(samples: Sample[]): { scenario: string; samples: Sample[] }[] {
  const groups = new Map<string, Sample[]>();
  for (const s of samples) {
    const list = groups.get(s.escenario) ?? [];
    list.push(s);
    groups.set(s.escenario, list);
  }
  const order = (id: string) => (PLAYABLE_SCENARIOS.has(id) ? 0 : 1);
  return [...groups.entries()]
    .map(([scenario, list]) => ({ scenario, samples: list }))
    .sort((a, b) => order(a.scenario) - order(b.scenario));
}

function ResultLine({ sample, result, pending }: { sample: Sample; result: SampleResult | undefined; pending: boolean }) {
  if (pending) {
    return (
      <p className="mt-1.5">
        <DecisionChip status="PROCESANDO" />
      </p>
    );
  }
  if (!result) return null;
  if (result.kind === "error") {
    return <p className="mt-1.5 text-caption text-hold">No se pudo revisar: {result.error}</p>;
  }
  return (
    <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption">
      <DecisionChip status={result.outcome} />
      {result.repeated ? (
        <span className="text-ink-2">Ya estaba revisado: se frena por duplicado.</span>
      ) : result.matches ? (
        <span className="font-medium text-pay">Coincide con lo esperado.</span>
      ) : (
        <span className="font-medium text-hold">No coincide: se esperaba {OUTCOME_LABEL[sample.decision_esperada]}.</span>
      )}
    </p>
  );
}

function SampleRow({
  sample,
  playable,
  result,
  pending,
  onUpload,
}: {
  sample: Sample;
  playable: boolean;
  result: SampleResult | undefined;
  pending: boolean;
  onUpload: (sample: Sample) => void;
}) {
  const Icon = FORMAT_ICON[sample.formato as keyof typeof FORMAT_ICON] ?? FileText;
  return (
    <li className="flex items-start gap-3 py-3">
      <Mono className="w-8 shrink-0 pt-px text-caption text-ink-3">{sample.caseId}</Mono>
      <div className="min-w-0 flex-1">
        <p className={cn("text-small", playable ? "text-ink" : "text-ink-2")}>{sample.descripcion}</p>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-ink-3">
          <span className="inline-flex items-center gap-1">
            <Icon aria-hidden size={12} strokeWidth={1.5} />
            {FORMAT_LABEL[sample.formato] ?? sample.formato.toUpperCase()}
          </span>
          <span aria-hidden className="text-faint">
            ·
          </span>
          <span className="inline-flex items-center gap-1.5">
            Se espera
            <StatusDot status={sample.decision_esperada} size={6} />
            <span className="text-ink-2">{OUTCOME_LABEL[sample.decision_esperada]}</span>
          </span>
        </p>
        <ResultLine sample={sample} result={result} pending={pending} />
      </div>
      <Button
        size="sm"
        variant="secondary"
        className="h-7 px-3"
        disabled={!playable || pending}
        onClick={() => onUpload(sample)}
        aria-label={`Subir el ejemplo ${sample.caseId}`}
      >
        Subir
      </Button>
    </li>
  );
}

function ScenarioGroup({
  scenario,
  samples,
  results,
  pendingIds,
  busy,
  defaultOpen,
  onPlay,
  onUpload,
}: {
  scenario: string;
  samples: Sample[];
  results: Record<string, SampleResult>;
  pendingIds: ReadonlySet<string>;
  busy: boolean;
  defaultOpen: boolean;
  onPlay: (scenario: string, samples: Sample[]) => void;
  onUpload: (sample: Sample) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const playable = PLAYABLE_SCENARIOS.has(scenario);
  const label = SCENARIO_LABEL[scenario] ?? scenario;
  const listId = `ejemplos-${scenario}`;
  // Los que ya estaban revisados (duplicados del mismo archivo) no cuentan para la comparación.
  const decided = samples.filter((s) => {
    const r = results[s.caseId];
    return r?.kind === "decided" && !r.repeated;
  });
  const matched = decided.filter((s) => {
    const r = results[s.caseId];
    return r?.kind === "decided" && r.matches;
  });
  const n = samples.length;

  return (
    <section className="border-b border-line py-5 last:border-b-0">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className={cn("text-h3", playable ? "text-navy" : "text-ink-2")}>
            {label} <span className="tnum font-normal text-ink-3">· {n}</span>
          </h3>
          {SCENARIO_NOTE[scenario] ? <p className="mt-0.5 text-small text-ink-2">{SCENARIO_NOTE[scenario]}</p> : null}
          {decided.length > 0 ? (
            <p className="tnum mt-1 text-caption text-ink-2">
              {matched.length} de {decided.length} {matched.length === 1 ? "coincide" : "coinciden"} con lo esperado.
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button
          size="sm"
          variant={scenario === "base" ? "primary" : "secondary"}
          icon={<Play />}
          disabled={!playable || busy}
          onClick={() => onPlay(scenario, samples)}
        >
          Reproducir {label.charAt(0).toLowerCase() + label.slice(1)} ({n} {n === 1 ? "factura" : "facturas"})
        </Button>
        {!playable ? <p className="text-caption text-muted">Se prueba en el banco de pruebas (npm run eval).</p> : null}
      </div>

      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
        className="mt-3 inline-flex items-center gap-1 rounded-pill text-caption font-medium text-ink-2 transition-colors duration-150 hover:text-navy"
      >
        {open ? "Ocultar las facturas" : `Ver las ${n} facturas`}
        <ChevronDown
          aria-hidden
          size={14}
          strokeWidth={1.75}
          className={cn("transition-transform duration-150", open && "rotate-180")}
        />
      </button>

      {open ? (
        <ul id={listId} className="mt-1 divide-y divide-seam">
          {samples.map((s) => (
            <SampleRow
              key={s.caseId}
              sample={s}
              playable={playable}
              result={results[s.caseId]}
              pending={pendingIds.has(s.caseId)}
              onUpload={onUpload}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

interface SamplesDrawerProps {
  open: boolean;
  onClose: () => void;
  samples: Sample[] | null;
  loadError: string | null;
  onRetry: () => void;
  results: Record<string, SampleResult>;
  /** Ejemplos en la cola (en espera o en revisión). */
  pendingIds: ReadonlySet<string>;
  /** Hay facturas en revisión: no se puede reiniciar ni reproducir. */
  busy: boolean;
  onPlay: (scenario: string, samples: Sample[]) => void;
  onUpload: (sample: Sample) => void;
}

export function SamplesDrawer({
  open,
  onClose,
  samples,
  loadError,
  onRetry,
  results,
  pendingIds,
  busy,
  onPlay,
  onUpload,
}: SamplesDrawerProps) {
  const groups = samples ? groupByScenario(samples) : [];
  return (
    <Drawer
      open={open}
      onClose={onClose}
      eyebrow="Facturas de ejemplo"
      title="Probar con ejemplos."
      description="Facturas de prueba. Cada una trae la decisión que una persona fijó como correcta. Al subirla, se compara con la de Centinela."
    >
      {loadError ? (
        <div className="py-8 text-small text-ink-2">
          <p className="text-hold">{loadError}</p>
          <Button size="sm" variant="secondary" className="mt-3" onClick={onRetry}>
            Reintentar
          </Button>
        </div>
      ) : !samples ? (
        <div className="space-y-5 py-6" aria-label="Cargando ejemplos">
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-2.5">
              <Skeleton shape="text" className="w-40" />
              <Skeleton shape="text" className="w-72" />
              <Skeleton shape="pill" className="h-8 w-64" />
            </div>
          ))}
        </div>
      ) : (
        groups.map((g) => (
          <ScenarioGroup
            key={g.scenario}
            scenario={g.scenario}
            samples={g.samples}
            results={results}
            pendingIds={pendingIds}
            busy={busy}
            defaultOpen={g.scenario === "base"}
            onPlay={onPlay}
            onUpload={onUpload}
          />
        ))
      )}
    </Drawer>
  );
}
