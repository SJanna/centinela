import { describe, expect, it } from "vitest";
import { stratifiedSample, type Stratifiable } from "./sample";

const items: Stratifiable[] = [];
for (let i = 0; i < 400; i++) {
  const stratum = i < 200 ? "ninguna|pdf" : i < 300 ? "cuenta|eml" : i < 395 ? "duplicado|jpg" : "raro|txt";
  const [group, format] = stratum.split("|");
  // Las legítimas vienen en dos formatos: el segundo nivel también se reparte.
  items.push({ id: `S${String(i + 1).padStart(4, "0")}`, group, stratum: group === "ninguna" && i % 4 === 0 ? "png" : format });
}

describe("muestra estratificada", () => {
  it("tiene el tamaño pedido, sin repetidos, en el orden original", () => {
    const s = stratifiedSample(items, 40, 7);
    expect(s).toHaveLength(40);
    expect(new Set(s).size).toBe(40);
    const order = items.map((i) => i.id);
    expect([...s].sort((a, b) => order.indexOf(a) - order.indexOf(b))).toEqual(s);
  });

  it("cubre todos los estratos (aunque sean chicos) y respeta las proporciones", () => {
    const s = new Set(stratifiedSample(items, 40, 7));
    const per = (g: string) => items.filter((i) => i.group === g && s.has(i.id)).length;
    expect(per("raro")).toBeGreaterThanOrEqual(1);
    expect(per("ninguna")).toBeGreaterThanOrEqual(18);
    expect(per("ninguna")).toBeLessThanOrEqual(21);
    expect(per("cuenta")).toBeGreaterThanOrEqual(9);
    const png = items.filter((i) => i.group === "ninguna" && i.stratum === "png" && s.has(i.id)).length;
    expect(png).toBeGreaterThanOrEqual(3);
    expect(png).toBeLessThanOrEqual(6);
  });

  it("misma semilla → misma muestra; otra semilla → otra", () => {
    expect(stratifiedSample(items, 50, 3)).toEqual(stratifiedSample(items, 50, 3));
    expect(stratifiedSample(items, 50, 3)).not.toEqual(stratifiedSample(items, 50, 4));
  });

  it("menos casos que estratos, o más casos que el total", () => {
    expect(stratifiedSample(items, 2, 1)).toHaveLength(2);
    expect(stratifiedSample(items, 1000, 1)).toHaveLength(400);
    expect(() => stratifiedSample(items, 0, 1)).toThrow();
  });
});
