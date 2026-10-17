/**
 * Logos ficticios hechos con formas simples (sin imágenes), uno por proveedor.
 */
import { r2, type Canvas } from "../layout";
import type { Brand, LogoKind } from "../spec";

export interface LogoColors {
  /** Fondo del contenedor (null = sin contenedor). */
  bg: string | null;
  /** Color de las formas. */
  fg: string;
}

type Drawer = (c: Canvas, x: number, y: number, s: number, col: LogoColors, initials: string | null) => void;

const P = (x: number, y: number, s: number) => (fx: number, fy: number) => `${r2(x + fx * s)} ${r2(y + fy * s)}`;

const container = (c: Canvas, x: number, y: number, s: number, bg: string | null, round: number) => {
  if (bg) c.rect(x, y, s, s, { fill: bg, radius: s * round });
};

const DRAWERS: Record<LogoKind, Drawer> = {
  bars(c, x, y, s, col) {
    container(c, x, y, s, col.bg, 0.24);
    const heights = [0.26, 0.42, 0.58];
    heights.forEach((h, i) => {
      c.rect(x + s * (0.22 + i * 0.2), y + s * (0.78 - h), s * 0.14, s * h, { fill: col.fg, radius: s * 0.03 });
    });
    c.circle(x + s * 0.78, y + s * 0.24, s * 0.06, { fill: col.fg });
  },
  peak(c, x, y, s, col) {
    container(c, x, y, s, col.bg, 0.24);
    const p = P(x, y, s);
    c.path(`M${p(0.16, 0.76)} L${p(0.42, 0.32)} L${p(0.56, 0.55)} L${p(0.66, 0.42)} L${p(0.86, 0.76)} Z`, { fill: col.fg });
    c.path(`M${p(0.2, 0.24)} C${p(0.34, 0.18)} ${p(0.5, 0.3)} ${p(0.64, 0.22)}`, { fill: null, stroke: col.fg, lineWidth: s * 0.05, lineCap: "round" });
  },
  orbit(c, x, y, s, col) {
    if (col.bg) c.circle(x + s / 2, y + s / 2, s / 2, { fill: col.bg });
    const cx = x + s / 2;
    const cy = y + s / 2;
    const rx = s * 0.36;
    const ry = s * 0.14;
    for (const deg of [32, -32, 90]) {
      const t = (deg * Math.PI) / 180;
      const x1 = cx + rx * Math.cos(t);
      const y1 = cy + rx * Math.sin(t);
      const x2 = cx - rx * Math.cos(t);
      const y2 = cy - rx * Math.sin(t);
      c.path(
        `M${r2(x1)} ${r2(y1)} A${r2(rx)} ${r2(ry)} ${deg} 1 0 ${r2(x2)} ${r2(y2)} A${r2(rx)} ${r2(ry)} ${deg} 1 0 ${r2(x1)} ${r2(y1)} Z`,
        { fill: null, stroke: col.fg, lineWidth: s * 0.04 },
      );
    }
    c.circle(cx, cy, s * 0.07, { fill: col.fg });
  },
  monogram(c, x, y, s, col, initials) {
    if (col.bg) c.circle(x + s / 2, y + s / 2, s / 2, { fill: col.bg });
    c.circle(x + s / 2, y + s / 2, s * 0.42, { fill: null, stroke: col.fg, lineWidth: s * 0.025 });
    const size = s * 0.36;
    c.text(x + s / 2, y + s / 2 + size * 0.36, initials ?? "?", { size, font: "sansBold", color: col.fg, align: "center", letterSpacing: s * 0.01 });
  },
  cactus(c, x, y, s, col) {
    container(c, x, y, s, col.bg, 0.24);
    c.rect(x + s * 0.43, y + s * 0.16, s * 0.15, s * 0.68, { fill: col.fg, radius: s * 0.075 });
    c.rect(x + s * 0.22, y + s * 0.34, s * 0.12, s * 0.3, { fill: col.fg, radius: s * 0.06 });
    c.rect(x + s * 0.24, y + s * 0.54, s * 0.24, s * 0.1, { fill: col.fg, radius: s * 0.05 });
    c.rect(x + s * 0.67, y + s * 0.26, s * 0.12, s * 0.26, { fill: col.fg, radius: s * 0.06 });
    c.rect(x + s * 0.53, y + s * 0.42, s * 0.24, s * 0.1, { fill: col.fg, radius: s * 0.05 });
  },
  check(c, x, y, s, col) {
    container(c, x, y, s, col.bg, 0.18);
    const p = P(x, y, s);
    c.path(`M${p(0.24, 0.52)} L${p(0.43, 0.7)} L${p(0.78, 0.3)}`, { fill: null, stroke: col.fg, lineWidth: s * 0.11, lineCap: "round" });
  },
  sun(c, x, y, s, col) {
    container(c, x, y, s, col.bg, 0.24);
    const p = P(x, y, s);
    c.circle(x + s * 0.5, y + s * 0.34, s * 0.13, { fill: col.fg });
    c.path(
      `M${p(0.14, 0.82)} L${p(0.14, 0.72)} L${p(0.24, 0.72)} L${p(0.24, 0.62)} L${p(0.34, 0.62)} L${p(0.34, 0.54)} L${p(0.66, 0.54)} L${p(0.66, 0.62)} L${p(0.76, 0.62)} L${p(0.76, 0.72)} L${p(0.86, 0.72)} L${p(0.86, 0.82)} Z`,
      { fill: col.fg },
    );
  },
  wave(c, x, y, s, col) {
    if (col.bg) c.circle(x + s / 2, y + s / 2, s / 2, { fill: col.bg });
    const p = P(x, y, s);
    for (const [dy, w] of [[0.38, 0.07], [0.54, 0.07], [0.7, 0.05]] as const) {
      c.path(`M${p(0.18, dy)} C${p(0.32, dy - 0.1)} ${p(0.4, dy + 0.1)} ${p(0.5, dy)} C${p(0.6, dy - 0.1)} ${p(0.68, dy + 0.1)} ${p(0.82, dy)}`, {
        fill: null,
        stroke: col.fg,
        lineWidth: s * w,
        lineCap: "round",
      });
    }
  },
  dots(c, x, y, s, col) {
    container(c, x, y, s, col.bg, 0.24);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        const r = s * (0.035 + (i + (2 - j)) * 0.014);
        c.circle(x + s * (0.27 + i * 0.23), y + s * (0.27 + j * 0.23), r, { fill: col.fg });
      }
    }
  },
  pillar(c, x, y, s, col) {
    container(c, x, y, s, col.bg, 0.12);
    const p = P(x, y, s);
    c.path(`M${p(0.16, 0.34)} L${p(0.5, 0.16)} L${p(0.84, 0.34)} Z`, { fill: col.fg });
    for (const fx of [0.24, 0.44, 0.64]) c.rect(x + s * fx, y + s * 0.38, s * 0.12, s * 0.36, { fill: col.fg });
    c.rect(x + s * 0.16, y + s * 0.77, s * 0.68, s * 0.07, { fill: col.fg });
  },
  tree(c, x, y, s, col) {
    if (col.bg) c.circle(x + s / 2, y + s / 2, s / 2, { fill: col.bg });
    c.rect(x + s * 0.45, y + s * 0.5, s * 0.1, s * 0.3, { fill: col.fg, radius: s * 0.02 });
    c.circle(x + s * 0.5, y + s * 0.4, s * 0.2, { fill: col.fg });
    c.circle(x + s * 0.34, y + s * 0.5, s * 0.13, { fill: col.fg });
    c.circle(x + s * 0.66, y + s * 0.5, s * 0.13, { fill: col.fg });
  },
};

export function drawLogo(c: Canvas, brand: Brand, x: number, y: number, size: number, colors: LogoColors): void {
  DRAWERS[brand.logo](c, x, y, size, colors, brand.initials);
}
