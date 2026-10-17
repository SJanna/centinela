import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { IngestError } from "./errors";
import { prepareImage, setSharpLoaderForTests } from "./image";
import { makeImage, makeNoisePng } from "./test-fixtures";

afterEach(() => setSharpLoaderForTests(null));

describe("prepareImage", () => {
  it("endereza fotos con orientación EXIF (aunque sean pequeñas)", async () => {
    // 60 × 40 guardada con orientación 6 (girada 90°): se ve de 40 × 60.
    const bytes = await makeImage("jpeg", 60, 40, { orientation: 6 });
    const img = await prepareImage(bytes, "image/jpeg", true, "foto.jpg");
    expect(img.width).toBe(40);
    expect(img.height).toBe(60);
    expect(img.meta.resized).toBe("true");
    const md = await sharp(Buffer.from(img.part.base64, "base64")).metadata();
    expect(md.width).toBe(40);
    expect(md.height).toBe(60);
  });

  it("no agranda imágenes pequeñas que se convierten", async () => {
    const bytes = await makeImage("tiff", 300, 100);
    const img = await prepareImage(bytes, "image/tiff", false, "x.tiff");
    expect(img.part.mediaType).toBe("image/jpeg");
    expect(img.meta).toMatchObject({ outputWidth: "300", outputHeight: "100" });
  });

  it("sin sharp: imagen pequeña pasa tal cual", async () => {
    setSharpLoaderForTests(async () => null);
    const bytes = await makeImage("png", 10, 10);
    const img = await prepareImage(bytes, "image/png", true, "x.png");
    expect(img.part).toEqual({ type: "image", mediaType: "image/png", base64: Buffer.from(bytes).toString("base64") });
    expect(img.width).toBeNull();
  });

  it("sin sharp: imagen pesada → IngestError", async () => {
    const bytes = await makeNoisePng(1200, 1100);
    setSharpLoaderForTests(async () => null);
    await expect(prepareImage(bytes, "image/png", true, "x.png")).rejects.toBeInstanceOf(IngestError);
  });

  it("sin sharp: formato que hay que convertir → IngestError", async () => {
    const bytes = await makeImage("tiff", 10, 10);
    setSharpLoaderForTests(async () => null);
    await expect(prepareImage(bytes, "image/tiff", false, "x.tiff")).rejects.toThrow(/No se pudo procesar la imagen/);
  });
});
