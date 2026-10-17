"use client";

import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { useEffect, useRef, useSyncExternalStore, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/components/ui/cn";

const EASE = [0.32, 0.72, 0, 1] as const;
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const subscribeNoop = () => () => {};
/** true en el navegador una vez hidratado (el portal necesita document.body). */
function useIsClient(): boolean {
  return useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
}

/** Foco al abrir (al elemento con data-autofocus o al primero), Tab atrapado dentro, foco de vuelta al cerrar. */
function useDialogFocus(open: boolean, ref: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const root = document.documentElement;
    const prevOverflow = root.style.overflow;
    root.style.overflow = "hidden";
    const raf = requestAnimationFrame(() => {
      const node = ref.current;
      if (!node) return;
      const target = node.querySelector<HTMLElement>("[data-autofocus]") ?? node.querySelector<HTMLElement>(FOCUSABLE);
      (target ?? node).focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(raf);
      root.style.overflow = prevOverflow;
      previous?.focus?.({ preventScroll: true });
    };
  }, [open, ref]);
}

function trapTab(e: KeyboardEvent<HTMLDivElement>, onClose: () => void) {
  if (e.key === "Escape") {
    e.stopPropagation();
    onClose();
    return;
  }
  if (e.key !== "Tab") return;
  const nodes = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => n.offsetParent !== null);
  if (nodes.length === 0) return;
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

interface OverlayProps {
  open: boolean;
  onClose: () => void;
  /** id del título (aria-labelledby). */
  labelledBy: string;
  describedBy?: string;
  children: ReactNode;
  className?: string;
}

function Backdrop({ onClose }: { onClose: () => void }) {
  return (
    <motion.div
      aria-hidden
      onClick={onClose}
      className="fixed inset-0 bg-[rgb(17_22_34/0.22)] backdrop-blur-[2px]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: EASE }}
    />
  );
}

/** Panel lateral derecho para formularios largos (crear o editar). */
export function SidePanel({ open, onClose, labelledBy, describedBy, children, className }: OverlayProps) {
  const ref = useRef<HTMLDivElement>(null);
  const isClient = useIsClient();
  useDialogFocus(open, ref);
  if (!isClient) return null;
  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[55]">
          <Backdrop onClose={onClose} />
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelledBy}
            aria-describedby={describedBy}
            tabIndex={-1}
            onKeyDown={(e) => trapTab(e, onClose)}
            className={cn(
              "absolute inset-y-2 right-2 flex w-[min(600px,calc(100vw-16px))] flex-col overflow-clip rounded-panel bg-paper shadow-modal outline-none",
              className,
            )}
            initial={{ x: 48, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 32, opacity: 0, transition: { duration: 0.16, ease: EASE } }}
            transition={{ duration: 0.24, ease: EASE }}
          >
            {children}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

/** Diálogo centrado para confirmar o para tareas cortas (importar). */
export function Modal({ open, onClose, labelledBy, describedBy, children, className }: OverlayProps) {
  const ref = useRef<HTMLDivElement>(null);
  const isClient = useIsClient();
  useDialogFocus(open, ref);
  if (!isClient) return null;
  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[55] grid place-items-center overflow-y-auto p-4">
          <Backdrop onClose={onClose} />
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelledBy}
            aria-describedby={describedBy}
            tabIndex={-1}
            onKeyDown={(e) => trapTab(e, onClose)}
            className={cn("relative w-full max-w-[480px] rounded-panel bg-surface-0 shadow-modal outline-none", className)}
            initial={{ y: 10, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 6, opacity: 0, scale: 0.98, transition: { duration: 0.14, ease: EASE } }}
            transition={{ duration: 0.2, ease: EASE }}
          >
            {children}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

/** Botón redondo para cerrar un panel o diálogo. */
export function CloseButton({ onClick, label = "Cerrar" }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="grid size-8 shrink-0 place-items-center rounded-full text-ink-3 transition-colors duration-150 hover:bg-surface-2 hover:text-ink-2"
    >
      <X aria-hidden size={16} strokeWidth={1.75} />
    </button>
  );
}
