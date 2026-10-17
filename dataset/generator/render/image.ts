/**
 * Página → imagen con sharp.
 * - PNG: render limpio (captura de pantalla).
 * - JPG: «foto de celular»: papel levemente girado sobre una superficie, sombra, luz despareja,
 *   grano, desenfoque leve y compresión JPEG. Todo determinista (semilla fija).
 */
import sharp from "sharp";
import { r2, seededRandom, type Page } from "../layout";
import type { PhotoSpec } from "../spec";
import { renderSvg, renderSvgContent } from "./svg";

sharp.cache(false);
sharp.concurrency(1);

export async function renderPng(page: Page, scale = 2): Promise<Buffer> {
  const svg = renderSvg(page, { scale });
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer();
}

const PHOTO_W = 1440;
const PHOTO_H = 1920;
const DOC_SCALE = 2.1;

const SURFACES: Record<PhotoSpec["surface"], { from: string; to: string; grain: string | null }> = {
  desk: { from: "#6B7280", to: "#3F4650", grain: null },
  wood: { from: "#8B6A4C", to: "#5A4130", grain: "#4A3526" },
  fabric: { from: "#44546A", to: "#2B3545", grain: null },
};

function surfaceSvg(surface: PhotoSpec["surface"], seed: number): { defs: string; shapes: string } {
  const s = SURFACES[surface];
  const parts = [
    `<linearGradient id="surface" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${s.from}"/><stop offset="1" stop-color="${s.to}"/></linearGradient>`,
  ];
  const shapes = [`<rect x="0" y="0" width="${PHOTO_W}" height="${PHOTO_H}" fill="url(#surface)"/>`];
  if (s.grain) {
    const rand = seededRandom(seed ^ 0x5eed);
    for (let i = 0; i < 46; i++) {
      const y = rand() * PHOTO_H;
      const amp = 6 + rand() * 18;
      const op = 0.08 + rand() * 0.14;
      const w = 1 + rand() * 3;
      shapes.push(
        `<path d="M0 ${r2(y)} C ${r2(PHOTO_W * 0.3)} ${r2(y - amp)}, ${r2(PHOTO_W * 0.6)} ${r2(y + amp)}, ${PHOTO_W} ${r2(y + amp * 0.3)}" stroke="${s.grain}" stroke-width="${r2(w)}" fill="none" opacity="${r2(op)}"/>`,
      );
    }
  }
  return { defs: parts.join(""), shapes: shapes.join("\n") };
}

/** Grano de sensor: mosaico de ruido determinista. */
function noiseTile(seed: number, size = 160): Buffer {
  const rand = seededRandom(seed);
  const buf = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const v = Math.round(128 + (rand() - 0.5) * 120);
    buf[i * 4] = v;
    buf[i * 4 + 1] = v;
    buf[i * 4 + 2] = v;
    buf[i * 4 + 3] = 34;
  }
  return buf;
}

export interface PhotoEffects {
  /** Textos con estas etiquetas salen ilegibles (desenfoque + reflejo). */
  illegibleTags?: string[];
}

export async function renderPhoto(page: Page, photo: PhotoSpec, effects: PhotoEffects = {}): Promise<Buffer> {
  const dw = page.width * DOC_SCALE;
  const dh = page.height * DOC_SCALE;
  const rand = seededRandom(photo.seed);
  const cx = PHOTO_W / 2 + (rand() - 0.5) * 40;
  const cy = PHOTO_H / 2 + (rand() - 0.5) * 30;
  const { defs: surfaceDefs, shapes: surfaceShapes } = surfaceSvg(photo.surface, photo.seed);
  const inner = renderSvgContent(page, {
    idPrefix: "doc",
    paper: "#FBFAF5",
    blurTags: effects.illegibleTags,
    glareTags: effects.illegibleTags,
  });
  const fold = photo.folded
    ? `<rect x="0" y="${r2(dh * 0.335)}" width="${r2(dw)}" height="14" fill="url(#fold)"/><rect x="0" y="${r2(dh * 0.665)}" width="${r2(dw)}" height="14" fill="url(#fold)"/>`
    : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PHOTO_W}" height="${PHOTO_H}" viewBox="0 0 ${PHOTO_W} ${PHOTO_H}">
<defs>${surfaceDefs}
<filter id="shadow" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="16"/></filter>
<radialGradient id="light" cx="0.36" cy="0.28" r="0.9"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0.10"/><stop offset="0.55" stop-color="#000000" stop-opacity="0.03"/><stop offset="1" stop-color="#000000" stop-opacity="0.36"/></radialGradient>
<linearGradient id="fold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000000" stop-opacity="0"/><stop offset="0.5" stop-color="#000000" stop-opacity="0.10"/><stop offset="0.56" stop-color="#FFFFFF" stop-opacity="0.35"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient>
</defs>
${surfaceShapes}
<g transform="translate(${r2(cx)} ${r2(cy)}) rotate(${r2(photo.angle)}) translate(${r2(-dw / 2)} ${r2(-dh / 2)})">
<rect x="12" y="22" width="${r2(dw)}" height="${r2(dh)}" fill="#000000" opacity="0.5" filter="url(#shadow)"/>
<svg x="0" y="0" width="${r2(dw)}" height="${r2(dh)}" viewBox="0 0 ${r2(page.width)} ${r2(page.height)}">
${inner}
</svg>
${fold}
</g>
<rect x="0" y="0" width="${PHOTO_W}" height="${PHOTO_H}" fill="url(#light)"/>
</svg>`;

  const tileSize = 160;
  return sharp(Buffer.from(svg))
    .blur(photo.blur)
    .modulate({ brightness: 0.98, saturation: 0.9 })
    .composite([{ input: noiseTile(photo.seed, tileSize), raw: { width: tileSize, height: tileSize, channels: 4 }, tile: true, blend: "over" }])
    .jpeg({ quality: photo.quality, chromaSubsampling: "4:2:0" })
    .toBuffer();
}
