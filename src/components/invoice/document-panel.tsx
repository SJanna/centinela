"use client";

import { ArrowUpRight, FileText, ImageIcon, Mail, MessagesSquare, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn, Mono, Sheet, Skeleton, SkeletonText } from "@/components/ui";
import type { DocKind } from "@/core/schemas";
import { DOCUMENT_PANEL_ID, useDetail, type DocTab } from "./detail-context";
import { findSuspiciousSpans, type SuspiciousNeedle } from "./doc-text";
import { ChatView, EmailView, Highlighted, TextView } from "./document-views";
import { CHECK_FIELDS, type FieldKey } from "./fields";
import { formatInteger } from "./format";
import { PdfSheet } from "./pdf-sheet";
import { ScanLine } from "./scan-line";

interface Preview {
  kind: DocKind;
  mediaType: string;
  filename: string;
  plainText: string | null;
  meta: Record<string, string>;
}

type PreviewState = { status: "loading" } | { status: "ok"; preview: Preview } | { status: "error"; message: string };

const KIND_ICON = { pdf: FileText, image: ImageIcon, email: Mail, chat: MessagesSquare, text: FileText } as const;

function guessKind(filename: string): DocKind | null {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf") return "pdf";
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) return "image";
  return null;
}

function kindCaption(kind: DocKind | null, meta: Record<string, string>): string {
  switch (kind) {
    case "pdf": {
      const pages = Number(meta.pages);
      const base = Number.isFinite(pages) && pages > 0 ? `PDF · ${pages === 1 ? "1 página" : `${pages} páginas`}` : "PDF";
      return meta.textLayer === "false" ? `${base} · sin capa de texto` : base;
    }
    case "image":
      return meta.width && meta.height ? `Imagen · ${formatInteger(Number(meta.width))} × ${formatInteger(Number(meta.height))}` : "Imagen";
    case "email": {
      const n = (meta.attachments ?? "").split(",").filter((s) => s.trim()).length;
      return n > 0 ? `Correo · ${n === 1 ? "1 adjunto" : `${n} adjuntos`}` : "Correo";
    }
    case "chat": {
      const n = (meta.participants ?? "").split(",").filter((s) => s.trim()).length;
      return n > 0 ? `Chat · ${n} participantes` : "Chat";
    }
    case "text":
      return "Texto";
    default:
      return "Archivo";
  }
}

/** Citas de cada campo leído (lectura A y B), para subrayarlas en la hoja. */
export type FieldEvidence = Partial<Record<FieldKey, readonly string[]>>;

interface DocumentPanelProps {
  invoiceId: string;
  filename: string;
  needles: readonly SuspiciousNeedle[];
  evidence?: FieldEvidence;
}

