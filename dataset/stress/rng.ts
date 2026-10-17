/**
 * Azar determinista para el plan del set de estrés: misma semilla → mismo plan, byte a byte.
 */
import { hashString, seededRandom } from "../generator/layout";

export class Rng {
  private readonly next: () => number;

  constructor(readonly seed: number) {
    this.next = seededRandom(seed >>> 0);
  }

  /** Generador independiente derivado de una etiqueta: cambiar una parte del plan no mueve las demás. */
  fork(label: string): Rng {
    return new Rng(hashString(`${this.seed}:${label}`));
  }

  float(): number {
    return this.next();
  }

  /** Entero uniforme en [min, max]. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** true con probabilidad p (0–1). */
  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("Rng.pick: lista vacía");
    return items[Math.floor(this.next() * items.length)];
  }

  /** Elige según pesos: [[peso, valor], …]. */
  weighted<T>(options: readonly (readonly [number, T])[]): T {
    const total = options.reduce((s, [w]) => s + w, 0);
    if (total <= 0) throw new Error("Rng.weighted: sin opciones con peso");
    let r = this.next() * total;
    for (const [w, v] of options) {
      if (r < w) return v;
      r -= w;
    }
    return options[options.length - 1][1];
  }

  /** Fisher–Yates en el lugar. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }

  /** Número en [min, max] con `decimals` decimales. */
  decimal(min: number, max: number, decimals: number): number {
    const f = 10 ** decimals;
    return this.int(Math.round(min * f), Math.round(max * f)) / f;
  }
}
