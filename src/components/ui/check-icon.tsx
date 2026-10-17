"use client";

import { motion, useReducedMotion } from "motion/react";
import { cn } from "./cn";

/** pass = ✓ (cumple) · fail = ✗ (frena) · warn = ! (escala o no se pudo evaluar) · pending = aún sin resultado. */
export type CheckIconStatus = "pass" | "fail" | "warn" | "pending";

/** Traduce una comprobación del motor al icono: fail que frena → ✗; fail que escala o not_evaluable → !. */
export function checkIconStatus(status: "pass" | "fail" | "not_evaluable", outcomeIfFail: "FRENAR" | "ESCALAR"): CheckIconStatus {
  if (status === "pass") return "pass";
  if (status === "not_evaluable") return "warn";
  return outcomeIfFail === "FRENAR" ? "fail" : "warn";
}

const LABEL: Record<CheckIconStatus, string> = {
  pass: "Cumple",
  fail: "No cumple",
  warn: "Requiere revisión",
  pending: "Pendiente",
};

const STYLE: Record<CheckIconStatus, { circle: string; stroke: string }> = {
  pass: { circle: "bg-pay-wash ring-pay-mark/25", stroke: "text-pay-mark" },
  fail: { circle: "bg-hold-wash ring-hold-mark/25", stroke: "text-hold-mark" },
  warn: { circle: "bg-escalate-wash ring-escalate-mark/25", stroke: "text-escalate-mark" },
  pending: { circle: "bg-transparent ring-faint", stroke: "text-faint" },
};

const SOLID: Record<CheckIconStatus, { circle: string; stroke: string }> = {
  pass: { circle: "bg-pay-mark ring-transparent", stroke: "text-white" },
  fail: { circle: "bg-hold-mark ring-transparent", stroke: "text-white" },
  warn: { circle: "bg-escalate-mark ring-transparent", stroke: "text-white" },
  pending: { circle: "bg-transparent ring-faint", stroke: "text-faint" },
};

interface CheckIconProps {
  status: CheckIconStatus;
  /** Dibuja el trazo al aparecer (pathLength). Se omite con prefers-reduced-motion. */
  animate?: boolean;
  /** Retraso en segundos, para escalonar una lista (p. ej. i * 0.12). */
  delay?: number;
  /** Diámetro en px (20 por defecto). */
  size?: number;
  /** "soft": fondo lavado y trazo de color (por defecto) · "solid": círculo lleno y trazo blanco. */
  variant?: "soft" | "solid";
  /** Texto para lectores de pantalla; por defecto "Cumple", "No cumple"… */
  label?: string;
  className?: string;
}

const EASE = [0.32, 0.72, 0, 1] as const;

/** Círculo de 20px con ✓, ✗ o !, cuyo trazo se dibuja al aparecer. */
export function CheckIcon({
  status,
  animate = true,
  delay = 0,
  size = 20,
  variant = "soft",
  label,
  className,
}: CheckIconProps) {
  const reduce = useReducedMotion();
  const draw = animate && !reduce;
  const s = (variant === "solid" ? SOLID : STYLE)[status];
  const initial = draw ? { pathLength: 0, opacity: 0 } : false;
  const transition = (extra = 0) => ({
    pathLength: { duration: 0.34, delay: delay + extra, ease: EASE },
    opacity: { duration: 0.01, delay: delay + extra },
  });

  return (
    <motion.span
      role="img"
      aria-label={label ?? LABEL[status]}
      className={cn("inline-grid shrink-0 place-items-center rounded-full ring-1 ring-inset", s.circle, className)}
      style={{ width: size, height: size }}
      initial={draw ? { scale: 0.85, opacity: 0 } : false}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.18, delay, ease: EASE }}
    >
      <svg
        viewBox="0 0 20 20"
        width={size}
        height={size}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={s.stroke}
        aria-hidden
      >
        {status === "pass" ? (
          <motion.path d="M6.2 10.4 8.8 13 13.9 7.4" initial={initial} animate={{ pathLength: 1, opacity: 1 }} transition={transition(0.08)} />
        ) : null}
        {status === "fail" ? (
          <>
            <motion.path d="M7.2 7.2 12.8 12.8" initial={initial} animate={{ pathLength: 1, opacity: 1 }} transition={transition(0.08)} />
            <motion.path d="M12.8 7.2 7.2 12.8" initial={initial} animate={{ pathLength: 1, opacity: 1 }} transition={transition(0.2)} />
          </>
        ) : null}
        {status === "warn" ? (
          <>
            <motion.path d="M10 5.9v5" initial={initial} animate={{ pathLength: 1, opacity: 1 }} transition={transition(0.08)} />
            <motion.circle
              cx="10"
              cy="14.1"
              r="0.95"
              fill="currentColor"
              stroke="none"
              initial={draw ? { scale: 0, opacity: 0 } : false}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.16, delay: delay + 0.36, ease: EASE }}
            />
          </>
        ) : null}
        {status === "pending" ? <circle cx="10" cy="10" r="1.4" fill="currentColor" stroke="none" /> : null}
      </svg>
    </motion.span>
  );
}
