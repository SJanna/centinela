import { describe, expect, it } from "vitest";
import { isActivePath, isBareRoute, sectionFor } from "./config";
import { resolveReadingMode } from "./status";

describe("navegación", () => {
  it("'/' solo coincide consigo misma; las secciones incluyen sus subrutas", () => {
    expect(isActivePath("/", "/")).toBe(true);
    expect(isActivePath("/registro", "/")).toBe(false);
    expect(isActivePath("/registro/abc", "/registro")).toBe(true);
    expect(isActivePath("/registros", "/registro")).toBe(false);
  });

  it("sectionFor da el título del breadcrumb", () => {
    expect(sectionFor("/")?.label).toBe("Resumen");
    expect(sectionFor("/registro/dec-1")?.label).toBe("Registro");
    expect(sectionFor("/dev/ui")?.label).toBe("Guía de estilo");
    expect(sectionFor("/otra")).toBeNull();
  });

  it("la pantalla de acceso va sin armazón", () => {
    expect(isBareRoute("/acceso")).toBe(true);
    expect(isBareRoute("/")).toBe(false);
  });
});

describe("resolveReadingMode", () => {
  it("auto depende de la clave de API", () => {
    expect(resolveReadingMode({})).toBe("simulated");
    expect(resolveReadingMode({ ANTHROPIC_API_KEY: "sk-test" })).toBe("live");
    expect(resolveReadingMode({ READING_MODE: "auto", ANTHROPIC_API_KEY: "  " })).toBe("simulated");
  });

  it("respeta READING_MODE explícito", () => {
    expect(resolveReadingMode({ READING_MODE: "simulated", ANTHROPIC_API_KEY: "sk-test" })).toBe("simulated");
    expect(resolveReadingMode({ READING_MODE: "LIVE" })).toBe("live");
  });
});
