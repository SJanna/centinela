"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MouseEvent } from "react";

interface NavigationLike {
  canGoBack?: boolean;
  currentEntry?: { index: number } | null;
  entries?: () => { url: string | null }[];
}

/** true si la entrada anterior del historial es una pantalla de la app (mismo origen). */
function previousIsInApp(): boolean {
  const nav = (window as unknown as { navigation?: NavigationLike }).navigation;
  if (nav?.canGoBack && nav.currentEntry && nav.entries) {
    const prev = nav.entries()[nav.currentEntry.index - 1]?.url;
    if (prev) {
      try {
        return new URL(prev).origin === window.location.origin;
      } catch {
        return false;
      }
    }
  }
  try {
    return document.referrer !== "" && new URL(document.referrer).origin === window.location.origin && window.history.length > 1;
  } catch {
    return false;
  }
}

/**
 * Vuelve a la pantalla de la que se vino (el tablero del resumen o el registro), con su scroll.
 * Si se llegó por un enlace directo, lleva al resumen.
 */
export function BackLink() {
  const router = useRouter();

  function onClick(e: MouseEvent<HTMLAnchorElement>) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (!previousIsInApp()) return;
    e.preventDefault();
    router.back();
  }

  return (
    <Link
      href="/"
      onClick={onClick}
      className="group -ml-2 inline-flex h-8 items-center gap-1.5 rounded-pill px-2 text-small text-ink-2 transition-colors duration-150 hover:bg-[#1c253a0d] hover:text-navy focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
    >
      <ArrowLeft aria-hidden size={15} strokeWidth={1.75} className="transition-transform duration-150 ease-out group-hover:-translate-x-0.5" />
      Volver
    </Link>
  );
}
