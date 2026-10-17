"use client";

import { Paperclip, TriangleAlert } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useMemo, type ReactNode, type Ref } from "react";
import { Avatar, cn, Mono, Tooltip } from "@/components/ui";
import { findSuspiciousSpans, parseChat, parseEmail, splitByMarks, type SuspiciousNeedle } from "./doc-text";
import { formatEmailDate } from "./format";

// ───────────────────────── Fragmentos sospechosos ─────────────────────────

const EASE = [0.32, 0.72, 0, 1] as const;

interface SuspiciousMarkProps {
  children: ReactNode;
  reason: string;
  /** Muestra el aviso "Centinela no siguió esta instrucción" tras el fragmento. */
  callout?: boolean;
  ref?: Ref<HTMLElement>;
}

/** Marcador amarillo que se pinta de izquierda a derecha, con subrayado ondulado rojo. */
export function SuspiciousMark({ children, reason, callout = true, ref }: SuspiciousMarkProps) {
  const reduce = useReducedMotion();
  return (
    <>
      <motion.mark
        ref={ref}
        data-suspicious=""
        className="marker-suspicious px-0.5"
        initial={reduce ? false : { backgroundSize: "0% 100%" }}
        animate={{ backgroundSize: "100% 100%" }}
        transition={{ duration: 0.4, delay: 0.15, ease: EASE }}
      >
        {children}
      </motion.mark>
      {callout ? (
        <Tooltip content={reason} side="top" align="start" maxWidth={300} className="ml-1.5 align-[1px]">
          <span
            tabIndex={0}
            className="inline-flex cursor-help items-center gap-1 rounded-pill bg-suspicious-solid px-2 py-px font-sans text-[11px] leading-[18px] font-medium whitespace-nowrap text-white"
          >
            <TriangleAlert aria-hidden size={11} strokeWidth={2} />
            Centinela no siguió esta instrucción
          </span>
        </Tooltip>
      ) : null}
    </>
  );
}

interface HighlightedProps {
  text: string;
  needles: readonly SuspiciousNeedle[];
  /** Citas de datos leídos que se subrayan en cobalto (hover desde comprobaciones o "Datos leídos"). */
  evidence?: readonly string[];
  callout?: boolean;
  /** Recibe el primer fragmento resaltado (para llevar la vista hasta él). */
  firstMarkRef?: (el: HTMLElement | null) => void;
}

const NO_EVIDENCE: readonly string[] = [];

/** Texto con los fragmentos sospechosos resaltados y, si se pide, las citas subrayadas en cobalto. */
export function Highlighted({ text, needles, evidence = NO_EVIDENCE, callout = true, firstMarkRef }: HighlightedProps) {
  const suspicious = useMemo(() => findSuspiciousSpans(text, needles), [text, needles]);
  const quoted = useMemo(
    () => findSuspiciousSpans(text, evidence.map((q) => ({ text: q, reason: "" }))),
    [text, evidence],
  );
  const pieces = useMemo(() => splitByMarks(text, suspicious, quoted), [text, suspicious, quoted]);
  const firstStart = pieces.find((p) => p.span != null)?.start;
  return (
    <>
      {pieces.map((piece) => {
        if (piece.span) {
          return (
            <SuspiciousMark
              key={`s${piece.start}`}
              reason={piece.span.reason}
              callout={callout}
              ref={piece.start === firstStart ? firstMarkRef : undefined}
            >
              {piece.text}
            </SuspiciousMark>
          );
        }
        if (piece.evidence) {
          return (
            <span
              key={`e${piece.start}`}
              data-evidence=""
              className="rounded-[2px] bg-accent/10 underline decoration-accent decoration-2 underline-offset-[3px] transition-colors duration-150"
            >
              {piece.text}
            </span>
          );
        }
        return <span key={`t${piece.start}`}>{piece.text}</span>;
      })}
    </>
  );
}

// ───────────────────────── Correo ─────────────────────────

