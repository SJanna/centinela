import { cn } from "./cn";

/** Palabras que no aportan iniciales: sufijos societarios y conectores. */
const SKIP = new Set([
  "sas",
  "sa",
  "s",
  "de",
  "del",
  "la",
  "las",
  "el",
  "los",
  "y",
  "e",
  "rl",
  "cv",
  "srl",
  "spa",
  "sac",
  "ltda",
  "ltd",
  "llc",
  "inc",
  "corp",
  "co",
  "eireli",
  "me",
  "the",
  "and",
]);

/** Iniciales de un nombre: "Andina Logística S.A.S." → "AL"; "CloudMetrics Inc." → "CM". */
export function initialsOf(name: string | null | undefined): string {
  if (!name) return "?";
  const words = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !SKIP.has(w.toLowerCase()));
  if (words.length === 0) return name.trim().slice(0, 2).toUpperCase() || "?";
  if (words.length === 1) {
    const w = words[0];
    // "CloudMetrics" → "CM" si tiene mayúscula interna.
    const inner = w.slice(1).search(/[A-Z]/);
    return (inner >= 0 ? w[0] + w[inner + 1] : w.slice(0, 2)).toUpperCase();
  }
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** Tonos discretos; el mismo nombre siempre cae en el mismo tono. */
const TONES = [
  "bg-accent-wash text-accent",
  "bg-[#E3EEE8] text-[#2F5D4A]",
  "bg-[#F3ECDF] text-[#7A5A2A]",
  "bg-surface-3 text-ink-2",
  "bg-[#EEE9F5] text-[#5B4A86]",
  "bg-[#E6EEF4] text-[#2F5470]",
] as const;

function toneOf(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return TONES[h % TONES.length];
}

interface AvatarProps {
  name: string | null | undefined;
  /** Diámetro en px: 24, 32 (por defecto) o 40. */
  size?: 24 | 32 | 40;
  /** "circle" para personas; "square" (radio 10) para empresas y proveedores. */
  shape?: "circle" | "square";
  className?: string;
}

const TEXT_SIZE: Record<NonNullable<AvatarProps["size"]>, string> = {
  24: "text-[10px]",
  32: "text-[12px]",
  40: "text-[14px]",
};

/** Avatar con iniciales. */
export function Avatar({ name, size = 32, shape = "square", className }: AvatarProps) {
  const label = name ?? "Sin nombre";
  return (
    <span
      aria-hidden
      title={label}
      className={cn(
        "inline-grid shrink-0 place-items-center font-medium tracking-[-0.01em] select-none",
        shape === "circle" ? "rounded-full" : size === 24 ? "rounded-[7px]" : "rounded-[10px]",
        TEXT_SIZE[size],
        toneOf(label),
        className,
      )}
      style={{ width: size, height: size }}
    >
      {initialsOf(name)}
    </span>
  );
}
