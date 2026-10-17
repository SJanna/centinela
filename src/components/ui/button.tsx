import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "./cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "md" | "sm";
/** "next" = → (avanzar) · "external" = ↗ (abre o sube algo). */
export type ButtonArrow = "next" | "external";

interface CommonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  arrow?: ButtonArrow;
  /** Icono a la izquierda del texto (lucide, 16px). */
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}

type ButtonAsButton = CommonProps &
  Omit<ComponentPropsWithoutRef<"button">, keyof CommonProps> & { href?: undefined };

type ButtonAsLink = CommonProps &
  Omit<ComponentPropsWithoutRef<"a">, keyof CommonProps | "href" | "download"> & {
    href: string;
    /** Abre en otra pestaña (añade rel="noreferrer"). Se ignora si hay `download`. */
    external?: boolean;
    /**
     * Descarga el archivo en vez de abrirlo: `<a download>` simple (sin next/link ni otra pestaña).
     * `true` usa el nombre que dé el servidor; un texto fija el nombre del archivo.
     */
    download?: boolean | string;
  };

export type ButtonProps = ButtonAsButton | ButtonAsLink;

const BASE =
  "group/button inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-pill font-medium " +
  "transition-[background-color,box-shadow,color,translate] duration-[180ms] ease-out " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent " +
  "active:translate-y-px disabled:pointer-events-none disabled:opacity-45 aria-disabled:pointer-events-none aria-disabled:opacity-45";

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-white shadow-[0_1px_2px_#1c253a1f,inset_0_1px_0_#ffffff26] hover:bg-accent-hover hover:shadow-[0_6px_16px_-6px_#2a4bd080,inset_0_1px_0_#ffffff26]",
  secondary:
    "bg-surface-0 text-navy shadow-[0_1px_2px_#1c253a0f] ring-1 ring-seam ring-inset hover:bg-white hover:ring-[#d5d9e5]",
  ghost: "bg-transparent text-ink-2 hover:bg-[#1c253a0d] hover:text-navy",
  danger:
    "bg-danger-wash text-danger shadow-[0_1px_2px_#1c253a0f] ring-1 ring-danger/20 ring-inset hover:bg-[#f6dfe1] hover:ring-danger/35",
};

const SIZE: Record<ButtonSize, string> = {
  md: "h-10 px-5 text-body",
  sm: "h-8 px-3.5 text-small gap-1.5",
};

const ICON_SIZE: Record<ButtonSize, number> = { md: 16, sm: 14 };

function Arrow({ kind, size }: { kind: ButtonArrow; size: ButtonSize }) {
  const Icon = kind === "external" ? ArrowUpRight : ArrowRight;
  const motionClass =
    kind === "external"
      ? "group-hover/button:translate-x-0.5 group-hover/button:-translate-y-0.5"
      : "group-hover/button:translate-x-0.5";
  return (
    <Icon
      aria-hidden
      size={ICON_SIZE[size]}
      strokeWidth={1.75}
      className={cn("-mr-0.5 transition-[translate] duration-[180ms] ease-out", motionClass)}
    />
  );
}

/**
 * Botón en píldora. Primario cobalto, secundario blanco con borde, fantasma o de peligro (rojo lavado,
 * para acciones que borran o descartan).
 * Con `href` se vuelve un enlace (next/link si es interno); con `href` y `download`, un `<a download>`.
 */
export function Button({ variant = "primary", size = "md", arrow, icon, className, children, ...rest }: ButtonProps) {
  const classes = cn(BASE, VARIANT[variant], SIZE[size], className);
  const content = (
    <>
      {icon ? (
        <span aria-hidden className="-ml-0.5 inline-flex [&_svg]:size-4 [&_svg]:stroke-[1.5]">
          {icon}
        </span>
      ) : null}
      <span>{children}</span>
      {arrow ? <Arrow kind={arrow} size={size} /> : null}
    </>
  );

  if (rest.href !== undefined) {
    const { href, external, download, ...anchorProps } = rest;
    if (download !== undefined && download !== false) {
      return (
        <a href={href} download={download === true ? "" : download} className={classes} {...anchorProps}>
          {content}
        </a>
      );
    }
    const isExternal = external ?? /^https?:\/\//.test(href);
    if (isExternal) {
      return (
        <a href={href} target="_blank" rel="noreferrer" className={classes} {...anchorProps}>
          {content}
        </a>
      );
    }
    return (
      <Link href={href} className={classes} {...anchorProps}>
        {content}
      </Link>
    );
  }

  const { type, ...buttonProps } = rest;
  return (
    <button type={type ?? "button"} className={classes} {...buttonProps}>
      {content}
    </button>
  );
}
