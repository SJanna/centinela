/**
 * Página → SVG (para convertir a PNG/JPG con sharp). Mismas primitivas que el PDF.
 */
import { r2, type FontKey, type Op, type Page } from "../layout";

const FAMILY: Record<FontKey, { family: string; weight: string | null; style: string | null }> = {
  sans: { family: "Helvetica, Arial, Liberation Sans, sans-serif", weight: null, style: null },
  sansBold: { family: "Helvetica, Arial, Liberation Sans, sans-serif", weight: "bold", style: null },
  sansOblique: { family: "Helvetica, Arial, Liberation Sans, sans-serif", weight: null, style: "italic" },
  serif: { family: "Times New Roman, Times, Liberation Serif, serif", weight: null, style: null },
  serifBold: { family: "Times New Roman, Times, Liberation Serif, serif", weight: "bold", style: null },
  serifItalic: { family: "Times New Roman, Times, Liberation Serif, serif", weight: null, style: "italic" },
  mono: { family: "Courier New, Courier, Liberation Mono, monospace", weight: null, style: null },
};

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export interface SvgOptions {
  /** Píxeles por punto. */
  scale: number;
  /** Textos con estas etiquetas salen desenfocados (B17: el total). */
  blurTags?: string[];
  /** Reflejo de luz encima de los textos con estas etiquetas. */
  glareTags?: string[];
  /** Color de papel que reemplaza el fondo (fotos de papel impreso). */
  paper?: string;
  /** Prefijo de ids (para anidar varios SVG sin choques). */
  idPrefix?: string;
}

function paintAttrs(fill: string | null, stroke: string | null, lineWidth: number, opacity: number): string {
  const parts = [`fill="${fill ?? "none"}"`];
  if (stroke) parts.push(`stroke="${stroke}"`, `stroke-width="${r2(lineWidth)}"`);
  if (opacity < 1) parts.push(`opacity="${r2(opacity)}"`);
  return parts.join(" ");
}

function opToSvg(op: Op, blurFilter: string | null): string {
  switch (op.kind) {
    case "text": {
      const f = FAMILY[op.font];
      const anchor = op.align === "left" ? "start" : op.align === "right" ? "end" : "middle";
      const attrs = [
        `x="${r2(op.x)}"`,
        `y="${r2(op.y)}"`,
        `font-family="${f.family}"`,
        `font-size="${r2(op.size)}"`,
        f.weight ? `font-weight="${f.weight}"` : "",
        f.style ? `font-style="${f.style}"` : "",
        anchor !== "start" ? `text-anchor="${anchor}"` : "",
        op.letterSpacing ? `letter-spacing="${r2(op.letterSpacing)}"` : "",
        `fill="${op.color}"`,
        op.opacity < 1 ? `opacity="${r2(op.opacity)}"` : "",
        blurFilter ? `filter="url(#${blurFilter})"` : "",
      ].filter(Boolean);
      return `<text ${attrs.join(" ")}>${escapeXml(op.text)}</text>`;
    }
    case "rect":
      return `<rect x="${r2(op.x)}" y="${r2(op.y)}" width="${r2(op.w)}" height="${r2(op.h)}"${op.radius > 0 ? ` rx="${r2(op.radius)}"` : ""} ${paintAttrs(op.fill, op.stroke, op.lineWidth, op.opacity)}/>`;
    case "line":
      return `<line x1="${r2(op.x1)}" y1="${r2(op.y1)}" x2="${r2(op.x2)}" y2="${r2(op.y2)}" stroke="${op.color}" stroke-width="${r2(op.width)}"${op.dash ? ` stroke-dasharray="${op.dash[0]} ${op.dash[1]}"` : ""}${op.opacity < 1 ? ` opacity="${r2(op.opacity)}"` : ""}/>`;
    case "circle":
      return `<circle cx="${r2(op.cx)}" cy="${r2(op.cy)}" r="${r2(op.r)}" ${paintAttrs(op.fill, op.stroke, op.lineWidth, op.opacity)}/>`;
    case "ellipse":
      return `<ellipse cx="${r2(op.cx)}" cy="${r2(op.cy)}" rx="${r2(op.rx)}" ry="${r2(op.ry)}" ${paintAttrs(op.fill, op.stroke, op.lineWidth, op.opacity)}/>`;
    case "path":
      return `<path d="${op.d}" ${paintAttrs(op.fill, op.stroke, op.lineWidth, op.opacity)}${op.evenOdd ? ` fill-rule="evenodd"` : ""}${op.lineCap === "round" ? ` stroke-linecap="round" stroke-linejoin="round"` : ""}/>`;
  }
}

/** Contenido de la página (sin la etiqueta <svg> exterior), en coordenadas de la página. */
export function renderSvgContent(page: Page, opts: Omit<SvgOptions, "scale"> = {}): string {
  const prefix = opts.idPrefix ?? "p";
  const blurTags = new Set(opts.blurTags ?? []);
  const glareTags = opts.glareTags ?? [];
  const blurId = `${prefix}-blur`;
  const glareId = `${prefix}-glare`;
  const defs: string[] = [];
  if (blurTags.size > 0) {
    defs.push(
      `<filter id="${blurId}" x="-40%" y="-150%" width="180%" height="400%"><feGaussianBlur stdDeviation="3.6"/></filter>`,
    );
  }
  if (glareTags.length > 0) {
    defs.push(
      `<radialGradient id="${glareId}"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0.62"/><stop offset="0.55" stop-color="#FFFFFF" stop-opacity="0.32"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></radialGradient>`,
    );
  }
  const body: string[] = [];
  body.push(`<rect x="0" y="0" width="${r2(page.width)}" height="${r2(page.height)}" fill="${opts.paper ?? page.background}"/>`);
  for (const op of page.ops) {
    const blurred = op.kind === "text" && op.tags.some((t) => blurTags.has(t));
    body.push(opToSvg(op, blurred ? blurId : null));
  }
  for (const tag of glareTags) {
    for (const box of page.tagged[tag] ?? []) {
      const cx = box.x + box.w * 0.55;
      const cy = box.y + box.h * 0.45;
      body.push(
        `<ellipse cx="${r2(cx)}" cy="${r2(cy)}" rx="${r2(box.w * 0.9 + 18)}" ry="${r2(box.h * 1.6 + 8)}" fill="url(#${glareId})"/>`,
      );
    }
  }
  return `${defs.length ? `<defs>${defs.join("")}</defs>` : ""}${body.join("\n")}`;
}

/** SVG completo, escalado a píxeles. */
export function renderSvg(page: Page, opts: SvgOptions): string {
  const w = Math.round(page.width * opts.scale);
  const h = Math.round(page.height * opts.scale);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${r2(page.width)} ${r2(page.height)}">\n${renderSvgContent(page, opts)}\n</svg>`;
}
