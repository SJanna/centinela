"use client";

import { motion } from "motion/react";
import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui/cn";
import { NAV_ITEMS, isActivePath } from "./config";

/** Wordmark: "Centinela" en Inter 500 con un punto cobalto, y el subtítulo. */
export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      href="/"
      aria-label="Centinela, agente de pagos. Ir al resumen."
      className="group/wordmark inline-flex items-center rounded-row outline-offset-4"
    >
      {/* Monograma para la barra estrecha. */}
      <span
        aria-hidden
        className={cn(
          "items-baseline text-[20px] leading-none font-medium tracking-[-0.04em] text-navy",
          compact ? "inline-flex" : "inline-flex lg:hidden",
        )}
      >
        C<span className="ml-[2px] inline-block size-[5px] rounded-full bg-accent" />
      </span>
      {!compact ? (
        <span aria-hidden className="hidden flex-col lg:flex">
          <span className="inline-flex items-baseline text-[17px] leading-none font-medium tracking-[-0.03em] text-navy">
            Centinela
            <span className="ml-[2px] inline-block size-[5px] rounded-full bg-accent transition-transform duration-150 ease-out group-hover/wordmark:scale-125" />
          </span>
          <span className="mt-1.5 text-[11.5px] leading-none tracking-[-0.005em] text-muted">Agente de pagos</span>
        </span>
      ) : null}
    </Link>
  );
}

/** Barra lateral: wordmark, navegación principal y una nota fija. Componente cliente por usePathname. */
export function Sidebar() {
  const pathname = usePathname();
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 shrink-0 items-center justify-center px-4 lg:justify-start lg:px-6">
        <Wordmark />
      </div>

      <nav aria-label="Principal" className="mt-4 flex flex-col gap-0.5 px-2.5 lg:px-3">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = isActivePath(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              title={label}
              className={cn(
                "group/nav relative flex h-9 items-center justify-center gap-2.5 rounded-row px-3 text-small font-book transition-colors duration-150 ease-out lg:justify-start",
                active ? "text-navy" : "text-ink-2 hover:bg-[#1c253a0a] hover:text-navy",
              )}
            >
              {active ? (
                <motion.span
                  layoutId="sidebar-active"
                  aria-hidden
                  className="absolute inset-0 rounded-row bg-surface-0 shadow-[0_1px_2px_#1c253a0f,0_6px_14px_-10px_#1c253a40] ring-1 ring-seam/90"
                  transition={{ type: "spring", stiffness: 420, damping: 36 }}
                />
              ) : null}
              <Icon
                aria-hidden
                size={16}
                strokeWidth={1.5}
                className={cn(
                  "relative shrink-0 transition-colors duration-150",
                  active ? "text-accent" : "text-ink-3 group-hover/nav:text-ink-2",
                )}
              />
              <span className="relative hidden lg:inline">{label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto hidden p-4 lg:block">
        <div className="rounded-row border border-line bg-surface-0/60 p-3.5">
          <p className="flex items-center gap-2 text-caption font-medium text-navy">
            <ShieldCheck aria-hidden size={14} strokeWidth={1.5} className="text-ink-3" />
            No mueve dinero.
          </p>
          <p className="mt-1 text-caption text-muted">Lee cada factura, decide y deja registro de por qué.</p>
        </div>
      </div>
    </div>
  );
}
