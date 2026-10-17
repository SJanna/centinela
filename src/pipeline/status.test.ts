import { afterEach, describe, expect, it, vi } from "vitest";
import { PROMPT_VERSION } from "../extract";
import { resetDbForTests, saveCompany } from "../store";
import { loadDatasetCompany } from "./dataset";
import { getAppStatus, isAccessProtected, modelsFor, readingMode } from "./status";

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

  it("modelos por modo", () => {
    expect(modelsFor("live")).toEqual(["claude-sonnet-5-5", "claude-haiku-5-5"]);
    expect(modelsFor("simulated")).toEqual(["simulado"]);
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
    vi.stubEnv("DEMO_ACCESS_CODE", "");
    const status = await getAppStatus();
    expect(status).toEqual({
      readingMode: "simulated",
      models: ["simulado"],
      promptVersion: PROMPT_VERSION,
      accessProtected: false,
      companyName: loadDatasetCompany().name,
    });
  });

  it("con empresa guardada usa su nombre; refleja el código de acceso", async () => {
    await resetDbForTests();
    await saveCompany({ ...loadDatasetCompany(), name: "Otra Empresa S.A.S." });
    vi.stubEnv("READING_MODE", "live");
    vi.stubEnv("DEMO_ACCESS_CODE", "abc");
    const status = await getAppStatus();
    expect(status.companyName).toBe("Otra Empresa S.A.S.");
    expect(status.readingMode).toBe("live");
    expect(status.models).toEqual(["claude-sonnet-5-5", "claude-haiku-5-5"]);
    expect(status.accessProtected).toBe(true);
  });
});
