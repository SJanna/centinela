/**
 * Candado de procesamiento: reentrada y orden. Va en su propio archivo: si el candado se trabara,
 * no deja colgadas las demás pruebas del recorrido.
 */
import { describe, expect, it } from "vitest";
import { withProcessingLock } from "./process";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Resuelve con el valor de `p` o con "bloqueado" si tarda más de `ms`. */
function within<T>(p: Promise<T>, ms: number): Promise<T | "bloqueado"> {
  return Promise.race([p, sleep(ms).then(() => "bloqueado" as const)]);
}

describe("withProcessingLock", () => {
  it("es reentrante: una llamada anidada dentro del candado no se bloquea", async () => {
    const result = await within(
      withProcessingLock(() => withProcessingLock(async () => "anidado")),
      500,
    );
    expect(result).toBe("anidado");
    // Y el candado queda libre para la siguiente.
    expect(await within(withProcessingLock(async () => "siguiente"), 500)).toBe("siguiente");
  });

  it("una continuación que corre después de soltar el candado vuelve a hacer fila", async () => {
    const order: string[] = [];
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    let later: Promise<void> | null = null;

    await withProcessingLock(async () => {
      // Queda pendiente y se ejecuta cuando esta tarea ya soltó el candado.
      later = gate.then(() =>
        withProcessingLock(async () => {
          order.push("tardía");
        }),
      );
    });

    const holder = withProcessingLock(async () => {
      open();
      await sleep(30);
      order.push("dueña");
    });
    await holder;
    await later;
    expect(order).toEqual(["dueña", "tardía"]);
  });

  it("sigue serializando llamadas independientes", async () => {
    let active = 0;
    let maxActive = 0;
    const task = async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await sleep(10);
      active--;
    };
    await Promise.all([withProcessingLock(task), withProcessingLock(task), withProcessingLock(task)]);
    expect(maxActive).toBe(1);
  });
});
