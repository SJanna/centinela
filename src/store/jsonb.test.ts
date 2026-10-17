import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { toJsonbSafe, toPgSafeString } from "./jsonb";

describe("toPgSafeString", () => {
  it("cambia NUL y sustitutos sueltos por «�» y respeta pares válidos", () => {
    expect(toPgSafeString("a\u0000b")).toBe("a�b");
    expect(toPgSafeString("x\uD800y")).toBe("x�y");
    expect(toPgSafeString("x\uDC00y")).toBe("x�y");
    expect(toPgSafeString("emoji 😀 ñ")).toBe("emoji 😀 ñ");
  });
});

describe("toJsonbSafe", () => {
  it("limpia textos y claves anidados sin tocar lo demás", () => {
    const input = { "k\u0000": ["v\u0000", 1, null, true, { deep: "\uD800" }], n: Number.NaN, u: undefined };
    expect(toJsonbSafe(input)).toEqual({ "k�": ["v�", 1, null, true, { deep: "�" }], n: null });
  });

  it("no cambia un JSON que ya era válido para Postgres", () => {
    const safe = fc.string().filter((s) => toPgSafeString(s) === s);
    const json = fc.letrec((tie) => ({
      value: fc.oneof(
        { depthSize: "small" },
        safe,
        fc.integer(),
        fc.boolean(),
        fc.constant(null),
        fc.array(tie("value"), { maxLength: 4 }),
        fc.dictionary(safe, tie("value"), { maxKeys: 4 }),
      ),
    })).value;
    fc.assert(
      fc.property(json, (v) => {
        expect(JSON.stringify(toJsonbSafe(v))).toBe(JSON.stringify(v));
      }),
    );
  });

  it("el resultado nunca contiene caracteres que Postgres rechaza", () => {
    const strings = (v: unknown): string[] =>
      typeof v === "string"
        ? [v]
        : Array.isArray(v)
          ? v.flatMap(strings)
          : v !== null && typeof v === "object"
            ? Object.entries(v).flatMap(([k, x]) => [k, ...strings(x)])
            : [];
    const nasty = fc.string({ unit: fc.constantFrom("a", "\u0000", "\uD800", "\uDC00", "😀") });
    fc.assert(
      fc.property(fc.object({ key: nasty, values: [nasty, fc.integer()] }), (v) => {
        for (const s of strings(toJsonbSafe(v))) expect(toPgSafeString(s)).toBe(s);
      }),
    );
  });
});
