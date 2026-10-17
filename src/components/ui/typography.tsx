import type { ElementType, ReactNode } from "react";
import { cn } from "./cn";

interface EyebrowProps {
  children: ReactNode;
  /** Etiqueta HTML (por defecto `p`). */
  as?: ElementType;
  className?: string;
  id?: string;
}

/** Antetítulo: 11px, mayúsculas, peso 500, +0.1em, en gris muted. */
export function Eyebrow({ children, as: Tag = "p", className, id }: EyebrowProps) {
  return (
    <Tag id={id} className={cn("eyebrow", className)}>
      {children}
    </Tag>
  );
}

interface MonoProps {
  children: ReactNode;
  className?: string;
  /** Texto completo al pasar el cursor (p. ej. la cuenta sin enmascarar no; el ID completo sí). */
  title?: string;
}

/** Geist Mono para IDs, cuentas (•••• 4821) y códigos de regla. */
export function Mono({ children, className, title }: MonoProps) {
  return (
    <span title={title} className={cn("font-mono text-[0.92em] tracking-[-0.01em] tnum", className)}>
      {children}
    </span>
  );
}

/** Enmascara una cuenta bancaria: "0012-3456-7890" → "•••• 7890" (con espacio de no separación). */
export function maskAccount(account: string, visible = 4): string {
  const clean = account.replace(/[^A-Za-z0-9]/g, "");
  if (clean.length <= visible) return clean;
  return `••••\u00a0${clean.slice(-visible)}`;
}
