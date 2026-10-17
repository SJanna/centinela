import { afterEach, describe, expect, it, vi } from "vitest";
import { PROMPT_VERSION, PROMPT_VERSION_B } from "../extract";
import { resetDbForTests, saveCompany } from "../store";
import { loadDatasetCompany } from "./dataset";
import { getAppStatus, isAccessProtected, modelsFor, readersFor, readingMode } from "./status";

describe("readingMode", () => {
  it("respeta READING_MODE explícito", () => {
    expect(readingMode({ READING_MODE: "live" })).toBe("live");
    expect(readingMode({ READING_MODE: "simulated", ANTHROPIC_API_KEY: "sk" })).toBe("simulated");
    expect(readingMode({ READING_MODE: " LIVE " })).toBe("live");
  });

  it("auto (o sin valor, o desconocido) → live solo si hay ANTHROPIC_API_KEY", () => {
    expect(readingMode({})).toBe("simulated");
    expect(readingMode({ READING_MODE: "auto" })).toBe("simulated");
    expect(readingMode({ READING_MODE: "auto", ANTHROPIC_API_KEY: "sk-ant" })).toBe("live");
    expect(readingMode({ ANTHROPIC_API_KEY: "  " })).toBe("simulated");
    expect(readingMode({ READING_MODE: "otro", ANTHROPIC_API_KEY: "sk-ant" })).toBe("live");
  });

  it("modelos por modo y perfil", () => {
    expect(modelsFor("live", "economico")).toEqual(["claude-haiku-5-5"]);
    expect(modelsFor("live", "calidad")).toEqual(["claude-sonnet-5-5", "claude-haiku-5-5"]);
    expect(modelsFor("simulated", "economico")).toEqual(["simulado"]);
    expect(modelsFor("simulated", "calidad")).toEqual(["simulado"]);
  });

  it("lectores por modo y perfil: ids de siempre, modelo y versión de prompt de cada uno", () => {
    expect(readersFor("live", "economico")).toEqual([
      { id: "lector-a", model: "claude-haiku-5-5", promptVersion: PROMPT_VERSION },
      { id: "lector-b", model: "claude-haiku-5-5", promptVersion: PROMPT_VERSION_B },
    ]);
    expect(readersFor("live", "calidad")).toEqual([
      { id: "lector-a", model: "claude-sonnet-5-5", promptVersion: PROMPT_VERSION },
      { id: "lector-b", model: "claude-haiku-5-5", promptVersion: PROMPT_VERSION },
    ]);
    expect(readersFor("simulated", "economico")).toEqual([
      { id: "lector-a", model: "simulado", promptVersion: PROMPT_VERSION },
      { id: "lector-b", model: "simulado", promptVersion: PROMPT_VERSION },
    ]);
  });

  it("acceso protegido solo con DEMO_ACCESS_CODE no vacío", () => {
    expect(isAccessProtected({})).toBe(false);
    expect(isAccessProtected({ DEMO_ACCESS_CODE: " " })).toBe(false);
    expect(isAccessProtected({ DEMO_ACCESS_CODE: "1234" })).toBe(true);
  });
});

describe("getAppStatus", () => {
  afterEach(async () => {
    vi.unstubAllEnvs();
    await resetDbForTests();
  });

  it("sin empresa guardada usa el nombre del dataset", async () => {
    await resetDbForTests();
    vi.stubEnv("READING_MODE", "simulated");
    vi.stubEnv("READER_PROFILE", "calidad");
    vi.stubEnv("DEMO_ACCESS_CODE", "");
    const status = await getAppStatus();
    expect(status).toEqual({
      readingMode: "simulated",
      readerProfile: null,
      models: ["simulado"],
      promptVersion: PROMPT_VERSION,
      readers: [
        { id: "lector-a", model: "simulado", promptVersion: PROMPT_VERSION },
        { id: "lector-b", model: "simulado", promptVersion: PROMPT_VERSION },
      ],
      accessProtected: false,
      companyName: loadDatasetCompany().name,
    });
  });

  it("con empresa guardada usa su nombre; refleja el código de acceso", async () => {
    await resetDbForTests();
    await saveCompany({ ...loadDatasetCompany(), name: "Otra Empresa S.A.S." });
    vi.stubEnv("READING_MODE", "live");
    vi.stubEnv("READER_PROFILE", "");
    vi.stubEnv("DEMO_ACCESS_CODE", "abc");
    const status = await getAppStatus();
    expect(status.companyName).toBe("Otra Empresa S.A.S.");
    expect(status.readingMode).toBe("live");
    expect(status.readerProfile).toBe("economico");
    expect(status.models).toEqual(["claude-haiku-5-5"]);
    expect(status.promptVersion).toBe(PROMPT_VERSION);
    expect(status.readers.map((r) => `${r.id} · ${r.model} · ${r.promptVersion}`)).toEqual([
      "lector-a · claude-haiku-5-5 · v3",
      "lector-b · claude-haiku-5-5 · v3b",
    ]);
    expect(status.accessProtected).toBe(true);
  });

  it("live con READER_PROFILE=calidad devuelve Sonnet 5.5 + Haiku 5.5 y el perfil", async () => {
    await resetDbForTests();
    vi.stubEnv("READING_MODE", "live");
    vi.stubEnv("READER_PROFILE", "calidad");
    const status = await getAppStatus();
    expect(status.readerProfile).toBe("calidad");
    expect(status.models).toEqual(["claude-sonnet-5-5", "claude-haiku-5-5"]);
    expect(status.readers.map((r) => r.promptVersion)).toEqual([PROMPT_VERSION, PROMPT_VERSION]);
  });
});
