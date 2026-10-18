/**
 * Nitidez de una imagen, sin modelo: varianza del laplaciano de la imagen en escala de grises,
 * reducida a SHARPNESS_SIDE px de lado largo (1200 × 1600 en una foto vertical 3:4) para no depender
 * de la resolución ni de si la foto está girada. Un borde nítido da un laplaciano alto en pocos
 * píxeles; desenfocado, el mismo borde se reparte y la varianza cae.
 *
 * También se mide la imagen de las primeras páginas de un PDF escaneado (sin capa de texto; ver
 * src/ingest/pdf.ts).
 *
 * Calibrado con las fotos del set de estrés (dataset/stress/generated/specs.json, `photo.blur` =
 * sigma del desenfoque): las 34 trampas de total borroso miden 49–107 (las 7 con sigma > 2, 49–81);
 * las demás fotos, 181 o más (las de sigma ≤ 1, 193 o más); las capturas PNG, 854 o más. Ver
 * docs/REDTEAM.md, «Errores honestos y fotos borrosas».
 */
import type { IngestWarning } from "@/core/schemas";
import { MIN_IMAGE_SHARPNESS } from "./limits";

/**
 * Por debajo de esta desviación de los grises (0–255) la imagen es lisa: no hay nada que leer ni bordes
 * que medir (un adjunto en blanco, un fondo de color). No se mide: llamarla «borrosa» sería falso.
 */
export const FLAT_IMAGE_STDDEV = 6;

/**
 * Varianza del laplaciano (núcleo de 4 vecinos) de una imagen en escala de grises, un byte por píxel
 * (o el primer canal de `channels`). null si la imagen es lisa o demasiado chica para medirla.
 */
export function laplacianVariance(pixels: Uint8Array, width: number, height: number, channels = 1): number | null {
  if (width < 3 || height < 3 || pixels.length < width * height * channels) return null;
  const at = (x: number, y: number) => pixels[(y * width + x) * channels];
  let gray = 0;
  let gray2 = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = at(x, y);
      gray += v;
      gray2 += v * v;
    }
  }
  const count = width * height;
  const grayMean = gray / count;
  if (Math.sqrt(Math.max(0, gray2 / count - grayMean * grayMean)) < FLAT_IMAGE_STDDEV) return null;

  let sum = 0;
  let sum2 = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const l = at(x - 1, y) + at(x + 1, y) + at(x, y - 1) + at(x, y + 1) - 4 * at(x, y);
      sum += l;
      sum2 += l * l;
    }
  }
  const n = (width - 2) * (height - 2);
  const mean = sum / n;
  return sum2 / n - mean * mean;
}

/** true si la nitidez medida está por debajo del mínimo. Sin medida (null) no es borrosa. */
export function isBlurry(sharpness: number | null): boolean {
  return sharpness != null && Math.round(sharpness) < MIN_IMAGE_SHARPNESS;
}

/**
 * Aviso de la entrada para una imagen borrosa, con los valores concretos. `attachment` es el nombre
 * del adjunto cuando la imagen viene dentro de un correo; `page`, la página de un PDF escaneado.
 */
export function blurryImageWarning(sharpness: number, where: { attachment?: string; page?: number } = {}): IngestWarning {
  const { attachment, page } = where;
  const subject =
    page != null
      ? `La página ${page} del PDF escaneado${attachment ? ` adjunto «${attachment}»` : ""} está borrosa`
      : attachment
        ? `La foto adjunta «${attachment}» está borrosa`
        : "La foto está borrosa";
  return {
    code: "blurry_image",
    message: `${subject} (nitidez ${Math.round(sharpness)}; mínimo ${MIN_IMAGE_SHARPNESS}): una persona debe revisarla.`,
  };
}

/** Avisos de las páginas borrosas de un PDF escaneado (vacío si no hay ninguna). */
export function blurryPageWarnings(pageSharpness: readonly { page: number; sharpness: number }[] | undefined, attachment?: string): IngestWarning[] {
  return (pageSharpness ?? []).filter((p) => isBlurry(p.sharpness)).map((p) => blurryImageWarning(p.sharpness, { attachment, page: p.page }));
}
