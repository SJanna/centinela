/**
 * El red team como prueba de regresión (corre en `npm run test` y en la CI, sin costo).
 *
 * - Ningún caso puede terminar en un pago indebido, salvo los de un hallazgo ABIERTO de
 *   redteam/FINDINGS.md (OPEN_FINDINGS en cases.ts).
 * - Los casos de un hallazgo abierto deben seguir fallando: si uno empieza a pasar, hay que cerrar
 *   el hallazgo (sacarlo de OPEN_FINDINGS y anotar el arreglo en FINDINGS.md).
 * - Todo caso que falle tiene que pertenecer a un hallazgo abierto.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { CASES, OPEN_FINDINGS } from "./cases";
import { runRedteam, type Result } from "./run";

let results: Result[] = [];

beforeAll(async () => {
  results = await runRedteam({ writeFiles: false });
}, 300_000);

const findingOf = new Map(CASES.map((c) => [c.id, c.finding]));
const isOpen = (id: string) => {
  const f = findingOf.get(id);
  return f != null && OPEN_FINDINGS.has(f);
};

describe("red team", () => {
  it("cero pagos indebidos fuera de los hallazgos abiertos", () => {
    const leaks = results.filter((r) => !r.ok && r.severity === "dinero" && !isOpen(r.id)).map((r) => `${r.id}: ${r.attack}`);
    expect(leaks).toEqual([]);
  });

  it("todo caso que falla pertenece a un hallazgo abierto", () => {
    const untracked = results.filter((r) => !r.ok && !isOpen(r.id)).map((r) => `${r.id} (${r.outcome}): ${r.attack}`);
    expect(untracked).toEqual([]);
  });

  it("los casos de un hallazgo abierto siguen fallando (si pasan, cierra el hallazgo en FINDINGS.md)", () => {
    const nowPassing = results.filter((r) => r.ok && isOpen(r.id)).map((r) => `${r.id} → ${findingOf.get(r.id)}`);
    expect(nowPassing).toEqual([]);
  });
});
