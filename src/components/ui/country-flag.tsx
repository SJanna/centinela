import type { ReactNode } from "react";
import { cn } from "./cn";

/** Nombres en español de los países con bandera propia. */
export const COUNTRY_NAME: Record<string, string> = {
  CO: "Colombia",
  MX: "México",
  BR: "Brasil",
  US: "Estados Unidos",
  PE: "Perú",
  AR: "Argentina",
  CL: "Chile",
};

/** Banderas simplificadas, dibujadas a mano en un cuadro de 24×24 (el círculo lo pone el contenedor). */
const FLAGS: Record<string, ReactNode> = {
  CO: (
    <>
      <rect width="24" height="12" fill="#FCD116" />
      <rect y="12" width="24" height="6" fill="#003893" />
      <rect y="18" width="24" height="6" fill="#CE1126" />
    </>
  ),
  MX: (
    <>
      <rect width="8" height="24" fill="#006847" />
      <rect x="8" width="8" height="24" fill="#FFFFFF" />
      <rect x="16" width="8" height="24" fill="#CE1126" />
      <circle cx="12" cy="12" r="2.3" fill="#9B6B34" />
      <path d="M9.9 13.4c1.2 1.1 3 1.1 4.2 0" stroke="#3D7A3A" strokeWidth="0.8" fill="none" strokeLinecap="round" />
    </>
  ),
  BR: (
    <>
      <rect width="24" height="24" fill="#009C3B" />
      <path d="M12 3.6 21.2 12 12 20.4 2.8 12Z" fill="#FEDF00" />
      <circle cx="12" cy="12" r="4.9" fill="#002776" />
      <path d="M7.4 11.1c3.1-0.9 6.4-0.5 9.3 1.3" stroke="#FFFFFF" strokeWidth="1" fill="none" />
    </>
  ),
  US: (
    <>
      <rect width="24" height="24" fill="#FFFFFF" />
      {[0, 2, 4, 6].map((i) => (
        <rect key={i} y={(i * 24) / 7} width="24" height={24 / 7} fill="#B22234" />
      ))}
      <rect width="11.5" height={(24 / 7) * 4} fill="#3C3B6E" />
      {[
        [3, 3],
        [6, 3],
        [9, 3],
        [4.5, 6],
        [7.5, 6],
        [3, 9],
        [6, 9],
        [9, 9],
        [4.5, 12],
        [7.5, 12],
      ].map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="0.6" fill="#FFFFFF" />
      ))}
    </>
  ),
  PE: (
    <>
      <rect width="8" height="24" fill="#D91023" />
      <rect x="8" width="8" height="24" fill="#FFFFFF" />
      <rect x="16" width="8" height="24" fill="#D91023" />
    </>
  ),
  AR: (
    <>
      <rect width="24" height="8" fill="#74ACDF" />
      <rect y="8" width="24" height="8" fill="#FFFFFF" />
      <rect y="16" width="24" height="8" fill="#74ACDF" />
      <circle cx="12" cy="12" r="2" fill="#F6B40E" />
      <circle cx="12" cy="12" r="2.9" fill="none" stroke="#F6B40E" strokeWidth="0.5" strokeDasharray="0.7 0.7" />
    </>
  ),
  CL: (
    <>
      <rect width="24" height="12" fill="#FFFFFF" />
      <rect y="12" width="24" height="12" fill="#D52B1E" />
      <rect width="10" height="12" fill="#0039A6" />
      <polygon
        points="5.00,3.30 5.63,5.13 7.57,5.17 6.03,6.33 6.59,8.18 5.00,7.08 3.41,8.18 3.97,6.33 2.43,5.17 4.37,5.13"
        fill="#FFFFFF"
      />
    </>
  ),
};

const GENERIC = (
  <>
    <rect width="24" height="24" fill="#E9ECF2" />
    <g fill="none" stroke="#8D969E" strokeWidth="1">
      <circle cx="12" cy="12" r="6.5" />
      <ellipse cx="12" cy="12" rx="2.8" ry="6.5" />
      <path d="M5.5 12h13" />
    </g>
  </>
);

interface CountryFlagProps {
  /** Código ISO 3166-1 alfa-2 (CO, MX, BR, US, PE, AR, CL). Otros muestran un globo. */
  country: string | null | undefined;
  /** Diámetro en px (16 por defecto). */
  size?: number;
  /** Si es false, la bandera es decorativa (aria-hidden). */
  labelled?: boolean;
  className?: string;
}

/** Bandera circular en SVG, sin emojis. */
export function CountryFlag({ country, size = 16, labelled = true, className }: CountryFlagProps) {
  const code = (country ?? "").toUpperCase();
  const art = FLAGS[code] ?? GENERIC;
  const name = COUNTRY_NAME[code] ?? (code || "País desconocido");
  return (
    <span
      className={cn(
        "relative inline-block shrink-0 overflow-hidden rounded-full align-middle",
        "after:absolute after:inset-0 after:rounded-full after:shadow-[inset_0_0_0_1px_#1c253a24] after:content-['']",
        className,
      )}
      style={{ width: size, height: size }}
      role={labelled ? "img" : undefined}
      aria-label={labelled ? name : undefined}
      aria-hidden={labelled ? undefined : true}
      title={labelled ? name : undefined}
    >
      <svg viewBox="0 0 24 24" width={size} height={size} className="block" aria-hidden focusable="false">
        {art}
      </svg>
    </span>
  );
}

interface CountryChipProps {
  country: string | null | undefined;
  currency?: string | null;
  /** Muestra el nombre del país ("México · MXN"); si es false, solo el código ("MX · MXN"). */
  showName?: boolean;
  className?: string;
}

/** Chip con bandera, país y moneda. Radio 6. */
export function CountryChip({ country, currency, showName = true, className }: CountryChipProps) {
  const code = (country ?? "").toUpperCase();
  const name = showName ? (COUNTRY_NAME[code] ?? code) : code;
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-chip bg-surface-2 pr-2 pl-1 text-caption font-medium whitespace-nowrap text-ink-2",
        className,
      )}
    >
      <CountryFlag country={code} size={14} labelled={false} />
      <span>{name || "—"}</span>
      {currency ? (
        <>
          <span aria-hidden className="text-faint">
            ·
          </span>
          <span className="font-mono text-[11px] tracking-[0.02em] text-ink-2">{currency.toUpperCase()}</span>
        </>
      ) : null}
    </span>
  );
}
