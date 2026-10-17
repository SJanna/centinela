import Link from "next/link";
import { Fragment, type ReactNode } from "react";

const INVOICE_ID = /\b(inv_[0-9a-f-]{8,})\b/i;

/** Factura citada en una explicación, ya resuelta en el servidor: su número y su decisión. */
export interface InvoiceRef {
  href: string;
  /** Lo que se lee en la frase: el número de la factura (o el archivo si no tiene número). */
  label: string;
  /** Texto de ayuda: archivo y decisión. */
  title: string;
}

export type InvoiceRefs = Readonly<Record<string, InvoiceRef>>;

/** Ids de factura (inv_…) citados en un texto. */
export function invoiceIdsIn(text: string): string[] {
  return [...text.matchAll(new RegExp(INVOICE_ID.source, "gi"))].map((m) => m[1]);
}

/**
 * "…(factura inv_2833ad95-…)" → "…(factura CM-INV-2026-10-0412)" con enlace a esa decisión.
 * Las explicaciones de duplicados citan la factura anterior por su id; aquí se muestra su número.
 * Sin referencia resuelta, enlaza por el id (/facturas/inv_… también la resuelve).
 */
export function linkInvoiceIds(text: string, refs: InvoiceRefs = {}): ReactNode {
  const parts = text.split(new RegExp(INVOICE_ID.source, "gi"));
  if (parts.length === 1) return text;
  return parts.map((part, i) => {
    if (i % 2 === 0) return <Fragment key={i}>{part}</Fragment>;
    const ref = refs[part.toLowerCase()];
    return (
      <Link
        key={i}
        href={ref?.href ?? `/facturas/${part}`}
        title={ref?.title ?? `Ver la decisión de ${part}`}
        className={
          ref
            ? "rounded-[3px] whitespace-nowrap text-accent underline decoration-accent/30 underline-offset-[3px] transition-colors duration-150 hover:decoration-accent"
            : "font-mono text-[0.88em] tracking-[-0.01em] text-accent underline decoration-accent/30 underline-offset-2 transition-colors duration-150 hover:decoration-accent"
        }
      >
        {ref ? ref.label : `${part.slice(0, 12)}…`}
      </Link>
    );
  });
}