export function EmailView({
  plainText,
  meta,
  needles,
  evidence,
}: {
  plainText: string;
  meta: Record<string, string>;
  needles: readonly SuspiciousNeedle[];
  evidence?: readonly string[];
}) {
  const email = useMemo(() => parseEmail(plainText, meta), [plainText, meta]);
  const rows: [string, ReactNode][] = [
    ["De", email.from],
    ["Para", email.to],
    ...(email.cc ? ([["CC", email.cc]] as [string, ReactNode][]) : []),
    ["Fecha", email.date ? formatEmailDate(email.date) : "—"],
  ];
  return (
    <article className="mx-auto max-w-[680px] rounded-card bg-surface-0 shadow-receipt ring-1 ring-seam">
      <header className="space-y-3 border-b border-seam px-6 pt-5 pb-4">
        <div className="flex items-start gap-3">
          <Avatar name={email.from.replace(/<.*>/, "").trim() || email.from} size={40} shape="circle" />
          <h3 className="min-w-0 pt-2 text-h3 text-navy">
            <Highlighted text={email.subject} needles={needles} callout={false} />
          </h3>
        </div>
        <dl className="grid grid-cols-[56px_1fr] gap-x-3 gap-y-1 text-small">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{k}</dt>
              <dd className="min-w-0 break-words text-ink-2">{v}</dd>
            </div>
          ))}
        </dl>
        {email.attachments.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5" aria-label="Adjuntos">
            {email.attachments.map((name) => (
              <li
                key={name}
                className="inline-flex h-6 items-center gap-1.5 rounded-chip bg-surface-2 px-2 text-caption text-ink-2"
              >
                <Paperclip aria-hidden size={12} strokeWidth={1.75} className="text-ink-3" />
                <Mono className="text-[11.5px]">{name}</Mono>
              </li>
            ))}
          </ul>
        ) : null}
      </header>
      <div className="px-6 py-5 text-small leading-[1.65] whitespace-pre-wrap text-ink">
        <Highlighted text={email.body} needles={needles} evidence={evidence} />
      </div>
      {email.attachmentTexts.map((att) => (
        <details key={att.title} className="group border-t border-seam px-6 py-3">
          <summary className="cursor-pointer list-none text-caption font-medium text-ink-2 marker:hidden hover:text-navy">
            <span className="inline-flex items-center gap-1.5">
              <Paperclip aria-hidden size={12} strokeWidth={1.75} />
              Texto del adjunto <Mono>{att.title}</Mono>
              <span aria-hidden className="text-ink-3 transition-transform group-open:rotate-90">
                ›
              </span>
            </span>
          </summary>
          <pre className="mt-3 max-h-[320px] overflow-auto rounded-row bg-surface-1 p-3 font-mono text-[12px] leading-[1.6] whitespace-pre-wrap text-ink-2 scrollbar-quiet">
            <Highlighted text={att.text} needles={needles} evidence={evidence} />
          </pre>
        </details>
      ))}
    </article>
  );
}

// ───────────────────────── Chat ─────────────────────────

export function ChatView({
  plainText,
  meta,
  needles,
  evidence,
}: {
  plainText: string;
  meta: Record<string, string>;
  needles: readonly SuspiciousNeedle[];
  evidence?: readonly string[];
}) {
  const participants = useMemo(
    () =>
      (meta.participants ?? "")
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean),
    [meta.participants],
  );
  const messages = useMemo(() => parseChat(plainText, participants), [plainText, participants]);
  if (!messages) return <TextView plainText={plainText} needles={needles} evidence={evidence} />;
  const firstAuthor = messages.find((m) => m.kind === "message")?.author ?? null;

  return (
    <div className="mx-auto flex max-w-[640px] flex-col gap-2 rounded-card bg-bed p-4 ring-1 ring-seam">
      {messages.map((m, i) => {
        if (m.kind === "system") {
          return (
            <p key={i} className="mx-auto max-w-[88%] rounded-row bg-surface-2 px-3 py-1.5 text-center text-caption text-muted">
              {m.text}
            </p>
          );
        }
        const incoming = m.author === firstAuthor;
        const prev = messages[i - 1];
        const showAuthor = !prev || prev.kind !== "message" || prev.author !== m.author;
        return (
          <div key={i} className={cn("flex", incoming ? "justify-start" : "justify-end", showAuthor && i > 0 && "mt-1.5")}>
            <div
              className={cn(
                "max-w-[82%] rounded-card px-3.5 py-2 shadow-hairline",
                incoming ? "rounded-tl-[6px] bg-surface-0 ring-1 ring-seam" : "rounded-tr-[6px] bg-accent-wash ring-1 ring-lavender/50",
              )}
            >
              {showAuthor && m.author ? (
                <p className={cn("text-caption font-medium", incoming ? "text-navy" : "text-accent")}>{m.author}</p>
              ) : null}
              <p className="text-small leading-[1.55] whitespace-pre-wrap text-ink">
                <Highlighted text={m.text} needles={needles} evidence={evidence} />
              </p>
              {m.stamp ? <p className="mt-0.5 text-right font-mono text-[10.5px] text-ink-3">{m.stamp}</p> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ───────────────────────── Texto ─────────────────────────

export function TextView({
  plainText,
  needles,
  evidence,
}: {
  plainText: string;
  needles: readonly SuspiciousNeedle[];
  evidence?: readonly string[];
}) {
  return (
    <pre className="mx-auto max-w-[720px] rounded-card bg-surface-0 p-6 font-mono text-[12.5px] leading-[1.7] whitespace-pre-wrap text-ink shadow-receipt ring-1 ring-seam">
      <Highlighted text={plainText} needles={needles} evidence={evidence} />
    </pre>
  );
}
