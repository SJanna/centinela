/**
 * Lienzo independiente del formato: las plantillas dibujan primitivas (texto, rectángulos,
 * líneas, trazos) y luego se convierten a PDF (pdfkit) o a SVG (→ PNG/JPG con sharp).
 * Así un mismo documento se ve igual en PDF, en la captura y en la foto.
 *
 * Coordenadas en puntos PDF (A4 = 595,28 × 841,89), origen arriba a la izquierda.
 * El `y` de un texto es su línea base.
 */
import PDFDocument from "pdfkit";
import type { EvidenceKey, EvidenceMap } from "./spec";

export type FontKey = "sans" | "sansBold" | "sansOblique" | "serif" | "serifBold" | "serifItalic" | "mono";

/** Fuentes estándar de PDF (no se incrustan: el PDF no depende del sistema). */
export const PDF_FONTS: Record<FontKey, string> = {
  sans: "Helvetica",
  sansBold: "Helvetica-Bold",
  sansOblique: "Helvetica-Oblique",
  serif: "Times-Roman",
  serifBold: "Times-Bold",
  serifItalic: "Times-Italic",
  mono: "Courier",
};

export type Align = "left" | "right" | "center";

export interface TextOp {
  kind: "text";
  x: number;
  y: number;
  text: string;
  size: number;
  font: FontKey;
  color: string;
  align: Align;
  opacity: number;
  letterSpacing: number;
  /** Etiquetas para efectos (p. ej. "total" para desenfocarlo en una foto). */
  tags: string[];
}

export interface RectOp {
  kind: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string | null;
  stroke: string | null;
  lineWidth: number;
  radius: number;
  opacity: number;
}

export interface LineOp {
  kind: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
  dash: [number, number] | null;
  opacity: number;
}

export interface CircleOp {
  kind: "circle";
  cx: number;
  cy: number;
  r: number;
  fill: string | null;
  stroke: string | null;
  lineWidth: number;
  opacity: number;
}

export interface EllipseOp {
  kind: "ellipse";
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  fill: string | null;
  stroke: string | null;
  lineWidth: number;
  opacity: number;
}

export interface PathOp {
  kind: "path";
  /** Datos de trazo en sintaxis SVG (M, L, C, Q, Z…), en coordenadas absolutas. */
  d: string;
  fill: string | null;
  stroke: string | null;
  lineWidth: number;
  opacity: number;
  evenOdd: boolean;
  lineCap: "butt" | "round";
}

export type Op = TextOp | RectOp | LineOp | CircleOp | EllipseOp | PathOp;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Page {
  width: number;
  height: number;
  background: string;
  ops: Op[];
  /** Cajas de los textos con etiqueta (para efectos de imagen). */
  tagged: Record<string, Box[]>;
}

export const A4 = { width: 595.28, height: 841.89 } as const;

// ───────────────────────── Medición de texto ─────────────────────────

let measurer: PDFKit.PDFDocument | null = null;

/** Ancho de un texto con las métricas de las fuentes estándar de PDF. */
export function textWidth(text: string, font: FontKey, size: number, letterSpacing = 0): number {
  measurer ??= new PDFDocument({ autoFirstPage: false });
  const w = measurer.font(PDF_FONTS[font]).fontSize(size).widthOfString(text);
  return w + letterSpacing * Math.max(0, text.length - 1);
}

