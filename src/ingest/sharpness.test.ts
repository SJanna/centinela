import PDFDocument from "pdfkit";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { normalizeFile } from "./index";
import { MIN_IMAGE_SHARPNESS, SHARPNESS_SIDE } from "./limits";
import { blurryImageWarning, isBlurry, laplacianVariance } from "./sharpness";
import { makeEml, makePdf } from "./test-fixtures";

/**
 * «Documento» sin fuentes: renglones de trazos oscuros de 2–4 px sobre papel, como texto visto de
 * lejos. Determinista. width × height en px; los trazos escalan con el ancho.
 */
function documentSvg(width: number, height: number): string {
  const k = width / 1200;
  const rects: string[] = [];
  let seed = 7;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let row = 0; row < 48; row++) {
    const y = (120 + row * 28) * k;
    let x = 90 * k;
    while (x < width - 120 * k) {
      const w = (2 + Math.floor(rand() * 3)) * k;
      const h = (10 + Math.floor(rand() * 6)) * k;
      rects.push(`<rect x="${x.toFixed(1)}" y="${(y - h).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="#1F2937"/>`);
      x += w + (3 + rand() * 6) * k + (rand() < 0.15 ? 14 * k : 0);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#F5F3EC"/>${rects.join("")}</svg>`;
}

async function documentJpeg(opts: { width?: number; height?: number; blur?: number; rotate?: number } = {}): Promise<Uint8Array> {
  const width = opts.width ?? 1200;
  const height = opts.height ?? 1600;
  let img = sharp(Buffer.from(documentSvg(width, height)));
  if (opts.blur) img = sharp(await img.png().toBuffer()).blur(opts.blur);
  if (opts.rotate) img = sharp(await img.png().toBuffer()).rotate(opts.rotate);
  return new Uint8Array(await img.jpeg({ quality: 82 }).toBuffer());
}

async function grayPixels(bytes: Uint8Array): Promise<{ data: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(bytes).greyscale().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

describe("laplacianVariance", () => {
  it("una imagen lisa no se mide (no hay bordes: llamarla borrosa sería falso)", () => {
    expect(laplacianVariance(new Uint8Array(100 * 80).fill(200), 100, 80)).toBeNull();
    // Un degradé suave tampoco tiene nada que leer.
    const ramp = new Uint8Array(100 * 80).map((_, i) => 120 + Math.floor((i % 100) / 20));
    expect(laplacianVariance(ramp, 100, 80)).toBeNull();
  });

  it("una imagen demasiado chica o incompleta no se mide", () => {
    expect(laplacianVariance(new Uint8Array([0, 255, 0, 255]), 2, 2)).toBeNull();
    expect(laplacianVariance(new Uint8Array(10), 10, 10)).toBeNull();
  });

  it("un borde nítido mide más que el mismo borde desenfocado", () => {
    const w = 40;
    const h = 40;
    const step = new Uint8Array(w * h).map((_, i) => (i % w < 20 ? 30 : 230));
    const soft = new Uint8Array(w * h).map((_, i) => {
      const x = i % w;
      return Math.round(30 + 200 / (1 + Math.exp(-(x - 19.5) / 2)));
    });
    const sharpScore = laplacianVariance(step, w, h)!;
    const softScore = laplacianVariance(soft, w, h)!;
    expect(sharpScore).toBeGreaterThan(softScore * 10);
  });

  it("lee el primer canal cuando hay varios", () => {
    const w = 30;
    const h = 30;
    const gray = new Uint8Array(w * h).map((_, i) => (Math.floor(i / 3) % 2 === 0 ? 20 : 220));
    const rgb = new Uint8Array(w * h * 3).map((_, i) => gray[Math.floor(i / 3)]);
    expect(laplacianVariance(rgb, w, h, 3)).toBeCloseTo(laplacianVariance(gray, w, h)!, 6);
  });

  it("baja con el desenfoque de una foto y cruza el mínimo antes de sigma 2", async () => {
    const scores: number[] = [];
    for (const blur of [0.6, 1, 2, 3]) {
      const { data, width, height } = await grayPixels(await documentJpeg({ blur }));
      scores.push(laplacianVariance(data, width, height)!);
    }
    for (let i = 1; i < scores.length; i++) expect(scores[i]).toBeLessThan(scores[i - 1]);
    expect(scores[0]).toBeGreaterThanOrEqual(MIN_IMAGE_SHARPNESS);
    expect(scores[2]).toBeLessThan(MIN_IMAGE_SHARPNESS);
    expect(scores[3]).toBeLessThan(MIN_IMAGE_SHARPNESS);
  });
});

describe("isBlurry y el mensaje", () => {
  it("compara con el mínimo después de redondear, como lo muestra el mensaje", () => {
    expect(isBlurry(null)).toBe(false);
    expect(isBlurry(MIN_IMAGE_SHARPNESS - 0.6)).toBe(true);
    expect(isBlurry(MIN_IMAGE_SHARPNESS - 0.4)).toBe(false);
    expect(isBlurry(MIN_IMAGE_SHARPNESS)).toBe(false);
  });

  it("dice la nitidez medida y el mínimo, y qué hacer", () => {
    expect(blurryImageWarning(41.6)).toEqual({
      code: "blurry_image",
      message: "La foto está borrosa (nitidez 42; mínimo 120): una persona debe revisarla.",
    });
    expect(blurryImageWarning(88.2, { attachment: "factura-octubre.jpg" }).message).toBe(
      "La foto adjunta «factura-octubre.jpg» está borrosa (nitidez 88; mínimo 120): una persona debe revisarla.",
    );
  });
});

describe("normalizeFile mide la nitidez de las fotos", () => {
  it("una foto borrosa deja el aviso blurry_image y la nitidez en meta", async () => {
    const doc = await normalizeFile(await documentJpeg({ blur: 3 }), "foto.jpg");
    const score = Number(doc.meta.sharpness);
    expect(score).toBeLessThan(MIN_IMAGE_SHARPNESS);
    expect(doc.warnings).toEqual([
      { code: "blurry_image", message: `La foto está borrosa (nitidez ${score}; mínimo ${MIN_IMAGE_SHARPNESS}): una persona debe revisarla.` },
    ]);
  });

  it("una foto nítida no deja avisos", async () => {
    const doc = await normalizeFile(await documentJpeg({ blur: 0.6 }), "foto.jpg");
    expect(Number(doc.meta.sharpness)).toBeGreaterThanOrEqual(MIN_IMAGE_SHARPNESS);
    expect(doc.warnings).toBeUndefined();
  });

  it("no depende de que la foto esté girada", async () => {
    const upright = await normalizeFile(await documentJpeg({ blur: 1 }), "a.jpg");
    const turned = await normalizeFile(await documentJpeg({ blur: 1, rotate: 90 }), "b.jpg");
    const a = Number(upright.meta.sharpness);
    const b = Number(turned.meta.sharpness);
    expect(Math.abs(a - b) / a).toBeLessThan(0.05);
  });

  it(`reduce las fotos grandes a ${SHARPNESS_SIDE} px de lado largo antes de medir`, async () => {
    // El mismo documento dibujado al doble de resolución mide casi lo mismo una vez reducido.
    const small = await normalizeFile(await documentJpeg({ width: 1200, height: 1600 }), "a.jpg");
    const large = await normalizeFile(await documentJpeg({ width: 2400, height: 3200 }), "b.jpg");
    const a = Number(small.meta.sharpness);
    const b = Number(large.meta.sharpness);
    expect(Math.abs(a - b) / a).toBeLessThan(0.25);
  });

  it("una imagen lisa (un fondo, un adjunto en blanco) no se mide ni avisa", async () => {
    const bytes = await sharp({ create: { width: 400, height: 300, channels: 3, background: "#FFFFFF" } }).png().toBuffer();
    const doc = await normalizeFile(new Uint8Array(bytes), "blanco.png");
    expect(doc.meta.sharpness).toBeUndefined();
    expect(doc.warnings).toBeUndefined();
  });

  it("una foto borrosa adjunta a un correo deja el aviso con el nombre del adjunto", async () => {
    const eml = makeEml({
      subject: "Factura de octubre",
      text: "Hola, adjunto la factura de octubre.",
      attachments: [
        { filename: "factura-octubre.jpg", contentType: "image/jpeg", content: await documentJpeg({ blur: 3 }) },
        { filename: "otra.jpg", contentType: "image/jpeg", content: await documentJpeg({ blur: 0.6 }) },
      ],
    });
    const doc = await normalizeFile(eml, "correo.eml");
    expect(doc.warnings).toEqual([
      {
        code: "blurry_image",
        message: expect.stringMatching(/^La foto adjunta «factura-octubre\.jpg» está borrosa \(nitidez \d+; mínimo 120\): una persona debe revisarla\.$/),
      },
    ]);
  });
});

/** PDF «escaneado»: cada página es una imagen JPEG que la cubre, sin capa de texto. */
function scannedPdf(pages: Uint8Array[]): Promise<Uint8Array> {
  const doc = new PDFDocument({ size: "A4", margin: 0, autoFirstPage: false });
  const chunks: Buffer[] = [];
  const done = new Promise<Uint8Array>((resolve, reject) => {
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    doc.on("error", reject);
  });
  for (const page of pages) {
    doc.addPage({ size: "A4", margin: 0 });
    doc.image(Buffer.from(page), 0, 0, { width: doc.page.width, height: doc.page.height });
  }
  doc.end();
  return done;
}

describe("normalizeFile mide las páginas de un PDF escaneado", () => {
  it("una página borrosa deja el aviso con su número; la nítida no", async () => {
    const pdf = await scannedPdf([await documentJpeg({ blur: 0.6 }), await documentJpeg({ blur: 3 })]);
    const doc = await normalizeFile(pdf, "escaneo.pdf");
    expect(doc.meta.textLayer).toBe("false");
    const [first, second] = doc.meta.pageSharpness.split(" ").map((p) => Number(p.split(":")[1]));
    expect(first).toBeGreaterThanOrEqual(MIN_IMAGE_SHARPNESS);
    expect(second).toBeLessThan(MIN_IMAGE_SHARPNESS);
    expect(doc.warnings).toEqual([
      { code: "blurry_image", message: `La página 2 del PDF escaneado está borrosa (nitidez ${second}; mínimo ${MIN_IMAGE_SHARPNESS}): una persona debe revisarla.` },
    ]);
  });

  it("un PDF escaneado nítido no deja avisos", async () => {
    const doc = await normalizeFile(await scannedPdf([await documentJpeg({ blur: 0.6 })]), "escaneo.pdf");
    expect(doc.meta.pageSharpness).toMatch(/^1:\d+$/);
    expect(doc.warnings).toBeUndefined();
  });

  it("un PDF con texto no se mide", async () => {
    const doc = await normalizeFile(await makePdf(), "factura.pdf");
    expect(doc.meta.textLayer).toBe("true");
    expect(doc.meta.pageSharpness).toBeUndefined();
    expect(doc.warnings).toBeUndefined();
  });

  it("un PDF escaneado y borroso adjunto a un correo deja el aviso con el nombre del adjunto", async () => {
    const eml = makeEml({
      subject: "Factura de octubre",
      text: "Adjunto el escaneo.",
      attachments: [{ filename: "escaneo.pdf", contentType: "application/pdf", content: await scannedPdf([await documentJpeg({ blur: 3 })]) }],
    });
    const doc = await normalizeFile(eml, "correo.eml");
    expect(doc.warnings).toEqual([
      {
        code: "blurry_image",
        message: expect.stringMatching(/^La página 1 del PDF escaneado adjunto «escaneo\.pdf» está borrosa \(nitidez \d+; mínimo 120\): una persona debe revisarla\.$/),
      },
    ]);
  });
});
