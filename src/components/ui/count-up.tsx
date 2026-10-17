"use client";

import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { useEffect } from "react";
import { cn } from "./cn";
import { MONEY_SIZE, moneyParts, type MoneyDisplay, type MoneySize } from "./money";

const EASE_STRONG = [0.23, 1, 0.32, 1] as const;


interface CountUpMoneyProps {
  amount: number;
  currency?: string;
  size?: MoneySize;
  display?: MoneyDisplay;
  /** Segundos (0.8 por defecto). */
  duration?: number;
  className?: string;
}

/**
 * Monto que sube desde 0 al aparecer (800 ms, curva fuerte), con los centavos atenuados.
 * Con prefers-reduced-motion muestra el valor final sin animar.
 */
export function CountUpMoney({
  amount,
  currency = "USD",
  size = "kpi",
  display = "symbol",
  duration = 0.8,
  className,
}: CountUpMoneyProps) {
  const reduce = useReducedMotion();
  const value = useMotionValue(0);
  const integer = useTransform(value, (v) => moneyParts(v, currency).integer);
  const fraction = useTransform(value, (v) => moneyParts(v, currency).fraction);

  useEffect(() => {
    if (reduce) {
      value.set(amount);
      return;
    }
    const controls = animate(value, amount, { duration, ease: EASE_STRONG });
    return () => controls.stop();
  }, [amount, duration, reduce, value]);

  const s = MONEY_SIZE[size];
  const final = moneyParts(amount, currency);
  const showSymbol = (display === "symbol" || display === "both") && final.symbol !== "";
  const showCode = display === "code" || display === "both" || (display === "symbol" && final.symbol === "");
  return (
    <span className={cn("tnum inline-flex items-baseline whitespace-nowrap", s.root, className)}>
      <span className="sr-only">{`${final.sign}${final.integer}${final.fraction} ${final.code}`}</span>
      <span aria-hidden className="inline-flex items-baseline">
        {final.sign ? <span>{final.sign}</span> : null}
        {showSymbol ? <span>{final.symbol}</span> : null}
        <motion.span>{integer}</motion.span>
        {final.fraction ? <motion.span className={s.fraction}>{fraction}</motion.span> : null}
        {showCode ? <span className={s.code}>{final.code}</span> : null}
      </span>
    </span>
  );
}

interface CountUpProps {
  /** Valor final (entero o proporción si `percent`). */
  value: number;
  /** Trata `value` como proporción 0..1 y muestra "83 %". */
  percent?: boolean;
  size?: MoneySize;
  duration?: number;
  className?: string;
}

const integerFormat = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });

/** Contador simple (conteos y porcentajes) que sube desde 0. */
export function CountUp({ value: target, percent = false, size = "kpi", duration = 0.8, className }: CountUpProps) {
  const reduce = useReducedMotion();
  const final = percent ? target * 100 : target;
  const value = useMotionValue(0);
  const text = useTransform(value, (v) => integerFormat.format(v));

  useEffect(() => {
    if (reduce) {
      value.set(final);
      return;
    }
    const controls = animate(value, final, { duration, ease: EASE_STRONG });
    return () => controls.stop();
  }, [final, duration, reduce, value]);

  const s = MONEY_SIZE[size];
  return (
    <span className={cn("tnum inline-flex items-baseline whitespace-nowrap", s.root, className)}>
      <span className="sr-only">{`${integerFormat.format(final)}${percent ? " %" : ""}`}</span>
      <span aria-hidden className="inline-flex items-baseline">
        <motion.span>{text}</motion.span>
        {percent ? <span className={cn(s.fraction, "ml-[0.08em]")}>%</span> : null}
      </span>
    </span>
  );
}
