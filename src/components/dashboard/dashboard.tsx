"use client";

/**
 * Resumen ("/"): indicadores, subida de facturas de a una, tablero de decisiones y ejemplos del dataset.
 * Recibe los datos iniciales del servidor y después se actualiza con la API (docs/API.md).
 */
import { LayoutGroup, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { OUTCOME_LABEL } from "@/core/checks";
import { ACCEPT_ATTRIBUTE, formatBytes } from "@/ingest/limits";
import { HeaderActions } from "@/components/shell/header-slots";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { useToast } from "@/components/ui/toast";
import { Eyebrow } from "@/components/ui/typography";
import { fetchSampleFile, fetchSamples, fetchStats, resetDemo, uploadInvoice } from "./api";
import { Board, ViewToggle } from "./board";
import { FirstUse } from "./first-use";
import { decisionToast, monthLabel, SCENARIO_LABEL, vendorCountriesOf } from "./format";
import { Intake } from "./intake";
import { KpiBand } from "./kpi-band";
import { ConfirmDialog } from "./overlay";
import { SamplesDrawer } from "./samples-drawer";
import type {
  BoardItem,
  DecisionSummary,
  Outcome,
  Playback,
  QueueItem,
  QueueSource,
  Sample,
  SampleResult,
  Stats,
  VendorCountries,
  ViewMode,
} from "./types";

/** Tiempo mínimo en revisión: deja ver "Leyendo → Comprobando → Decidiendo" aunque la respuesta llegue antes. */
const MIN_REVIEW_MS = 1150;
/** Pausa entre facturas de un escenario, para que se vea caer cada tarjeta. */
const PLAYBACK_PAUSE_MS = 320;
const MANUAL_PAUSE_MS = 120;
/** En un escenario llega una decisión cada ~1,5 s: avisos cortos para que no tapen las columnas. */
const PLAYBACK_TOAST_MS = 1500;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** Suma una factura revisada a la reproducción en curso. */
function advancePlayback(p: Playback | null, id: string | undefined, sample: Sample | null, got: Outcome | null): Playback | null {
  if (!p || !id || p.id !== id) return p;
  const done = p.done + 1;
  const ok = sample != null && got === sample.decision_esperada;
  return {
    ...p,
    done,
    matches: p.matches + (ok ? 1 : 0),
    mismatches:
      ok || !sample ? p.mismatches : [...p.mismatches, { caseId: sample.caseId, expected: sample.decision_esperada, got }],
    status: p.status === "running" && done >= p.total ? "done" : p.status,
  };
}

type ConfirmState = { kind: "reset" } | { kind: "scenario"; scenario: string; samples: Sample[] };

export interface DashboardProps {
  initialStats: Stats;
  initialDecisions: DecisionSummary[];
  vendorCountries: VendorCountries;
  readingMode: "live" | "simulated";
  /** Hora del servidor al renderizar (ms): base de las horas relativas, igual en servidor y cliente. */
  renderedAt: number;
}

export function Dashboard({ initialStats, initialDecisions, vendorCountries, readingMode, renderedAt }: DashboardProps) {
  const router = useRouter();
  const { toast } = useToast();

  const [stats, setStats] = useState(initialStats);
  const [items, setItems] = useState<BoardItem[]>(() =>
    initialDecisions.map((decision) => ({ decision, layoutKey: decision.id, fresh: false })),
  );
  const [countries, setCountries] = useState(vendorCountries);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [playback, setPlayback] = useState<Playback | null>(null);
  const [view, setView] = useState<ViewMode>("board");
  // Cambia con cada cambio de vista: los layoutId no se reusan entre vistas (ver layoutIdOf).
  const [viewEpoch, setViewEpoch] = useState(0);
  const layoutScope = `${view}${viewEpoch}`;
  const [now, setNow] = useState(renderedAt);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [samples, setSamples] = useState<Sample[] | null>(null);
  const [samplesError, setSamplesError] = useState<string | null>(null);
  const [sampleResults, setSampleResults] = useState<Record<string, SampleResult>>({});

  // El destino se conserva al cerrar, para que el texto no cambie durante la salida del diálogo.
  const [confirm, setConfirm] = useState<ConfirmState>({ kind: "reset" });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const fileInput = useRef<HTMLInputElement>(null);
  const boardGrid = useRef<HTMLDivElement>(null);
  const scrolledFor = useRef<string | null>(null);
  const jobs = useRef<QueueItem[]>([]);
  const pumping = useRef(false);
  const mounted = useRef(false);
  const seq = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Horas relativas: se refrescan cada 20 s.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(id);
  }, []);

  // Al empezar un escenario, el tablero sube a la vista. Desde 1280 px las columnas quedan hacia la mitad
  // de la pantalla: arriba se ven escalado y autonomía, abajo caen las tarjetas, y los avisos (abajo a la
  // derecha) tapan solo las tarjetas viejas. Más estrecho, la entrada queda bajo el header.
  useEffect(() => {
    if (!playback || playback.status !== "running" || scrolledFor.current === playback.id) return;
    const grid = boardGrid.current;
    if (!grid) return;
    scrolledFor.current = playback.id;
    const wide = window.matchMedia("(min-width: 1280px)").matches;
    const offset = wide ? Math.max(96, Math.round(window.innerHeight * 0.42)) : 96;
    const top = grid.getBoundingClientRect().top + window.scrollY - offset;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: Math.max(0, top), behavior: reduce ? "auto" : "smooth" });
  }, [playback]);

  const decisions = useMemo(() => items.map((i) => i.decision), [items]);
  const busy = queue.some((i) => i.status !== "error");
  const pendingIds = useMemo(
    () =>
      new Set(
        queue.flatMap((i) => (i.source.kind === "sample" && i.status !== "error" ? [i.source.sample.caseId] : [])),
      ),
    [queue],
  );
  const simulated = readingMode === "simulated";
  const showFirstUse = items.length === 0 && queue.length === 0 && playback === null;

  // ───────────── Cola: de a una factura, en orden ─────────────

  const land = useCallback(
    (job: QueueItem, decision: DecisionSummary, nextStats: Stats | null) => {
      const sample = job.source.kind === "sample" ? job.source.sample : null;
      const matches = sample ? decision.outcome === sample.decision_esperada : null;
      // Un ejemplo que ya estaba cargado vuelve como duplicado del mismo archivo: es lo correcto, no un fallo.
      const repeated =
        sample != null && matches === false && decision.outcome === "FRENAR" && decision.failedChecks.includes("DUP-1");
      // Fila fuera y tarjeta dentro en el mismo render: comparten layoutId y la tarjeta cae en su columna.
      setQueue((q) => q.filter((i) => i.key !== job.key));
      setItems((list) => [
        { decision, layoutKey: job.key, fresh: true },
        ...list.filter((i) => i.decision.id !== decision.id),
      ]);
      if (nextStats) setStats(nextStats);
      setNow(Date.now());
      if (sample) {
        setSampleResults((r) => ({
          ...r,
          [sample.caseId]: {
            kind: "decided",
            outcome: decision.outcome,
            decisionId: decision.id,
            matches: matches === true,
            repeated,
          },
        }));
      }
      if (job.playbackId) setPlayback((p) => advancePlayback(p, job.playbackId, sample, decision.outcome));

      const t = decisionToast(decision);
      toast({
        tone: decision.outcome,
        title: t.title,
        description: sample ? (
          <>
            {t.description}
            <span className={repeated ? "mt-0.5 block text-ink-2" : matches ? "mt-0.5 block text-pay" : "mt-0.5 block text-hold"}>
              {repeated
                ? "Este archivo ya estaba revisado: se frena por duplicado."
                : matches
                  ? "Coincide con lo esperado."
                  : `No coincide: se esperaba ${OUTCOME_LABEL[sample.decision_esperada]}.`}
            </span>
          </>
        ) : (
          t.description
        ),
        action: { label: "Ver decisión →", href: `/facturas/${encodeURIComponent(decision.id)}` },
        duration: job.playbackId ? PLAYBACK_TOAST_MS : 5000,
      });
    },
    [toast],
  );

  const fail = useCallback((job: QueueItem, message: string) => {
    const sample = job.source.kind === "sample" ? job.source.sample : null;
    setQueue((q) => q.map((i) => (i.key === job.key ? { ...i, status: "error", error: message } : i)));
    if (sample) setSampleResults((r) => ({ ...r, [sample.caseId]: { kind: "error", error: message } }));
    if (job.playbackId) setPlayback((p) => advancePlayback(p, job.playbackId, sample, null));
  }, []);

  const pump = useCallback(async () => {
    if (pumping.current) return;
    pumping.current = true;
    try {
      while (jobs.current.length > 0 && mounted.current) {
        const job = jobs.current.shift()!;
        setQueue((q) => q.map((i) => (i.key === job.key ? { ...i, status: "running" } : i)));
        const started = performance.now();
        let decision: DecisionSummary | null = null;
        let failure = "No se pudo revisar la factura.";
        try {
          const file = job.source.kind === "file" ? job.source.file : await fetchSampleFile(job.source.sample);
          decision = await uploadInvoice(file);
        } catch (err) {
          failure = errorMessage(err, failure);
        }
        const nextStats = decision ? await fetchStats().catch(() => null) : null;
        const wait = MIN_REVIEW_MS - (performance.now() - started);
        if (wait > 0) await sleep(wait);
        if (!mounted.current) break;
        if (decision) land(job, decision, nextStats);
        else fail(job, failure);
        if (jobs.current.length > 0) await sleep(job.playbackId ? PLAYBACK_PAUSE_MS : MANUAL_PAUSE_MS);
      }
    } finally {
      pumping.current = false;
    }
  }, [land, fail]);

  const enqueue = useCallback(
    (entries: { source: QueueSource; playbackId?: string }[]) => {
      if (entries.length === 0) return;
      const created: QueueItem[] = entries.map(({ source, playbackId }) => {
        seq.current += 1;
        return {
          key: `q${Date.now().toString(36)}-${seq.current}`,
          label: source.kind === "file" ? source.file.name || "archivo" : source.sample.filename,
          detail:
            source.kind === "file"
              ? formatBytes(source.file.size)
              : `${source.sample.caseId} · ${source.sample.descripcion}`,
          source,
          status: "waiting",
          playbackId,
        };
      });
      jobs.current.push(...created);
      setQueue((q) => [...q, ...created]);
      void pump();
    },
    [pump],
  );

  const uploadFiles = useCallback(
    (files: File[]) => enqueue(files.map((file) => ({ source: { kind: "file", file } }))),
    [enqueue],
  );

  const uploadSample = useCallback(
    (sample: Sample) => enqueue([{ source: { kind: "sample", sample } }]),
    [enqueue],
  );

  function onPickFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.currentTarget.files ?? []);
    e.currentTarget.value = "";
    if (files.length > 0) uploadFiles(files);
  }

  function openPicker() {
    fileInput.current?.click();
  }

  function dismiss(key: string) {
    setQueue((q) => q.filter((i) => i.key !== key || i.status !== "error"));
  }

  // ───────────── Ejemplos ─────────────

  const loadSamples = useCallback(() => {
    setSamplesError(null);
    fetchSamples()
      .then(setSamples)
      .catch((err: unknown) => setSamplesError(errorMessage(err, "No se pudieron cargar los ejemplos.")));
  }, []);

  function openDrawer() {
    setDrawerOpen(true);
    if (!samples) loadSamples();
  }

  function stopPlayback() {
    const id = playback?.id;
    if (!id) return;
    jobs.current = jobs.current.filter((j) => j.playbackId !== id);
    setQueue((q) => q.filter((i) => !(i.playbackId === id && i.status === "waiting")));
    setPlayback((p) => (p && p.id === id && p.status === "running" ? { ...p, status: "stopped" } : p));
  }

  // ───────────── Reinicio y escenarios ─────────────

  async function resetEverything(): Promise<boolean> {
    let company: Awaited<ReturnType<typeof resetDemo>>;
    try {
      company = await resetDemo();
    } catch (err) {
      toast({ tone: "ERROR", title: "No se pudo reiniciar la demo.", description: errorMessage(err, "Intenta de nuevo.") });
      return false;
    }
    jobs.current = [];
    setCountries(vendorCountriesOf(company.vendors));
    setItems([]);
    setQueue((q) => q.filter((i) => i.status === "running"));
    setSampleResults({});
    return true;
  }

  async function confirmReset() {
    setConfirmBusy(true);
    const ok = await resetEverything();
    if (ok) {
      setPlayback(null);
      const next = await fetchStats().catch(() => null);
      if (next) setStats(next);
      toast({
        tone: "NEUTRAL",
        title: "Demo reiniciada.",
        description: "Sin facturas ni decisiones. La empresa vuelve a sus datos de ejemplo.",
      });
      router.refresh();
    }
    setConfirmBusy(false);
    setConfirmOpen(false);
  }

  function askConfirm(target: ConfirmState) {
    setConfirm(target);
    setConfirmOpen(true);
  }

  async function confirmScenario(scenario: string, list: Sample[]) {
    setConfirmBusy(true);
    const ok = await resetEverything();
    if (!ok) {
      setConfirmBusy(false);
      setConfirmOpen(false);
      return;
    }
    seq.current += 1;
    const id = `pb-${seq.current}`;
    setPlayback({
      id,
      scenario,
      label: SCENARIO_LABEL[scenario] ?? scenario,
      total: list.length,
      done: 0,
      matches: 0,
      mismatches: [],
      status: "running",
    });
    const next = await fetchStats().catch(() => null);
    if (next) setStats(next);
    setConfirmBusy(false);
    setConfirmOpen(false);
    setDrawerOpen(false);
    enqueue(list.map((sample) => ({ source: { kind: "sample", sample }, playbackId: id })));
    router.refresh();
  }

  const confirmCopy =
    confirm.kind === "scenario"
      ? {
          title: `Reproducir el ${(SCENARIO_LABEL[confirm.scenario] ?? confirm.scenario).toLowerCase()}.`,
          description: (
            <>
              Se reinicia la demo: se borran las facturas y decisiones actuales. Después se suben las{" "}
              {confirm.samples.length} facturas en orden, una por una.
            </>
          ),
          confirmLabel: "Reiniciar y reproducir",
          busyLabel: "Reiniciando…",
        }
      : {
          title: "Reiniciar la demo.",
          description: (
            <>Se borran todas las facturas y decisiones, y la empresa vuelve a sus datos de ejemplo. No se puede deshacer.</>
          ),
          confirmLabel: "Reiniciar",
          busyLabel: "Reiniciando…",
        };

  const resetButton = (
    <Button size="sm" variant="ghost" onClick={() => askConfirm({ kind: "reset" })} disabled={busy || confirmBusy}>
      Reiniciar demo
    </Button>
  );
  const examplesButton = (
    <Button size="sm" variant="secondary" onClick={openDrawer}>
      Probar con ejemplos
    </Button>
  );

  return (
    <>
      <HeaderActions>
        {/*
          El header no tiene sitio para las tres en pantallas estrechas: reiniciar y ejemplos van junto al
          tablero bajo 1280 px, y en el móvil se sube desde la zona de arrastre o el primer uso.
        */}
        <span className="hidden xl:contents">{resetButton}</span>
        <span className="hidden xl:contents">{examplesButton}</span>
        <span className="hidden md:contents">
          <Button size="sm" arrow="external" onClick={openPicker}>
            Subir facturas
          </Button>
        </span>
      </HeaderActions>

      <input
        ref={fileInput}
        type="file"
        multiple
        accept={ACCEPT_ATTRIBUTE}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={onPickFiles}
      />

      {showFirstUse ? (
        <motion.div key="primer-uso" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.18 }}>
          <FirstUse simulated={simulated} onTryExamples={openDrawer} onUpload={openPicker} />
        </motion.div>
      ) : (
        <motion.div
          key="resumen"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.18 }}
          className="space-y-10"
        >
          <div className="space-y-6">
            <div className="space-y-1.5">
              <Eyebrow>Resumen · {monthLabel(stats.month)}</Eyebrow>
              <h1 className="text-h1 text-navy">
                {stats.total === 1 ? "1 factura revisada." : `${stats.total} facturas revisadas.`}
              </h1>
            </div>
            <KpiBand stats={stats} decisions={decisions} />
          </div>

          <section aria-labelledby="titulo-facturas">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
              <div className="space-y-1">
                <h2 id="titulo-facturas" className="text-h2 text-navy">
                  Facturas
                </h2>
                <p className="text-small text-ink-2">La más reciente arriba. Abre una para ver por qué se decidió así.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="contents xl:hidden">
                  {resetButton}
                  {examplesButton}
                </span>
                <ViewToggle
                  view={view}
                  onChange={(next) => {
                    if (next === view) return;
                    setView(next);
                    setViewEpoch((n) => n + 1);
                  }}
                />
              </div>
            </div>
            <LayoutGroup>
              {/* Cuatro columnas desde 1280 px; más estrecho, la entrada va encima de las tres de decisiones. */}
              {/* Con un escenario en curso, alto mínimo de una pantalla: así el tablero se puede subir a la vista. */}
              <div ref={boardGrid} className={cn("grid gap-6 xl:grid-cols-4 xl:gap-4", playback && "min-h-dvh")}>
                <Intake
                  queue={queue}
                  scope={layoutScope}
                  playback={playback}
                  simulated={simulated}
                  onFiles={uploadFiles}
                  onDismiss={dismiss}
                  onStopPlayback={stopPlayback}
                  onClosePlayback={() => setPlayback((p) => (p && p.status !== "running" ? null : p))}
                />
                <div className="min-w-0 xl:col-span-3">
                  <Board items={items} view={view} scope={layoutScope} countries={countries} now={now} />
                </div>
              </div>
            </LayoutGroup>
          </section>
        </motion.div>
      )}

      <SamplesDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        samples={samples}
        loadError={samplesError}
        onRetry={loadSamples}
        results={sampleResults}
        pendingIds={pendingIds}
        busy={busy || confirmBusy}
        onPlay={(scenario, list) => askConfirm({ kind: "scenario", scenario, samples: list })}
        onUpload={uploadSample}
      />

      <ConfirmDialog
        open={confirmOpen}
        title={confirmCopy.title}
        description={confirmCopy.description}
        confirmLabel={confirmCopy.confirmLabel}
        busyLabel={confirmCopy.busyLabel}
        busy={confirmBusy}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          if (confirm.kind === "scenario") void confirmScenario(confirm.scenario, confirm.samples);
          else void confirmReset();
        }}
      />
    </>
  );
}
