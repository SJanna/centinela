import { describe, expect, it } from "vitest";
import {
  DEFAULT_READER_PROFILE,
  READER_PROFILES,
  READER_PROFILE_NAMES,
  parseReaderProfile,
  profileModels,
  profilePromptVersions,
} from "./profiles";

describe("perfiles de lectura", () => {
  it("económico (por defecto): Haiku 5.5 en las dos lecturas, con prompts distintos", () => {
    expect(DEFAULT_READER_PROFILE).toBe("economico");
    expect(READER_PROFILES.economico).toEqual({
      primary: { model: "claude-haiku-5-5", promptVariant: "a" },
      secondary: { model: "claude-haiku-5-5", promptVariant: "b" },
    });
    expect(profileModels("economico")).toEqual(["claude-haiku-5-5"]);
    expect(profilePromptVersions("economico")).toEqual({ primary: "v4", secondary: "v4b" });
  });

  it("calidad: Sonnet 5.5 + Haiku 5.5 con el prompt «a» (el comportamiento anterior)", () => {
    expect(READER_PROFILES.calidad).toEqual({
      primary: { model: "claude-sonnet-5-5", promptVariant: "a" },
      secondary: { model: "claude-haiku-5-5", promptVariant: "a" },
    });
    expect(profileModels("calidad")).toEqual(["claude-sonnet-5-5", "claude-haiku-5-5"]);
    expect(profilePromptVersions("calidad")).toEqual({ primary: "v4", secondary: "v4" });
  });

  it("si las dos lecturas usan el mismo modelo, usan prompts distintos (no son dos copias)", () => {
    for (const name of READER_PROFILE_NAMES) {
      const { primary, secondary } = READER_PROFILES[name];
      if (primary.model === secondary.model) expect(primary.promptVariant, name).not.toBe(secondary.promptVariant);
    }
  });

  it("interpreta READER_PROFILE (mayúsculas, espacios, tilde); vacío o desconocido → económico", () => {
    expect(parseReaderProfile("calidad")).toBe("calidad");
    expect(parseReaderProfile(" CALIDAD ")).toBe("calidad");
    expect(parseReaderProfile("economico")).toBe("economico");
    expect(parseReaderProfile("Económico")).toBe("economico");
    expect(parseReaderProfile(undefined)).toBe("economico");
    expect(parseReaderProfile("")).toBe("economico");
    expect(parseReaderProfile("barato")).toBe("economico");
  });
});
