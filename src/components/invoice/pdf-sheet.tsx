"use client";

/**
 * El PDF como una hoja blanca sobre el estudio, dibujado con PDF.js (unpdf) en el navegador, en vez
 * del visor de Chrome. Por defecto la hoja entera cabe en el panel; "Ampliar" la ajusta al ancho.
 * Encima de la hoja:
 *   - las instrucciones sospechosas, con marcador amarillo, subrayado ondulado y bandera en el margen.
 *     Si el texto es diminuto (texto oculto), un aviso lo muestra a tamaño legible;
 *   - las citas de los datos leídos, subrayadas en cobalto al pasar el cursor por una comprobación o
 *     un campo de "Datos leídos".
 * Si PDF.js falla, `onFail` vuelve al visor del navegador.
 */
import { Maximize2, Minimize2, TriangleAlert } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { cn, SkeletonText } from "@/components/ui";
import type { SuspiciousNeedle } from "./doc-text";
import { joinPageText, locate, type FoundMark, type PageRect, type PageText, type PageTextItem } from "./pdf-layout";

type PdfDocument = Awaited<ReturnType<typeof import("unpdf").getDocumentProxy>>;
type PdfPage = Awaited<ReturnType<PdfDocument["getPage"]>>;

/** Páginas que se dibujan como máximo (las facturas tienen 1 o 2). */
const MAX_PAGES = 4;
/** Debajo de este tamaño (en puntos) el texto no se ve en la hoja. */
const HIDDEN_FONT_PT = 3;
/** Margen del estudio alrededor de la hoja, en px (p-6). */
const STUDIO_PAD = 24;
const EASE = [0.32, 0.72, 0, 1] as const;

interface LoadedPage {
  page: PdfPage;
  width: number;
  height: number;
  text: PageText;
}

interface PdfSheetProps {
  fileUrl: string;
  filename: string;
  needles: readonly SuspiciousNeedle[];
  /** Citas que se subrayan en cobalto (las del campo o la comprobación bajo el cursor). */
  evidence: readonly string[];
  onFail: () => void;
}

