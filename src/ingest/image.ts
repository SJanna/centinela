/**
 * Imágenes: se envían tal cual si el modelo las acepta y no son demasiado grandes; si no, se
 * reducen (y se enderezan según EXIF) con sharp, que se carga solo cuando hace falta. Con sharp
 * también se mide la nitidez (src/ingest/sharpness.ts): la entrada avisa si la foto está borrosa.
 */
import type { DocPart } from "@/core/schemas";
import { IngestError, unsupported } from "./errors";
import type { NativeImageMediaType } from "./detect";
import {
  MAX_IMAGE_BYTES,
  MAX_IMAGE_SIDE,
  RESIZED_IMAGE_SIDE,
  RESIZED_JPEG_QUALITY,
  SHARPNESS_SIDE,
  formatBytes,
} from "./limits";
import { toBase64 } from "./bytes";
import { laplacianVariance } from "./sharpness";

type SharpFactory = (typeof import("sharp"))["default"];
type ImagePart = Extract<DocPart, { type: "image" }>;

export interface PreparedImage {
  part: ImagePart;
  /** Ancho y alto originales (ya enderezados). null si no se pudieron medir. */
  width: number | null;
  height: number | null;
  /**
   * Nitidez (varianza del laplaciano a SHARPNESS_SIDE px). null si no se pudo medir: sin sharp, imagen
   * lisa o que sharp no pudo decodificar para medir.
   */
  sharpness: number | null;
  meta: Record<string, string>;
}

async function importSharp(): Promise<SharpFactory | null> {
  try {
    const mod = await import("sharp");
    return mod.default;
  } catch {
    return null;
  }
}

let loadSharpImpl: () => Promise<SharpFactory | null> = importSharp;
let sharpPromise: Promise<SharpFactory | null> | null = null;

function loadSharp(): Promise<SharpFactory | null> {
  sharpPromise ??= loadSharpImpl();
  return sharpPromise;
}

/** Solo para pruebas: simula que sharp no está disponible. Con null vuelve al cargador real. */
export function setSharpLoaderForTests(loader: (() => Promise<SharpFactory | null>) | null): void {
  sharpPromise = null;
  loadSharpImpl = loader ?? importSharp;
}

/**
 * Mide la nitidez: endereza según EXIF, aplana la transparencia sobre blanco, pasa a grises y reduce a
 * SHARPNESS_SIDE px de lado largo (sin agrandar). null si falla.
 */
async function measureSharpness(sharp: SharpFactory, bytes: Uint8Array): Promise<number | null> {
  try {
    const { data, info } = await sharp(bytes, { failOn: "none", animated: false })
      .rotate()
      .flatten({ background: "#ffffff" })
      .greyscale()
      .resize({ width: SHARPNESS_SIDE, height: SHARPNESS_SIDE, fit: "inside", withoutEnlargement: true })
      .raw()
      .toBuffer({ resolveWithObject: true });
    return laplacianVariance(data, info.width, info.height, info.channels);
  } catch {
    return null;
  }
}

/**
 * Nitidez de una imagen en píxeles crudos (la imagen de una página de un PDF escaneado), igual que
 * measureSharpness. null sin sharp, con un formato de píxel desconocido o si falla.
 */
export async function measureRawSharpness(pixels: Uint8Array | Uint8ClampedArray, width: number, height: number, channels: number): Promise<number | null> {
  if (channels !== 1 && channels !== 2 && channels !== 3 && channels !== 4) return null;
  const sharp = await loadSharp();
  if (!sharp) return null;
  try {
    const { data, info } = await sharp(Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength), { raw: { width, height, channels } })
      .flatten({ background: "#ffffff" })
      .greyscale()
      .resize({ width: SHARPNESS_SIDE, height: SHARPNESS_SIDE, fit: "inside", withoutEnlargement: true })
      .raw()
      .toBuffer({ resolveWithObject: true });
    return laplacianVariance(data, info.width, info.height, info.channels);
  } catch {
    return null;
  }
}

