"use client";

/**
 * Capas del resumen: panel lateral y diálogo de confirmación.
 * Escape cierra, el foco queda dentro mientras están abiertos y vuelve al disparador al cerrar.
 */
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { useEffect, useId, useRef, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";

const EASE = [0.32, 0.72, 0, 1] as const;
const subscribeNoop = () => () => {};

/** true solo en el cliente, ya hidratado (los portales necesitan `document`). */
function useIsClient(): boolean {
  return useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Capas abiertas, de abajo arriba: solo la de arriba responde a Escape y Tab. */
const openLayers: symbol[] = [];

/** Escape para cerrar, Tab atrapado dentro, foco inicial y foco de vuelta al cerrar. */
function useModalBehavior(open: boolean, panel: RefObject<HTMLElement | null>, onClose: () => void, lockScroll: boolean) {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const layer = Symbol("capa");
    openLayers.push(layer);
    const previous = document.activeElement as HTMLElement | null;
    const node = panel.current;
    const first = node?.querySelector<HTMLElement>("[data-autofocus]") ?? node?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? node)?.focus({ preventScroll: true });

    function onKey(e: KeyboardEvent) {
      if (openLayers[openLayers.length - 1] !== layer) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !panel.current) return;
      const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstItem) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && document.activeElement === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    if (lockScroll) document.body.style.overflow = "hidden";
    return () => {
      const index = openLayers.indexOf(layer);
      if (index >= 0) openLayers.splice(index, 1);
      document.removeEventListener("keydown", onKey);
      if (lockScroll) document.body.style.overflow = overflow;
      if (previous && document.contains(previous)) previous.focus({ preventScroll: true });
    };
  }, [open, panel, lockScroll]);
}

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  /** Pie fijo (acciones). */
  footer?: ReactNode;
  className?: string;
}

/** Panel lateral derecho sobre el papel, con fondo atenuado. */
export function Drawer({ open, onClose, title, eyebrow, description, children, footer, className }: DrawerProps) {
  const isClient = useIsClient();
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useModalBehavior(open, panel, onClose, true);
  if (!isClient) return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[80]">
          <motion.div
            aria-hidden
            className="absolute inset-0 bg-[#111622]/20 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: EASE }}
            onClick={onClose}
          />
          <motion.div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            className={cn(
              "absolute inset-y-0 right-0 flex w-[min(540px,100vw)] flex-col bg-paper shadow-modal outline-none sm:inset-y-2 sm:right-2 sm:rounded-panel",
              className,
            )}
            initial={{ x: "104%" }}
            animate={{ x: 0 }}
            exit={{ x: "104%" }}
            transition={{ type: "spring", stiffness: 380, damping: 38 }}
          >
            <header className="flex shrink-0 items-start justify-between gap-4 border-b border-line px-6 pt-6 pb-5">
              <div className="min-w-0 space-y-1.5">
                {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
                <h2 id={titleId} className="text-h2 text-navy">
                  {title}
                </h2>
                {description ? <div className="max-w-[52ch] text-small text-ink-2">{description}</div> : null}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Cerrar panel"
                className="-mt-1 -mr-2 grid size-8 shrink-0 place-items-center rounded-full text-ink-3 transition-colors duration-150 hover:bg-[#1c253a0d] hover:text-navy"
              >
                <X aria-hidden size={16} strokeWidth={1.75} />
              </button>
            </header>
            <div className="scrollbar-quiet min-h-0 flex-1 overflow-y-auto px-6">{children}</div>
            {footer ? <div className="shrink-0 border-t border-line px-6 py-4">{footer}</div> : null}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  /** Texto del botón mientras se ejecuta. */
  busyLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Diálogo de confirmación centrado. Va por encima del panel lateral. */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  busyLabel,
  cancelLabel = "Cancelar",
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const isClient = useIsClient();
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  const close = () => {
    if (!busy) onCancel();
  };
  useModalBehavior(open, panel, close, false);
  if (!isClient) return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[90] grid place-items-center p-4">
          <motion.div
            aria-hidden
            className="absolute inset-0 bg-[#111622]/25 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16, ease: EASE }}
            onClick={close}
          />
          <motion.div
            ref={panel}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={description ? descId : undefined}
            tabIndex={-1}
            className="relative w-[min(440px,100%)] rounded-panel bg-surface-0 p-6 shadow-modal outline-none"
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: 0.18, ease: EASE }}
          >
            <h2 id={titleId} className="text-h2 text-navy">
              {title}
            </h2>
            {description ? (
              <div id={descId} className="mt-2 text-small text-ink-2">
                {description}
              </div>
            ) : null}
            <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={close} disabled={busy} data-autofocus>
                {cancelLabel}
              </Button>
              <Button size="sm" onClick={onConfirm} disabled={busy}>
                {busy && busyLabel ? busyLabel : confirmLabel}
              </Button>
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
