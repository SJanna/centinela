"use client";

import { MotionConfig } from "motion/react";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ToastProvider } from "@/components/ui/toast";
import { isBareRoute } from "./config";

/** Proveedores de cliente del armazón: movimiento según prefers-reduced-motion y avisos. */
export function ShellProviders({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <ToastProvider>{children}</ToastProvider>
    </MotionConfig>
  );
}

interface ShellFrameProps {
  sidebar: ReactNode;
  header: ReactNode;
  footer: ReactNode;
  children: ReactNode;
}

/**
 * Distribución: barra lateral de 240px (64px bajo 1024) y columna con header fijo, contenido
 * (máximo 1280px, margen de 32px) y pie. Las rutas de BARE_ROUTES se muestran sin armazón.
 */
export function ShellFrame({ sidebar, header, footer, children }: ShellFrameProps) {
  const pathname = usePathname();
  if (isBareRoute(pathname)) return <>{children}</>;
  return (
    <div className="flex min-h-dvh">
      <a
        href="#contenido"
        className="sr-only z-[70] rounded-pill bg-surface-0 px-4 py-2 text-small font-medium text-navy shadow-pop focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Saltar al contenido
      </a>
      <aside className="sticky top-0 z-40 h-dvh w-16 shrink-0 border-r border-line lg:w-60">{sidebar}</aside>
      <div className="flex min-w-0 flex-1 flex-col">
        {header}
        <main id="contenido" tabIndex={-1} className="mx-auto w-full max-w-[1280px] flex-1 px-8 pt-8 pb-12 outline-none">
          {children}
        </main>
        {footer}
      </div>
    </div>
  );
}
