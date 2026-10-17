"use client";

/**
 * Estado compartido del detalle: qué comprobación o campo está bajo el cursor (hover bidireccional
 * entre "Comprobaciones" y "Datos leídos") y qué pestaña del documento se ve.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { CheckCode } from "@/core/schemas";
import type { FieldKey } from "./fields";

export type DocTab = "document" | "text";

/** Id del panel del documento, destino de "Ver el texto" en la barra de aviso. */
export const DOCUMENT_PANEL_ID = "documento";

interface DetailContextValue {
  activeCheck: CheckCode | null;
  setActiveCheck: (code: CheckCode | null) => void;
  activeField: FieldKey | null;
  setActiveField: (field: FieldKey | null) => void;
  docTab: DocTab;
  setDocTab: (tab: DocTab) => void;
  /** Abre "Texto extraído" y lleva la vista al documento. */
  showExtractedText: () => void;
}

const DetailContext = createContext<DetailContextValue | null>(null);

export function DetailProvider({ children }: { children: ReactNode }) {
  const [activeCheck, setActiveCheck] = useState<CheckCode | null>(null);
  const [activeField, setActiveField] = useState<FieldKey | null>(null);
  const [docTab, setDocTab] = useState<DocTab>("document");

  const showExtractedText = useCallback(() => {
    setDocTab("text");
    const el = document.getElementById(DOCUMENT_PANEL_ID);
    if (el) {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    }
  }, []);

  const value = useMemo(
    () => ({ activeCheck, setActiveCheck, activeField, setActiveField, docTab, setDocTab, showExtractedText }),
    [activeCheck, activeField, docTab, showExtractedText],
  );
  return <DetailContext.Provider value={value}>{children}</DetailContext.Provider>;
}

export function useDetail(): DetailContextValue {
  const ctx = useContext(DetailContext);
  if (!ctx) throw new Error("useDetail necesita <DetailProvider>.");
  return ctx;
}
