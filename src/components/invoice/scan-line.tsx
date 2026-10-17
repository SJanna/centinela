"use client";

/**
 * Escaneo: una línea cobalto en degradado recorre la hoja una vez, mientras aparecen las
 * comprobaciones. Decorativa; con prefers-reduced-motion no se dibuja.
 */
import { motion, useReducedMotion } from "motion/react";

const EASE = [0.32, 0.72, 0, 1] as const;

export function ScanLine({ delay = 0.15, duration = 1.5 }: { delay?: number; duration?: number }) {
  const reduce = useReducedMotion();
  if (reduce) return null;
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
      <motion.span
        className="absolute inset-x-0 h-24 bg-[linear-gradient(180deg,transparent,rgb(42_75_208/0.07)_70%,rgb(42_75_208/0.16))] shadow-[0_2px_0_0_rgb(42_75_208/0.55)]"
        initial={{ top: "-6rem", opacity: 0 }}
        animate={{ top: ["-6rem", "100%"], opacity: [0, 1, 1, 0] }}
        transition={{
          top: { duration, delay, ease: EASE },
          opacity: { duration, delay, times: [0, 0.12, 0.85, 1] },
        }}
      />
    </span>
  );
}