/** Corta un texto en líneas que caben en maxWidth (por palabras). */
export function wrapText(text: string, font: FontKey, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && textWidth(candidate, font, size) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// ───────────────────────── Lienzo ─────────────────────────

export interface TextStyle {
  size?: number;
  font?: FontKey;
  color?: string;
  align?: Align;
  opacity?: number;
  letterSpacing?: number;
  tags?: string[];
}

export interface ShapeStyle {
  fill?: string | null;
  stroke?: string | null;
  lineWidth?: number;
  opacity?: number;
}

export class Canvas {
  readonly ops: Op[] = [];
  readonly tagged: Record<string, Box[]> = {};
  /** Citas literales de los campos de la lectura, tal como quedaron dibujadas. */
  readonly evidence: EvidenceMap = {};
  /**
   * Citas con la etiqueta que se ve en la misma fila («TOTAL A PAGAR $36,000.00 MXN», «Amount due
   * $1,200.00»). Una imagen no tiene texto con qué comprobar la cita: ahí la lectura «perfecta» cita la
   * fila completa, como la transcribiría una persona (ver renderVisual en build.ts).
   */
  readonly labeledEvidence: EvidenceMap = {};

  constructor(
    readonly width: number = A4.width,
    readonly height: number = A4.height,
    readonly background: string = "#FFFFFF",
  ) {}

  /** Dibuja un texto en una sola línea. Devuelve su ancho. */
  text(x: number, y: number, text: string, style: TextStyle = {}): number {
    const size = style.size ?? 9;
    const font = style.font ?? "sans";
    const letterSpacing = style.letterSpacing ?? 0;
    const align = style.align ?? "left";
    const tags = style.tags ?? [];
    if (text.length === 0) return 0;
    this.ops.push({
      kind: "text",
      x,
      y,
      text,
      size,
      font,
      color: style.color ?? "#111111",
      align,
      opacity: style.opacity ?? 1,
      letterSpacing,
      tags,
    });
    const w = textWidth(text, font, size, letterSpacing);
    const left = align === "left" ? x : align === "right" ? x - w : x - w / 2;
    for (const tag of tags) {
      (this.tagged[tag] ??= []).push({ x: left, y: y - size * 0.8, w, h: size * 1.05 });
    }
    return w;
  }

  /** Texto que además es la cita de un campo de la lectura (la primera aparición manda). */
  field(key: EvidenceKey, x: number, y: number, text: string, style: TextStyle = {}): number {
    if (!(key in this.evidence)) this.evidence[key] = text;
    return this.text(x, y, text, style);
  }

  /** Registra la cita de un campo sin dibujar (cuando el texto ya se dibujó por otra vía). */
  cite(key: EvidenceKey, text: string): void {
    if (!(key in this.evidence)) this.evidence[key] = text;
  }

  /** Registra la cita «etiqueta valor» de una fila ya dibujada (la primera manda). */
  citeWithLabel(key: EvidenceKey, label: string, value: string): void {
    if (!(key in this.labeledEvidence)) this.labeledEvidence[key] = `${label.trim()} ${value.trim()}`;
  }

  /** Párrafo con salto de línea automático. Devuelve el y de la línea base siguiente. */
  paragraph(x: number, y: number, maxWidth: number, text: string, style: TextStyle & { lineHeight?: number } = {}): number {
    const size = style.size ?? 9;
    const lineHeight = style.lineHeight ?? size * 1.35;
    const lines = wrapText(text, style.font ?? "sans", size, maxWidth);
    let cy = y;
    for (const line of lines) {
      this.text(x, cy, line, style);
      cy += lineHeight;
    }
    return cy;
  }

  rect(x: number, y: number, w: number, h: number, style: ShapeStyle & { radius?: number } = {}): void {
    this.ops.push({
      kind: "rect",
      x,
      y,
      w,
      h,
      fill: style.fill === undefined ? "#000000" : style.fill,
      stroke: style.stroke ?? null,
      lineWidth: style.lineWidth ?? 1,
      radius: style.radius ?? 0,
      opacity: style.opacity ?? 1,
    });
  }

  line(x1: number, y1: number, x2: number, y2: number, color = "#000000", width = 0.5, dash: [number, number] | null = null, opacity = 1): void {
    this.ops.push({ kind: "line", x1, y1, x2, y2, color, width, dash, opacity });
  }

  circle(cx: number, cy: number, r: number, style: ShapeStyle = {}): void {
    this.ops.push({
      kind: "circle",
      cx,
      cy,
      r,
      fill: style.fill === undefined ? "#000000" : style.fill,
      stroke: style.stroke ?? null,
      lineWidth: style.lineWidth ?? 1,
      opacity: style.opacity ?? 1,
    });
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, style: ShapeStyle = {}): void {
    this.ops.push({
      kind: "ellipse",
      cx,
      cy,
      rx,
      ry,
      fill: style.fill === undefined ? "#000000" : style.fill,
      stroke: style.stroke ?? null,
      lineWidth: style.lineWidth ?? 1,
      opacity: style.opacity ?? 1,
    });
  }

  path(d: string, style: ShapeStyle & { evenOdd?: boolean; lineCap?: "butt" | "round" } = {}): void {
    this.ops.push({
      kind: "path",
      d,
      fill: style.fill === undefined ? "#000000" : style.fill,
      stroke: style.stroke ?? null,
      lineWidth: style.lineWidth ?? 1,
      opacity: style.opacity ?? 1,
      evenOdd: style.evenOdd ?? false,
      lineCap: style.lineCap ?? "butt",
    });
  }

  page(): Page {
    return { width: this.width, height: this.height, background: this.background, ops: [...this.ops], tagged: { ...this.tagged } };
  }
}

// ───────────────────────── Utilidades de diseño ─────────────────────────

/** Mezcla un color con blanco: tint("#4F46E5", 0.9) = 90 % blanco. */
export function tint(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return `#${[mix(r), mix(g), mix(b)].map((c) => c.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

/** Oscurece un color: shade("#4F46E5", 0.3) = 30 % más oscuro. */
export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const mix = (c: number) => Math.round(c * (1 - amount));
  return `#${[mix(r), mix(g), mix(b)].map((c) => c.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

/** Generador pseudoaleatorio determinista (mulberry32). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash entero simple de un texto (FNV-1a), para semillas deterministas. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Patrón tipo código QR (decorativo, determinista) dentro de un cuadrado. */
export function drawQrLike(c: Canvas, x: number, y: number, size: number, seedText: string, color = "#111111"): void {
  const n = 25;
  const cell = size / n;
  const rand = seededRandom(hashString(seedText));
  const finder = (fx: number, fy: number) => {
    c.rect(x + fx * cell, y + fy * cell, 7 * cell, 7 * cell, { fill: color });
    c.rect(x + (fx + 1) * cell, y + (fy + 1) * cell, 5 * cell, 5 * cell, { fill: "#FFFFFF" });
    c.rect(x + (fx + 2) * cell, y + (fy + 2) * cell, 3 * cell, 3 * cell, { fill: color });
  };
  const inFinder = (i: number, j: number) =>
    (i < 8 && j < 8) || (i >= n - 8 && j < 8) || (i < 8 && j >= n - 8);
  let d = "";
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      if (inFinder(i, j)) continue;
      if (rand() < 0.48) {
        const px = x + i * cell;
        const py = y + j * cell;
        d += `M${r2(px)} ${r2(py)}h${r2(cell)}v${r2(cell)}h${r2(-cell)}Z`;
      }
    }
  }
  c.path(d, { fill: color });
  finder(0, 0);
  finder(n - 7, 0);
  finder(0, n - 7);
}

/** Código de barras apilado (estilo PDF417, decorativo). */
export function drawStackedBarcode(c: Canvas, x: number, y: number, w: number, h: number, seedText: string, color = "#111111"): void {
  const rows = 12;
  const rowH = h / rows;
  const rand = seededRandom(hashString(seedText));
  let d = "";
  for (let r = 0; r < rows; r++) {
    let cx = x;
    let black = true;
    while (cx < x + w) {
      const bw = Math.min((1 + Math.floor(rand() * 4)) * 0.9, x + w - cx);
      if (black) d += `M${r2(cx)} ${r2(y + r * rowH)}h${r2(bw)}v${r2(rowH * 0.92)}h${r2(-bw)}Z`;
      cx += bw;
      black = !black;
    }
  }
  c.path(d, { fill: color });
}

export function r2(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}
