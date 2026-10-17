import { cn } from "./cn";

/** Monedas sin decimales en el uso diario. El resto se muestra con 2. */
const ZERO_DECIMALS = new Set(["CLP", "JPY", "KRW", "PYG"]);

const SYMBOL: Record<string, string> = {
  USD: "$",
  COP: "$",
  MXN: "$",
  ARS: "$",
  CLP: "$",
  BRL: "R$",
  PEN: "S/",
  EUR: "€",
};

const formatters = new Map<number, Intl.NumberFormat>();
function formatterFor(digits: number): Intl.NumberFormat {
  let f = formatters.get(digits);
  if (!f) {
    f = new Intl.NumberFormat("es-CO", { minimumFractionDigits: digits, maximumFractionDigits: digits });
    formatters.set(digits, f);
  }
  return f;
}

export interface MoneyParts {
  /** "−", "+" o "". */
  sign: string;
  /** Parte entera con separador de miles: "12.000". */
  integer: string;
  /** Separador y decimales: ",50" (vacío si la moneda no usa decimales). */
  fraction: string;
  symbol: string;
  code: string;
}

/** Divide un monto en partes para mostrarlo con los centavos atenuados (formato es-CO). */
export function moneyParts(amount: number, currency = "USD", signDisplay: "auto" | "always" = "auto"): MoneyParts {
  const code = currency.toUpperCase();
  const digits = ZERO_DECIMALS.has(code) ? 0 : 2;
  const parts = formatterFor(digits).formatToParts(Math.abs(amount));
  let integer = "";
  let fraction = "";
  for (const p of parts) {
    if (p.type === "integer" || p.type === "group") integer += p.value;
    else if (p.type === "decimal" || p.type === "fraction") fraction += p.value;
  }
  const rounded = Number(amount.toFixed(digits));
  const sign = rounded < 0 ? "−" : signDisplay === "always" && rounded > 0 ? "+" : "";
  return { sign, integer, fraction, symbol: SYMBOL[code] ?? "", code };
}

/** Texto plano para toasts, títulos y aria-label: "12.000.000,00 COP". */
export function formatMoneyText(amount: number, currency = "USD"): string {
  const p = moneyParts(amount, currency);
  return `${p.sign}${p.integer}${p.fraction} ${p.code}`;
}

export type MoneySize = "sm" | "md" | "lg" | "xl" | "kpi" | "display";
/** "code": 1.200,00 USD · "symbol": $1.200,00 · "both": $1.200,00 USD · "none": 1.200,00 */
export type MoneyDisplay = "code" | "symbol" | "both" | "none";

/** Clases por tamaño: cifra, centavos atenuados y código de moneda. */
export const MONEY_SIZE: Record<MoneySize, { root: string; fraction: string; code: string }> = {
  sm: { root: "text-small font-medium tracking-[-0.01em]", fraction: "text-ink-3", code: "ml-1 text-[0.85em] font-medium text-ink-3" },
  md: { root: "text-body font-medium tracking-[-0.015em]", fraction: "text-ink-3", code: "ml-1 text-[0.82em] font-medium text-ink-3" },
  lg: {
    root: "text-[17px] leading-tight font-medium tracking-[-0.025em]",
    fraction: "text-[0.72em] text-ink-3",
    code: "ml-1.5 text-[0.62em] font-medium tracking-normal text-ink-3",
  },
  xl: {
    root: "text-[24px] leading-[1.1] font-book tracking-[-0.04em]",
    fraction: "text-[0.7em] text-ink-3",
    code: "ml-1.5 text-[0.5em] font-medium tracking-normal text-ink-3",
  },
  kpi: {
    root: "text-kpi",
    fraction: "text-[0.6875em] text-ink-3", // 22px sobre 32
    code: "ml-2 text-[0.4em] font-medium tracking-normal text-ink-3",
  },
  display: {
    root: "text-display",
    fraction: "text-[0.7em] text-ink-3",
    code: "ml-2 text-[0.34em] font-medium tracking-normal text-ink-3",
  },
};

interface MoneyProps {
  amount: number | null | undefined;
  /** Código ISO 4217. Por defecto USD. */
  currency?: string | null;
  size?: MoneySize;
  display?: MoneyDisplay;
  /** "always" antepone + a los positivos (entradas). */
  signDisplay?: "auto" | "always";
  className?: string;
}

/**
 * Monto con cifras tabulares y centavos atenuados, en formato es-CO: 12.000.000,00 COP.
 * Si no hay monto muestra una raya.
 */
export function Money({ amount, currency, size = "md", display = "code", signDisplay = "auto", className }: MoneyProps) {
  const s = MONEY_SIZE[size];
  if (amount == null || !Number.isFinite(amount)) {
    return (
      <span className={cn("tnum text-ink-3", s.root, className)} aria-label="Sin monto">
        —
      </span>
    );
  }
  const p = moneyParts(amount, currency ?? "USD", signDisplay);
  const showSymbol = (display === "symbol" || display === "both") && p.symbol !== "";
  const showCode = display === "code" || display === "both" || (display === "symbol" && p.symbol === "");
  return (
    <span className={cn("tnum inline-flex items-baseline whitespace-nowrap", s.root, className)}>
      {p.sign ? <span>{p.sign}</span> : null}
      {showSymbol ? <span>{p.symbol}</span> : null}
      <span>{p.integer}</span>
      {p.fraction ? <span className={s.fraction}>{p.fraction}</span> : null}
      {showCode ? <span className={s.code}>{p.code}</span> : null}
    </span>
  );
}

const percentFormatter = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 1 });

interface PercentProps {
  /** Proporción entre 0 y 1. */
  value: number | null | undefined;
  size?: MoneySize;
  className?: string;
}

/** Porcentaje con el signo atenuado, como los centavos: 83 %. */
export function Percent({ value, size = "md", className }: PercentProps) {
  const s = MONEY_SIZE[size];
  if (value == null || !Number.isFinite(value)) {
    return <span className={cn("tnum text-ink-3", s.root, className)}>—</span>;
  }
  return (
    <span className={cn("tnum inline-flex items-baseline whitespace-nowrap", s.root, className)}>
      <span>{percentFormatter.format(value * 100)}</span>
      <span className={cn(s.fraction, "ml-[0.08em]")}>%</span>
    </span>
  );
}
