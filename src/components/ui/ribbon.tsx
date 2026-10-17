"use client";

import { useAnimationFrame, useInView, useReducedMotion } from "motion/react";
import { useId, useRef } from "react";
import { cn } from "./cn";

const WIDTH = 1200;
const HEIGHT = 600;
const STEP = 20;
/** Un ciclo completo de deriva, en ms. */
const CYCLE_MS = 24_000;
/** Cuadros por segundo de la animación: lenta, no necesita 60. */
const FRAME_MS = 1000 / 30;

/**
 * Trazado de una línea de la cinta. La cinta es un haz de líneas senoidales cuyo ancho
 * pasa por cero (la "torsión"); `phase` (0..1) la hace derivar de forma cíclica.
 */
function ribbonPath(index: number, count: number, phase: number): string {
  const t = count > 1 ? index / (count - 1) - 0.5 : 0;
  const a = Math.PI * 2 * phase;
  const sway = Math.sin(a) * 0.55;
  const drift = Math.sin(a + 1.2) * 0.45;
  let d = "";
  for (let x = -60; x <= WIDTH + 60; x += STEP) {
    const center = HEIGHT * 0.52 + 78 * Math.sin(x * 0.0036 + 0.8 + drift);
    const half = 210 * Math.cos(x * 0.0041 - 1.1 + sway);
    const ripple = 7 * Math.sin(x * 0.011 + index * 0.13 + a);
    const y = center + t * 2 * half + ripple * (0.35 + Math.abs(t));
    d += `${x === -60 ? "M" : "L"}${x} ${y.toFixed(1)}`;
  }
  return d;
}

interface RibbonProps {
  /** Número de líneas (80 por defecto). */
  lines?: number;
  /** Si es false, la cinta queda quieta. También se queda quieta con prefers-reduced-motion. */
  animate?: boolean;
  /** Opacidad del trazo (0.35 por defecto). */
  opacity?: number;
  className?: string;
}

/**
 * Cinta generativa: ~80 líneas finas de lavanda a cobalto que derivan despacio (ciclos de 24 s).
 * Decorativa: aria-hidden y sin eventos de puntero. Se pausa fuera de la pantalla.
 */
export function Ribbon({ lines = 80, animate = true, opacity = 0.35, className }: RibbonProps) {
  const rawId = useId();
  const gradientId = `ribbon-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const svgRef = useRef<SVGSVGElement>(null);
  const groupRef = useRef<SVGGElement>(null);
  const lastFrame = useRef(0);
  const reduce = useReducedMotion();
  const inView = useInView(svgRef, { margin: "80px" });
  const running = animate && !reduce && inView;

  useAnimationFrame((time) => {
    if (!running || !groupRef.current) return;
    if (time - lastFrame.current < FRAME_MS) return;
    lastFrame.current = time;
    const phase = (time % CYCLE_MS) / CYCLE_MS;
    const paths = groupRef.current.children;
    for (let i = 0; i < paths.length; i++) {
      paths[i].setAttribute("d", ribbonPath(i, paths.length, phase));
    }
  });

  return (
    <svg
      ref={svgRef}
      aria-hidden
      focusable="false"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="xMidYMid slice"
      className={cn("pointer-events-none block h-full w-full select-none", className)}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2={WIDTH} y2={HEIGHT} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--color-lavender)" />
          <stop offset="0.55" stopColor="#6f86e6" />
          <stop offset="1" stopColor="var(--color-accent)" />
        </linearGradient>
      </defs>
      <g
        ref={groupRef}
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth={0.75}
        strokeOpacity={opacity}
        vectorEffect="non-scaling-stroke"
      >
        {Array.from({ length: lines }, (_, i) => (
          <path key={i} d={ribbonPath(i, lines, 0)} vectorEffect="non-scaling-stroke" />
        ))}
      </g>
    </svg>
  );
}
