"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { HEADER_ACTIONS_ID, HEADER_CRUMBS_ID, sectionFor } from "./config";

const subscribeNoop = () => () => {};

/** El nodo del header con ese id (null en el servidor y durante la hidratación). */
function useSlot(id: string): HTMLElement | null {
  return useSyncExternalStore(
    subscribeNoop,
    () => document.getElementById(id),
    () => null,
  );
}

/**
 * Pone acciones de la página en el header (a la derecha, tras los chips).
 * Úsalo dentro de una página: <HeaderActions><Button …>Subir facturas</Button></HeaderActions>.
 * Aparece al hidratar; para acciones críticas usa también PageHeader.
 */
export function HeaderActions({ children }: { children: ReactNode }) {
  const slot = useSlot(HEADER_ACTIONS_ID);
  return slot ? createPortal(children, slot) : null;
}

/**
 * Añade una miga tras la sección: "Andes Labs Inc. / Registro / FAC-2026-0142".
 * Úsalo dentro de una página de detalle: <HeaderCrumb>FAC-2026-0142</HeaderCrumb>.
 */
export function HeaderCrumb({ children }: { children: ReactNode }) {
  const slot = useSlot(HEADER_CRUMBS_ID);
  if (!slot) return null;
  return createPortal(
    <>
      <CrumbSeparator />
      <span aria-current="page" className="min-w-0 truncate font-mono text-[12.5px] text-ink-2">
        {children}
      </span>
    </>,
    slot,
  );
}

export function CrumbSeparator() {
  return (
    <span aria-hidden className="text-faint select-none">
      /
    </span>
  );
}

/** La sección actual según la ruta. Enlaza a la sección si estamos en una subpágina. */
export function SectionCrumb() {
  const pathname = usePathname();
  const section = sectionFor(pathname);
  if (!section) return null;
  const isSectionRoot = pathname === section.href;
  return (
    <>
      <CrumbSeparator />
      {isSectionRoot ? (
        <span aria-current="page" className="truncate font-medium text-navy">
          {section.label}
        </span>
      ) : (
        <Link href={section.href} className="truncate text-ink-2 transition-colors duration-150 hover:text-navy">
          {section.label}
        </Link>
      )}
    </>
  );
}