export function DocumentPanel({ invoiceId, filename, needles, evidence = {} }: DocumentPanelProps) {
  const { docTab, setDocTab, activeCheck, activeField } = useDetail();
  // Citas del campo o de la comprobación bajo el cursor: se subrayan en cobalto en la hoja.
  const activeEvidence = useMemo(() => {
    const fields: readonly FieldKey[] = activeField ? [activeField] : activeCheck ? CHECK_FIELDS[activeCheck] : [];
    return [...new Set(fields.flatMap((f) => evidence[f] ?? []))];
  }, [activeCheck, activeField, evidence]);
  const [state, setState] = useState<PreviewState>({ status: "loading" });
  const fileUrl = `/api/invoices/${encodeURIComponent(invoiceId)}/file`;

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/invoices/${encodeURIComponent(invoiceId)}/preview`, { signal: ctrl.signal, cache: "no-store" })
      .then(async (res) => {
        const body: unknown = await res.json().catch(() => null);
        if (!res.ok) {
          const message = (body as { error?: string } | null)?.error ?? "No se pudo preparar la vista previa.";
          throw new Error(message);
        }
        return body as Preview;
      })
      .then((preview) => setState({ status: "ok", preview }))
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        setState({ status: "error", message: err instanceof Error ? err.message : "No se pudo preparar la vista previa." });
      });
    return () => ctrl.abort();
  }, [invoiceId]);

  const preview = state.status === "ok" ? state.preview : null;
  const kind: DocKind | null = preview?.kind ?? guessKind(filename);
  const meta = useMemo(() => preview?.meta ?? {}, [preview]);
  const plainText = preview?.plainText ?? null;
  const suspiciousInText = useMemo(() => (plainText ? findSuspiciousSpans(plainText, needles).length : 0), [plainText, needles]);
  const Icon = kind ? KIND_ICON[kind] : FileText;

  return (
    <Sheet as="section" id={DOCUMENT_PANEL_ID} padding="none" aria-labelledby="documento-titulo" className="scroll-mt-24 overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-seam px-5 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-surface-2 text-ink-2">
            <Icon size={16} strokeWidth={1.5} />
          </span>
          <div className="min-w-0">
            <h2 id="documento-titulo" className="sr-only">
              Documento
            </h2>
            <Mono className="block truncate text-small text-navy" title={filename}>
              {filename}
            </Mono>
            <p className="text-caption text-muted">{kindCaption(kind, meta)}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={fileUrl}
            target="_blank"
            rel="noreferrer"
            className="hidden h-7 items-center gap-1 rounded-pill px-2.5 text-caption font-medium text-ink-2 transition-colors duration-150 hover:bg-[#1c253a0d] hover:text-navy sm:inline-flex"
          >
            Abrir
            <ArrowUpRight aria-hidden size={13} strokeWidth={1.75} />
          </a>
          <DocTabs value={docTab} onChange={setDocTab} suspicious={suspiciousInText} />
        </div>
      </header>

      <DocBody
        tab={docTab}
        state={state}
        kind={kind}
        meta={meta}
        plainText={plainText}
        fileUrl={fileUrl}
        filename={filename}
        needles={needles}
        evidence={activeEvidence}
        suspiciousInText={suspiciousInText}
        onShowText={() => setDocTab("text")}
      />
    </Sheet>
  );
}

function DocTabs({ value, onChange, suspicious }: { value: DocTab; onChange: (tab: DocTab) => void; suspicious: number }) {
  const tabs: [DocTab, string][] = [
    ["document", "Documento"],
    ["text", "Texto extraído"],
  ];
  return (
    <div role="tablist" aria-label="Vista del documento" className="inline-flex rounded-pill bg-control p-0.5 text-caption font-medium">
      {tabs.map(([tab, label]) => (
        <button
          key={tab}
          type="button"
          role="tab"
          id={`pestana-${tab}`}
          aria-selected={value === tab}
          aria-controls="documento-contenido"
          onClick={() => onChange(tab)}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-pill px-3 transition-[background-color,color,box-shadow] duration-150 ease-out",
            value === tab ? "bg-surface-0 text-navy shadow-hairline ring-1 ring-seam" : "text-ink-2 hover:text-navy",
          )}
        >
          {label}
          {tab === "text" && suspicious > 0 ? (
            <span
              aria-label={`${suspicious} fragmento sospechoso`}
              className="tnum grid h-4 min-w-4 place-items-center rounded-pill bg-suspicious-solid px-1 text-[10px] leading-none text-white"
            >
              {suspicious}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

interface DocBodyProps {
  tab: DocTab;
  state: PreviewState;
  kind: DocKind | null;
  meta: Record<string, string>;
  plainText: string | null;
  fileUrl: string;
  filename: string;
  needles: readonly SuspiciousNeedle[];
  evidence: readonly string[];
  suspiciousInText: number;
  onShowText: () => void;
}

const BODY_HEIGHT = "h-[min(76vh,780px)] min-h-[480px]";

function DocBody({ tab, state, kind, meta, plainText, fileUrl, filename, needles, evidence, suspiciousInText, onShowText }: DocBodyProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const firstMark = useRef<HTMLElement | null>(null);
  // Si PDF.js no puede dibujar el PDF, se usa el visor del navegador.
  const [pdfFallback, setPdfFallback] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const onPdfFail = useCallback(() => setPdfFallback(true), []);

  // Al abrir "Texto extraído", lleva la vista al primer fragmento sospechoso (p. ej. texto oculto al final del PDF).
  useEffect(() => {
    if (tab !== "text") return;
    const frame = requestAnimationFrame(() => {
      const box = scrollRef.current;
      const mark = firstMark.current;
      if (!box || !mark) return;
      const top = mark.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
      box.scrollTo({ top: Math.max(0, top - box.clientHeight / 3) });
    });
    return () => cancelAnimationFrame(frame);
  }, [tab, plainText]);

  const loading = state.status === "loading";
  const error = state.status === "error" ? state.message : null;

  if (tab === "text") {
    return (
      <div
        ref={scrollRef}
        id="documento-contenido"
        role="tabpanel"
        aria-labelledby="pestana-text"
        className={cn("relative overflow-auto bg-surface-1 scrollbar-quiet", BODY_HEIGHT)}
      >
        <div className="sticky top-0 z-10 border-b border-seam bg-surface-1/95 px-5 py-2.5 text-caption text-muted backdrop-blur-sm">
          Texto sacado del archivo sin modelo.{" "}
          {kind === "pdf" ? "Incluye el texto que no se ve en la hoja. " : null}
          {suspiciousInText > 0 ? (
            <span className="font-medium text-suspicious">
              {suspiciousInText === 1
                ? "1 fragmento intenta dar órdenes y está resaltado."
                : `${suspiciousInText} fragmentos intentan dar órdenes y están resaltados.`}
            </span>
          ) : null}
        </div>
        {loading ? (
          <div className="p-6">
            <SkeletonText lines={8} />
          </div>
        ) : error ? (
          <p className="p-6 text-small text-ink-2">{error}</p>
        ) : plainText ? (
          <pre className="px-5 py-4 font-mono text-[12.5px] leading-[1.75] whitespace-pre-wrap text-ink">
            <Highlighted
              text={plainText}
              needles={needles}
              firstMarkRef={(el) => {
                firstMark.current = el;
              }}
            />
          </pre>
        ) : (
          <div className="grid h-[calc(100%-41px)] place-items-center p-8 text-center">
            <div className="max-w-[40ch] space-y-1.5">
              <p className="text-h3 text-navy">{kind === "image" ? "Sin texto extraído." : "Este archivo no trae texto."}</p>
              <p className="text-small text-ink-2">
                {kind === "image"
                  ? "Una imagen no tiene texto que se pueda sacar sin el modelo. Lo que leyeron las dos lecturas está en «Datos leídos»."
                  : "Es un documento escaneado o sin capa de texto. Lo que leyeron las dos lecturas está en «Datos leídos»."}
              </p>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Pestaña "Documento".
  let content: ReactNode;
  if (kind === "pdf") {
    content = (
      <div className="flex h-full flex-col">
        {suspiciousInText > 0 ? (
          <button
            type="button"
            onClick={onShowText}
            className="flex w-full items-center gap-2 border-b border-[#f1d9da] bg-hold-wash px-4 py-2 text-left text-caption text-suspicious transition-colors duration-150 hover:bg-[#f6dfe1]"
          >
            <TriangleAlert aria-hidden size={13} strokeWidth={2} className="shrink-0" />
            <span className="min-w-0 flex-1">
              El texto de este PDF intenta dar órdenes. Puede no verse en la hoja.
            </span>
            <span className="shrink-0 font-medium">Ver en Texto extraído →</span>
          </button>
        ) : null}
        <div className="min-h-0 flex-1">
          {pdfFallback ? (
            <iframe
              src={`${fileUrl}#view=FitH&toolbar=0&navpanes=0`}
              title={`Documento ${filename}`}
              className="size-full border-0 bg-surface-2"
            />
          ) : (
            <PdfSheet fileUrl={fileUrl} filename={filename} needles={needles} evidence={evidence} onFail={onPdfFail} />
          )}
        </div>
      </div>
    );
  } else if (kind === "image") {
    content = (
      <div className="studio grid h-full place-items-center overflow-auto p-6 scrollbar-quiet">
        <a
          href={fileUrl}
          target="_blank"
          rel="noreferrer"
          className="relative block max-h-full rounded-[6px]"
          title="Abrir la imagen en tamaño completo"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- archivo subido servido por la API, sin optimizar */}
          <img
            src={fileUrl}
            alt={`Factura ${filename}`}
            ref={(el) => {
              // Si ya estaba en caché, el evento load pudo ocurrir antes de hidratar.
              if (el?.complete && el.naturalWidth > 0) setImageLoaded(true);
            }}
            onLoad={() => setImageLoaded(true)}
            className="max-h-[calc(min(76vh,780px)-48px)] w-auto rounded-[6px] bg-white shadow-receipt"
          />
          {imageLoaded ? <ScanLine /> : null}
        </a>
      </div>
    );
  } else if (loading) {
    content = (
      <div className="space-y-4 p-6">
        <Skeleton className="h-10 w-2/3" />
        <SkeletonText lines={10} />
      </div>
    );
  } else if (error || !plainText) {
    content = (
      <div className="grid h-full place-items-center p-8 text-center">
        <div className="max-w-[44ch] space-y-1.5">
          <p className="text-h3 text-navy">No se puede mostrar el documento.</p>
          <p className="text-small text-ink-2">{error ?? "El archivo no trae texto para mostrar."} Puedes descargarlo y abrirlo aparte.</p>
        </div>
      </div>
    );
  } else if (kind === "email") {
    content = (
      <div className="p-5">
        <EmailView plainText={plainText} meta={meta} needles={needles} evidence={evidence} />
      </div>
    );
  } else if (kind === "chat") {
    content = (
      <div className="p-5">
        <ChatView plainText={plainText} meta={meta} needles={needles} evidence={evidence} />
      </div>
    );
  } else {
    content = (
      <div className="p-5">
        <TextView plainText={plainText} needles={needles} evidence={evidence} />
      </div>
    );
  }

  return (
    <div
      id="documento-contenido"
      role="tabpanel"
      aria-labelledby="pestana-document"
      className={cn("relative overflow-auto bg-surface-1 scrollbar-quiet", BODY_HEIGHT, kind === "pdf" && "overflow-hidden")}
    >
      {content}
    </div>
  );
}
