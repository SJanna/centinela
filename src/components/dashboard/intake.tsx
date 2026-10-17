"use client";

/**
 * Columna de entrada: lo que está por revisar (cola), la reproducción de un escenario,
 * la zona para soltar facturas y la nota del modo simulado.
 */
import { motion } from "motion/react";
import { FileImage, FileText, FlaskConical, Mail, MessageSquare, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import { OUTCOME_LABEL } from "@/core/checks";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { DropZone } from "@/components/ui/drop-zone";
import { StatusDot } from "@/components/ui/status";
import { LAND_SPRING, layoutIdOf } from "./invoice-card";
import type { Playback, QueueItem } from "./types";

/** Pasos que se ven mientras llega la respuesta (una sola) del servidor. */
const STEPS = ["Leyendo", "Comprobando", "Decidiendo"] as const;
/** Cuándo empieza cada paso, en ms desde que la factura entra a revisión. */
const STEP_AT = [0, 380, 760] as const;

/** Cuántas filas en espera se muestran antes de resumir "y N más". */
const MAX_WAITING_SHOWN = 2;

export const SIMULATED_NOTE =
  "Modo simulado: solo se leen las facturas de ejemplo. Con una clave de Anthropic, Centinela lee cualquier factura.";

const DROP_HINT = "PDF, PNG, JPG, correo (.eml) o texto (.txt) · hasta 4 MB por factura";

function FileIcon({ name }: { name: string }) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const Icon = ["png", "jpg", "jpeg", "webp", "gif", "tif", "tiff"].includes(ext)
    ? FileImage
    : ext === "eml"
      ? Mail
      : ext === "txt"
        ? MessageSquare
        : FileText;
  return <Icon aria-hidden size={16} strokeWidth={1.5} />;
}

/**
 * Pasos de la revisión: tres segmentos de 2px con su etiqueta debajo. El segmento del paso en curso
 * avanza hasta casi el final y espera la respuesta (única) del servidor.
 */
