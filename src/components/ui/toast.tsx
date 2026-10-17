"use client";

import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "./cn";
import { StatusDot } from "./status";
import type { Tone } from "./tones";

export type ToastTone = Tone | "ERROR";

export interface ToastOptions {
  /** Frase corta con punto: "Pagada." */
  title: string;
  /** Detalle: "4.250,00 USD a Andina Logística SAS." */
  description?: ReactNode;
  tone?: ToastTone;
  /** Milisegundos antes de cerrarse (5000 por defecto; 0 = no se cierra solo). */
  duration?: number;
  /** Enlace opcional: "Ver decisión →". */
  action?: { label: string; href: string };
}

interface ToastItem extends ToastOptions {
  id: string;
}

interface ToastContextValue {
  /** Muestra un aviso y devuelve su id. */
  toast: (options: ToastOptions) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const MAX_VISIBLE = 4;

/** Proveedor de avisos. Va una vez, en el layout. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const counter = useRef(0);

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setItems((list) => list.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (options: ToastOptions) => {
      counter.current += 1;
      const id = `toast-${counter.current}`;
      setItems((list) => [...list, { ...options, id }].slice(-MAX_VISIBLE));
      const duration = options.duration ?? 5000;
      if (duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration),
        );
      }
      return id;
    },
    [dismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const timer of map.values()) clearTimeout(timer);
      map.clear();
    };
  }, []);

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-relevant="additions"
        className="pointer-events-none fixed right-6 bottom-6 z-[60] flex w-[min(380px,calc(100vw-32px))] flex-col items-stretch gap-2"
      >
        <AnimatePresence initial={false}>
          {items.map((item) => (
            <ToastCard key={item.id} item={item} onClose={() => dismiss(item.id)} />
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

const EASE = [0.32, 0.72, 0, 1] as const;

function ToastCard({ item, onClose }: { item: ToastItem; onClose: () => void }) {
  const tone = item.tone ?? "NEUTRAL";
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 6, scale: 0.98, transition: { duration: 0.15, ease: EASE } }}
      transition={{ duration: 0.18, ease: EASE }}
      className="pointer-events-auto flex items-start gap-3 rounded-card bg-surface-0 py-3.5 pr-3 pl-4 shadow-pop ring-1 ring-seam"
    >
      <span className="pt-[7px]">
        {tone === "ERROR" ? (
          <span aria-hidden className="block size-[7px] rounded-full bg-danger-mark" />
        ) : (
          <StatusDot status={tone} size={7} halo={tone !== "NEUTRAL"} />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-small font-medium text-navy">{item.title}</p>
        {item.description ? <div className="mt-0.5 text-small text-ink-2">{item.description}</div> : null}
        {item.action ? (
          <Link
            href={item.action.href}
            onClick={onClose}
            className="mt-2 inline-flex text-small font-medium text-accent hover:text-accent-hover"
          >
            {item.action.label}
          </Link>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Cerrar aviso"
        className={cn(
          "-mt-0.5 grid size-7 shrink-0 place-items-center rounded-full text-ink-3 transition-colors duration-150",
          "hover:bg-surface-2 hover:text-ink-2",
        )}
      >
        <X size={14} strokeWidth={1.75} aria-hidden />
      </button>
    </motion.div>
  );
}

/** Muestra avisos desde cualquier componente cliente bajo `ToastProvider`. */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast necesita <ToastProvider> (va en el layout, dentro de AppShell).");
  return ctx;
}
