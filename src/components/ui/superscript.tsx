import { Fragment, type ReactNode } from "react";
import { cn } from "./cn";

/** Ancla de una nota: "nota-2". Úsala en el `id` del destino. */
export function footnoteId(n: number, prefix = "nota"): string {
  return `${prefix}-${n}`;
}

interface SuperscriptProps {
  /** Número o números de nota: 2 → ², [1, 3] → ¹,³ */
  n: number | number[];
  /** Destino del enlace; por defecto `#nota-n`. Con varios números se usa para el primero. */
  href?: string;
  /** Prefijo del ancla (por defecto "nota"). */
  prefix?: string;
  className?: string;
}

/** Superíndice enlazable que remite a una regla o nota, como las notas legales numeradas. */
export function Superscript({ n, href, prefix = "nota", className }: SuperscriptProps) {
  const list = Array.isArray(n) ? n : [n];
  // <sup> y <a> en línea (no inline-flex): el número no se separa de la palabra al cortar la línea.
  // La altura la da el preflight de Tailwind (position: relative; top: -0.5em; line-height: 0).
  return (
    <sup className={cn("ml-[0.08em] text-[0.68em] font-medium", className)}>
      {list.map((num, i) => (
        <Fragment key={num}>
          {i > 0 ? <span className="text-ink-3">,</span> : null}
          <a
            href={i === 0 && href ? href : `#${footnoteId(num, prefix)}`}
            className="tnum rounded-[3px] px-[0.12em] text-accent no-underline decoration-accent/40 underline-offset-2 transition-colors duration-150 hover:bg-accent-wash hover:underline"
            aria-label={`Nota ${num}`}
          >
            {num}
          </a>
        </Fragment>
      ))}
    </sup>
  );
}

interface FootnotesProps {
  items: { n: number; content: ReactNode }[];
  prefix?: string;
  className?: string;
}

/** Lista de notas numeradas, destino de los superíndices. Se resalta la nota enlazada. */
export function Footnotes({ items, prefix = "nota", className }: FootnotesProps) {
  return (
    <ol className={cn("space-y-1.5 text-caption text-muted", className)}>
      {items.map((item) => (
        <li
          key={item.n}
          id={footnoteId(item.n, prefix)}
          className="flex gap-2 rounded-chip px-1.5 py-0.5 -mx-1.5 transition-colors duration-150 target:bg-accent-wash target:text-ink-2"
        >
          <span className="tnum w-3 shrink-0 text-right font-medium text-ink-3">{item.n}</span>
          <span>{item.content}</span>
        </li>
      ))}
    </ol>
  );
}