export function PdfSheet({ fileUrl, filename, needles, evidence, onFail }: PdfSheetProps) {
  const [pages, setPages] = useState<LoadedPage[] | null>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const studioRef = useRef<HTMLDivElement>(null);
  const onFailRef = useRef(onFail);
  useEffect(() => {
    onFailRef.current = onFail;
  }, [onFail]);

  useEffect(() => {
    let cancelled = false;
    let doc: PdfDocument | null = null;
    (async () => {
      const res = await fetch(fileUrl, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      const { getDocumentProxy } = await import("unpdf");
      doc = await getDocumentProxy(bytes, { verbosity: 0 });
      const count = Math.min(doc.numPages, MAX_PAGES);
      const loaded: LoadedPage[] = [];
      for (let i = 1; i <= count; i++) {
        const page = await doc.getPage(i);
        const viewport = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();
        const items: PageTextItem[] = [];
        for (const raw of content.items) {
          if (!("str" in raw)) continue;
          const [a, b, c, d, e, f] = raw.transform as number[];
          const [x, y] = viewport.convertToViewportPoint(e, f);
          items.push({
            str: raw.str,
            left: x,
            width: raw.width || Math.hypot(a, b) * raw.str.length * 0.5,
            baseline: y,
            fontSize: Math.hypot(c, d) || raw.height || 1,
            hasEOL: raw.hasEOL,
          });
        }
        loaded.push({ page, width: viewport.width, height: viewport.height, text: joinPageText(items) });
      }
      if (cancelled) return;
      setTotalPages(doc.numPages);
      setPages(loaded);
    })().catch(() => {
      if (!cancelled) onFailRef.current();
    });
    return () => {
      cancelled = true;
      void doc?.destroy();
    };
  }, [fileUrl]);

  // Espacio del estudio: la hoja se ajusta a él y se vuelve a dibujar nítida si cambia.
  useEffect(() => {
    const el = studioRef.current;
    if (!el) return;
    let frame = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        setBox({ width: Math.max(0, el.clientWidth - STUDIO_PAD * 2), height: Math.max(0, el.clientHeight - STUDIO_PAD * 2) }),
      );
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, []);

  const widthFor = (p: LoadedPage) => {
    if (box.width <= 0) return 0;
    if (zoomed || box.height <= 0) return Math.round(box.width);
    return Math.round(Math.min(box.width, (box.height * p.width) / p.height));
  };

  return (
    <div className="relative h-full">
      <div ref={studioRef} className="studio h-full overflow-auto p-6 scrollbar-quiet">
        {pages && box.width > 0 ? (
          <div className="flex flex-col items-center gap-5">
            {pages.map((p, i) => (
              <SheetPage
                key={i}
                loaded={p}
                index={i}
                cssWidth={widthFor(p)}
                filename={filename}
                needles={needles}
                evidence={evidence}
                onFail={onFail}
              />
            ))}
            {totalPages > pages.length ? (
              <p className="text-center text-caption text-muted">
                Se muestran {pages.length} de {totalPages} páginas. El archivo completo se abre con «Abrir».
              </p>
            ) : null}
          </div>
        ) : (
          <div aria-hidden className="mx-auto aspect-[1/1.414] h-full max-w-full rounded-[6px] bg-white p-8 shadow-receipt">
            <div className="mb-8 h-12 w-full animate-shimmer rounded-[4px] bg-[linear-gradient(90deg,#f0f2f4,#f7f7f7,#f0f2f4)] bg-[length:200%_100%]" />
            <SkeletonText lines={9} />
          </div>
        )}
      </div>
      {pages ? (
        <button
          type="button"
          onClick={() => setZoomed((z) => !z)}
          aria-pressed={zoomed}
          className="absolute right-3 bottom-3 z-20 inline-flex h-8 items-center gap-1.5 rounded-pill bg-surface-0/95 px-3 text-caption font-medium text-ink-2 shadow-hairline ring-1 ring-seam backdrop-blur-sm transition-colors duration-150 ring-inset hover:text-navy"
        >
          {zoomed ? <Minimize2 aria-hidden size={13} strokeWidth={1.75} /> : <Maximize2 aria-hidden size={13} strokeWidth={1.75} />}
          {zoomed ? "Ver la hoja entera" : "Ampliar"}
        </button>
      ) : null}
    </div>
  );
}

interface SheetPageProps {
  loaded: LoadedPage;
  index: number;
  cssWidth: number;
  filename: string;
  needles: readonly SuspiciousNeedle[];
  evidence: readonly string[];
  onFail: () => void;
}

function SheetPage({ loaded, index, cssWidth, filename, needles, evidence, onFail }: SheetPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [painted, setPainted] = useState(false);
  const reduce = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || cssWidth <= 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    // Nitidez mínima: aunque la hoja se vea chica, se dibuja al menos a 1,5×.
    const scale = Math.max((cssWidth / loaded.width) * dpr, 1.5);
    const viewport = loaded.page.getViewport({ scale });
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const task = loaded.page.render({ canvas, viewport });
    task.promise.then(
      () => setPainted(true),
      (err: unknown) => {
        if ((err as { name?: string } | null)?.name !== "RenderingCancelledException") onFail();
      },
    );
    return () => task.cancel();
  }, [cssWidth, loaded, onFail]);

  const suspicious = useMemo(() => locate(loaded.text, needles, loaded.width, loaded.height), [loaded, needles]);
  const evidenceMarks = useMemo(
    () =>
      locate(
        loaded.text,
        evidence.map((text) => ({ text, reason: "" })),
        loaded.width,
        loaded.height,
      ),
    [loaded, evidence],
  );

  return (
    <div
      className="relative shrink-0 rounded-[6px] bg-white shadow-receipt transition-[width] duration-200 ease-out"
      style={{ width: cssWidth, aspectRatio: `${loaded.width} / ${loaded.height}` }}
    >
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`${filename}, página ${index + 1}`}
        className={cn(
          "absolute inset-0 size-full rounded-[6px] transition-opacity duration-200 ease-out",
          painted ? "opacity-100" : "opacity-0",
        )}
      />
      {/* Citas de los datos leídos (hover bidireccional). */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <AnimatePresence>
          {evidenceMarks.flatMap((m, mi) =>
            m.rects.map((r, ri) => (
              <motion.span
                key={`${m.text}-${mi}-${ri}`}
                className="absolute rounded-[2px] bg-accent/10 shadow-[inset_0_-2px_0_var(--color-accent)]"
                style={rectStyle(r, 2)}
                initial={reduce ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15, ease: EASE }}
              />
            )),
          )}
        </AnimatePresence>
      </div>
      {painted ? suspicious.map((m, i) => <SuspiciousOnSheet key={i} mark={m} reduce={Boolean(reduce)} />) : null}
    </div>
  );
}