function Steps({ step }: { step: number }) {
  return (
    <ol aria-label="Pasos de la revisión" className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-2">
      {STEPS.map((label, i) => {
        const state = i < step ? "done" : i === step ? "current" : "next";
        return (
          <li key={label} aria-current={state === "current" ? "step" : undefined} className="min-w-0">
            <span aria-hidden className="block h-[2px] overflow-hidden rounded-pill bg-processing-wash">
              <motion.span
                className={cn("block h-full rounded-pill", state === "done" ? "bg-pay-mark" : "bg-processing-mark")}
                initial={{ width: "0%" }}
                animate={{ width: state === "done" ? "100%" : state === "current" ? "72%" : "0%" }}
                transition={{ duration: state === "current" ? 0.5 : 0.2, ease: [0.23, 1, 0.32, 1] }}
              />
            </span>
            <span
              className={cn(
                "mt-1.5 flex min-w-0 text-[11.5px] leading-none font-medium whitespace-nowrap transition-colors duration-150",
                state === "done" && "text-ink-2",
                state === "current" && "text-processing",
                state === "next" && "text-ink-3/70",
              )}
            >
              <span className="truncate">{label}</span>
              {state === "done" ? <span className="sr-only"> (hecho)</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Pasos animados mientras la factura está en revisión. */
function useStep(running: boolean): number {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!running) return;
    const timers = STEP_AT.slice(1).map((at, i) => setTimeout(() => setStep(i + 1), at));
    return () => timers.forEach(clearTimeout);
  }, [running]);
  return running ? step : 0;
}

function QueueRow({ item, scope, onDismiss }: { item: QueueItem; scope: string; onDismiss: (key: string) => void }) {
  const running = item.status === "running";
  const step = useStep(running);
  const error = item.status === "error";
  return (
    <motion.li
      layout
      layoutId={layoutIdOf(item.key, scope)}
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      transition={{ layout: LAND_SPRING, default: { duration: 0.2, ease: [0.32, 0.72, 0, 1] } }}
      className={cn(
        "list-none overflow-hidden rounded-row border bg-surface-0 shadow-hairline",
        error ? "border-hold-mark/30" : running ? "border-processing-mark/30" : "border-seam",
      )}
    >
      <div className="flex items-start gap-3 p-3">
        <span
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-[10px]",
            error ? "bg-hold-wash text-hold" : running ? "bg-processing-wash text-processing" : "bg-surface-2 text-ink-3",
          )}
        >
          <FileIcon name={item.label} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-small font-medium text-navy" title={item.label}>
            {item.label}
          </p>
          {item.detail ? (
            <p className="line-clamp-2 text-caption text-ink-3" title={item.detail}>
              {item.detail}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="mt-1.5 text-caption text-hold">
              {item.error ?? "No se pudo revisar la factura."}
            </p>
          ) : !running ? (
            <p className="mt-1.5 text-caption text-ink-3">En cola.</p>
          ) : null}
        </div>
        {error ? (
          <button
            type="button"
            onClick={() => onDismiss(item.key)}
            aria-label={`Quitar ${item.label} de la lista`}
            className="-mt-1 -mr-1 grid size-7 shrink-0 place-items-center rounded-full text-ink-3 transition-colors duration-150 hover:bg-surface-2 hover:text-ink-2"
          >
            <X aria-hidden size={14} strokeWidth={1.75} />
          </button>
        ) : null}
      </div>
      {running ? (
        <div className="px-3 pt-0.5 pb-3">
          <Steps step={step} />
        </div>
      ) : null}
    </motion.li>
  );
}

function PlaybackCard({ playback, onStop, onClose }: { playback: Playback; onStop: () => void; onClose: () => void }) {
  const running = playback.status === "running";
  const pct = playback.total > 0 ? (playback.done / playback.total) * 100 : 0;
  const all = playback.mismatches.length === 0 && playback.done === playback.total;
  const wrongPayments = playback.mismatches.filter((m) => m.got === "PAGAR" && m.expected !== "PAGAR").length;
  return (
    <div className="rounded-row border border-seam bg-surface-0 p-3.5 shadow-hairline" aria-live="polite">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-small font-medium text-navy">{playback.label}</p>
          <p className="tnum text-caption text-ink-2">
            {running
              ? `${playback.done} de ${playback.total} revisadas.`
              : playback.status === "stopped"
                ? `Detenido en ${playback.done} de ${playback.total}.`
                : "Terminado."}
          </p>
        </div>
        {running ? (
          <Button size="sm" variant="ghost" icon={<Square />} onClick={onStop} className="-mt-1 -mr-1.5 h-7 px-2.5">
            Detener
          </Button>
        ) : (
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar resumen del escenario"
            className="-mt-1 -mr-1 grid size-7 shrink-0 place-items-center rounded-full text-ink-3 transition-colors duration-150 hover:bg-surface-2 hover:text-ink-2"
          >
            <X aria-hidden size={14} strokeWidth={1.75} />
          </button>
        )}
      </div>
      <div aria-hidden className="mt-3 h-[3px] overflow-hidden rounded-pill bg-surface-3">
        <motion.span
          className={cn("block h-full rounded-pill", running ? "bg-processing-mark" : all ? "bg-pay-mark" : "bg-escalate-mark")}
          initial={false}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
        />
      </div>
      {playback.done > 0 ? (
        <p className="mt-2.5 text-caption text-ink-2">
          <span className="tnum font-medium text-navy">
            {playback.matches} de {playback.done}
          </span>{" "}
          {playback.matches === 1 ? "coincide" : "coinciden"} con lo esperado.{" "}
          {/* Lo que más importa: una factura que una persona marcó para frenar o escalar y salió pagada. */}
          {wrongPayments === 0 ? (
            <span className="font-medium text-pay">Ningún pago indebido.</span>
          ) : (
            <span className="font-medium text-hold">
              {wrongPayments === 1 ? "1 pago indebido." : `${wrongPayments} pagos indebidos.`}
            </span>
          )}
        </p>
      ) : null}
      {playback.mismatches.length > 0 ? (
        <ul className="mt-1.5 space-y-0.5 text-caption text-hold">
          {playback.mismatches.map((m) => (
            <li key={m.caseId}>
              <span className="font-mono">{m.caseId}</span> no coincide: se esperaba {OUTCOME_LABEL[m.expected]}
              {m.got ? `, salió ${OUTCOME_LABEL[m.got]}` : ", no se pudo revisar"}.
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

interface IntakeProps {
  queue: QueueItem[];
  /** Ámbito de los layoutId, el mismo del tablero: la fila cae en su tarjeta o fila de la lista. */
  scope: string;
  playback: Playback | null;
  simulated: boolean;
  onFiles: (files: File[]) => void;
  onDismiss: (key: string) => void;
  onStopPlayback: () => void;
  onClosePlayback: () => void;
}

export function Intake({ queue, scope, playback, simulated, onFiles, onDismiss, onStopPlayback, onClosePlayback }: IntakeProps) {
  const active = queue.filter((i) => i.status !== "error");
  const errors = queue.filter((i) => i.status === "error");
  const running = active.filter((i) => i.status === "running");
  const waiting = active.filter((i) => i.status === "waiting");
  const shownWaiting = waiting.slice(0, MAX_WAITING_SHOWN);
  const hiddenWaiting = waiting.length - shownWaiting.length;
  const visible = [...running, ...shownWaiting, ...errors];

  return (
    <section aria-labelledby="columna-entrada" className="min-w-0">
      <div className="flex h-8 items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2">
          <StatusDot status="PROCESANDO" size={7} halo pulse={running.length > 0} />
          <h3 id="columna-entrada" className="text-small font-medium text-navy">
            Por revisar
          </h3>
          <span className="tnum text-small font-medium text-ink-3">{active.length}</span>
        </div>
      </div>

      {/* Bajo 1280 px la entrada ocupa todo el ancho: lo que está en revisión a la izquierda, la zona a la derecha. */}
      <div className="mt-3 grid gap-2.5 md:grid-cols-2 md:gap-4 xl:grid-cols-1 xl:gap-2.5">
        {playback || visible.length > 0 ? (
          <div className="min-w-0 space-y-2.5">
            {playback ? <PlaybackCard playback={playback} onStop={onStopPlayback} onClose={onClosePlayback} /> : null}

            {visible.length > 0 ? (
              <ul className="flex flex-col gap-2.5" aria-label="Facturas en revisión">
                {visible.map((item) => (
                  <QueueRow key={item.key} item={item} scope={scope} onDismiss={onDismiss} />
                ))}
              </ul>
            ) : null}
            {hiddenWaiting > 0 ? (
              <p className="px-1 text-caption text-ink-3">
                Y {hiddenWaiting} {hiddenWaiting === 1 ? "factura" : "facturas"} más en cola.
              </p>
            ) : null}
          </div>
        ) : null}

        {/* Se mueve con resorte cuando entran o salen filas, en vez de saltar. */}
        <motion.div
          layout="position"
          transition={{ layout: LAND_SPRING }}
          className={cn("min-w-0 space-y-2.5", !(playback || visible.length > 0) && "md:col-span-2 xl:col-span-1")}
        >
          <DropZone onFiles={onFiles} hint={DROP_HINT} className="max-xl:min-h-[136px]! max-xl:gap-3! max-xl:py-5!" />

          {simulated ? (
            <p className="flex gap-2 px-1 pt-1 text-caption text-muted">
              <FlaskConical aria-hidden size={14} strokeWidth={1.5} className="mt-px shrink-0 text-ink-3" />
              <span>{SIMULATED_NOTE}</span>
            </p>
          ) : null}
        </motion.div>
      </div>
    </section>
  );
}
