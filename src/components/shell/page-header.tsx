import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";
import { Eyebrow } from "@/components/ui/typography";

interface PageHeaderProps {
  eyebrow?: ReactNode;
  /** Frase corta, con punto si es una afirmación: "Registro de decisiones." */
  title: ReactNode;
  description?: ReactNode;
  /** Botones a la derecha, alineados con la base del título. */
  actions?: ReactNode;
  className?: string;
}

/** Cabecera de página: antetítulo, H1 (30px, peso 450), descripción y acciones. */
export function PageHeader({ eyebrow, title, description, actions, className }: PageHeaderProps) {
  return (
    <div className={cn("mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-4", className)}>
      <div className="min-w-0 space-y-2">
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        <h1 className="text-h1 text-navy">{title}</h1>
        {description ? <p className="max-w-[62ch] text-body text-ink-2">{description}</p> : null}
      </div>
      {/* Sin shrink-0: en pantallas angostas las acciones envuelven en vez de desbordar. */}
      {actions ? <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