/** Posición de un rectángulo con un margen mínimo en px para que lo diminuto se vea. */
function rectStyle(r: PageRect, pad = 2, minHeight = 0, minWidth = 0): CSSProperties {
  const cy = r.top + r.height / 2;
  return {
    left: `calc(${r.left}% - ${pad}px)`,
    width: `max(calc(${r.width}% + ${pad * 2}px), ${minWidth}px)`,
    top: `calc(${cy}% - max(calc(${r.height / 2}% + ${pad}px), ${minHeight / 2}px))`,
    height: `max(calc(${r.height}% + ${pad * 2}px), ${minHeight}px)`,
  };
}

const WAVE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='4' viewBox='0 0 8 4'%3E%3Cpath d='M0 2 Q2 0 4 2 T8 2' fill='none' stroke='%23E23B4A' stroke-width='1'/%3E%3C/svg%3E\")";

function SuspiciousOnSheet({ mark, reduce }: { mark: FoundMark; reduce: boolean }) {
  const hidden = mark.rects.every((r) => r.fontSize < HIDDEN_FONT_PT);
  const first = mark.rects[0];
  const last = mark.rects[mark.rects.length - 1];
  const nearBottom = last.top + last.height > 72;
  const alignRight = first.left > 55;
  // Se pinta cuando la hoja entra en la vista, no antes: así el marcador se ve correr.
  const inView = { once: true, amount: 0.35 } as const;

  return (
    <>
      {mark.rects.map((r, i) => (
        <span key={i} aria-hidden className="pointer-events-none absolute" style={rectStyle(r, 2, hidden ? 14 : 0, hidden ? 28 : 0)}>
          <motion.span
            className="absolute inset-0 origin-left rounded-[2px] bg-suspicious-marker mix-blend-multiply"
            initial={reduce ? false : { scaleX: 0 }}
            whileInView={{ scaleX: 1 }}
            viewport={inView}
            transition={{ duration: 0.4, delay: 0.2 + i * 0.1, ease: EASE }}
          />
          <motion.span
            className="absolute inset-x-0 -bottom-[3px] h-[4px] origin-left"
            style={{ backgroundImage: WAVE, backgroundRepeat: "repeat-x", backgroundSize: "8px 4px" }}
            initial={reduce ? false : { scaleX: 0 }}
            whileInView={{ scaleX: 1 }}
            viewport={inView}
            transition={{ duration: 0.4, delay: 0.3 + i * 0.1, ease: EASE }}
          />
          {hidden ? <span className="absolute -inset-1.5 rounded-[4px] ring-2 ring-suspicious-wave/70" /> : null}
        </span>
      ))}
      {/* Bandera en el margen. */}
      <span
        aria-hidden
        className="pointer-events-none absolute left-1.5 w-[3px] rounded-full bg-suspicious-solid"
        style={{ top: `calc(${first.top}% - 3px)`, height: `max(calc(${last.top + last.height - first.top}% + 6px), 14px)` }}
      />
      {/* Aviso junto al fragmento. */}
      <motion.div
        role="note"
        className={cn(
          "absolute z-10 w-max max-w-[min(88%,380px)] rounded-row bg-surface-0 px-3 py-2 shadow-pop ring-1 ring-[#f1d9da]",
          alignRight ? "right-[4%]" : "",
        )}
        style={{
          ...(alignRight ? {} : { left: `max(4%, min(${first.left}%, 40%))` }),
          ...(nearBottom ? { bottom: `calc(${100 - first.top}% + 12px)` } : { top: `calc(${last.top + last.height}% + 10px)` }),
        }}
        initial={reduce ? false : { opacity: 0, y: nearBottom ? 4 : -4 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={inView}
        transition={{ duration: 0.18, delay: 0.75, ease: EASE }}
      >
        <p className="flex items-center gap-1.5 text-caption font-medium text-suspicious">
          <TriangleAlert aria-hidden size={12} strokeWidth={2} className="shrink-0" />
          {hidden ? "Texto oculto: en la hoja no se ve." : "Instrucción dentro de la factura."}
        </p>
        {hidden ? (
          <p className="mt-1 font-mono text-[12px] leading-[1.5] text-ink">
            <mark className="marker-suspicious px-0.5">{mark.text}</mark>
          </p>
        ) : null}
        <p className="mt-0.5 text-caption text-ink-2">Centinela no siguió esta instrucción.</p>
      </motion.div>
    </>
  );
}