/** Intentos de reducción: el primero es el pedido (2000 px, calidad 85); los demás, por si aún pesa mucho. */
const ATTEMPTS: readonly { side: number; quality: number }[] = [
  { side: RESIZED_IMAGE_SIDE, quality: RESIZED_JPEG_QUALITY },
  { side: RESIZED_IMAGE_SIDE, quality: 70 },
  { side: 1600, quality: 70 },
  { side: 1200, quality: 60 },
];

/**
 * Prepara una imagen para el modelo.
 * @param mediaType tipo detectado por bytes mágicos.
 * @param native true si el modelo la acepta tal cual (PNG, JPEG, WEBP, GIF).
 */
export async function prepareImage(
  bytes: Uint8Array,
  mediaType: string,
  native: boolean,
  filename: string,
): Promise<PreparedImage> {
  const sharp = await loadSharp();
  if (!sharp) {
    if (native && bytes.byteLength <= MAX_IMAGE_BYTES) {
      return {
        part: { type: "image", mediaType: mediaType as NativeImageMediaType, base64: toBase64(bytes) },
        width: null,
        height: null,
        sharpness: null,
        meta: { resized: "false" },
      };
    }
    throw new IngestError(
      `No se pudo procesar la imagen «${filename}» (${formatBytes(bytes.byteLength)}) en este servidor. Envíala como PNG o JPG de menos de ${formatBytes(MAX_IMAGE_BYTES)}.`,
      native ? "too_large" : "unsupported",
    );
  }

  let width: number;
  let height: number;
  let orientation = 1;
  try {
    const md = await sharp(bytes, { failOn: "none" }).metadata();
    orientation = md.orientation ?? 1;
    const rotated = orientation >= 5 && orientation <= 8;
    width = (rotated ? md.height : md.width) ?? 0;
    height = (rotated ? md.width : md.height) ?? 0;
    if (!width || !height) throw new Error("sin dimensiones");
  } catch {
    if (!native) {
      throw unsupported(
        mediaType === "image/heic"
          ? `foto HEIC del iPhone («${filename}») que no se pudo convertir`
          : `imagen ${mediaType.replace("image/", "").toUpperCase()} («${filename}») que no se pudo convertir`,
        "Envíala como JPG o PNG (en el iPhone: compártela como JPG o haz una captura de pantalla).",
      );
    }
    throw new IngestError(`La imagen «${filename}» está dañada o incompleta.`, "corrupt");
  }

  const sharpness = await measureSharpness(sharp, bytes);
  const baseMeta: Record<string, string> = { width: String(width), height: String(height) };
  if (sharpness != null) baseMeta.sharpness = String(Math.round(sharpness));
  const needsProcessing =
    !native || bytes.byteLength > MAX_IMAGE_BYTES || Math.max(width, height) > MAX_IMAGE_SIDE || orientation !== 1;

  if (!needsProcessing) {
    return {
      part: { type: "image", mediaType: mediaType as NativeImageMediaType, base64: toBase64(bytes) },
      width,
      height,
      sharpness,
      meta: { ...baseMeta, resized: "false" },
    };
  }

  for (const { side, quality } of ATTEMPTS) {
    let out: { data: Buffer; info: { width: number; height: number } };
    try {
      out = await sharp(bytes, { failOn: "none", animated: false })
        .rotate()
        .resize({ width: side, height: side, fit: "inside", withoutEnlargement: true })
        .flatten({ background: "#ffffff" })
        .jpeg({ quality })
        .toBuffer({ resolveWithObject: true });
    } catch {
      throw new IngestError(`La imagen «${filename}» está dañada o no se pudo procesar.`, "corrupt");
    }
    if (out.data.byteLength <= MAX_IMAGE_BYTES) {
      return {
        part: { type: "image", mediaType: "image/jpeg", base64: out.data.toString("base64") },
        width,
        height,
        sharpness,
        meta: {
          ...baseMeta,
          resized: "true",
          outputWidth: String(out.info.width),
          outputHeight: String(out.info.height),
          outputBytes: String(out.data.byteLength),
        },
      };
    }
  }
  throw new IngestError(
    `La imagen «${filename}» sigue pesando más de ${formatBytes(MAX_IMAGE_BYTES)} después de reducirla. Envía una captura más pequeña.`,
    "too_large",
  );
}
