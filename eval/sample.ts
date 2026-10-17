/**
 * Muestra estratificada para pilotos del banco de pruebas, en dos niveles: primero reparte `size`
 * casos entre los grupos (la trampa principal) en proporción a su tamaño y con al menos uno por grupo
 * cuando alcanza; después, dentro de cada grupo, entre sus estratos (el formato) del mismo modo. Elige
 * dentro de cada estrato con una semilla fija: misma semilla → misma muestra.
 *
 * Dos niveles y no «trampa × formato» plano: con ~100 combinaciones y una muestra de 150, el mínimo de
 * uno por combinación se comería la muestra y casi no quedarían facturas legítimas para medir las
 * escaladas de más.
 */

/** Generador determinista (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Stratifiable {
  id: string;
  /** Primer nivel (p. ej. la trampa principal). */
  group: string;
  /** Segundo nivel dentro del grupo (p. ej. el formato). */
  stratum: string;
}

export const DEFAULT_SAMPLE_SEED = 17;

/**
 * Reparte `size` entre baldes de los tamaños dados: proporcional (mayores restos), con al menos uno
 * por balde si `size` alcanza, sin pasar del tamaño de cada balde. Con menos cupos que baldes, los
 * elige al azar ponderando por tamaño.
 */
function allocate(sizes: number[], size: number, rand: () => number): number[] {
  const n = sizes.length;
  const total = sizes.reduce((s, x) => s + x, 0);
  const quota = new Array<number>(n).fill(0);
  if (size >= total) return [...sizes];
  if (size < n) {
    const pool = sizes.map((s, i) => ({ s, i }));
    for (let k = 0; k < size; k++) {
      let r = rand() * pool.reduce((acc, x) => acc + x.s, 0);
      let idx = 0;
      while (idx < pool.length - 1 && r >= pool[idx].s) r -= pool[idx++].s;
      quota[pool[idx].i] = 1;
      pool.splice(idx, 1);
    }
    return quota;
  }
  quota.fill(1);
  const rest = size - n;
  const capacity = sizes.map((s) => s - 1);
  const capTotal = capacity.reduce((s, x) => s + x, 0);
  const exact = capacity.map((c) => (capTotal === 0 ? 0 : (rest * c) / capTotal));
  exact.forEach((e, i) => (quota[i] += Math.floor(e)));
  let left = size - quota.reduce((s, x) => s + x, 0);
  const order = exact.map((e, i) => ({ frac: e - Math.floor(e), i })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    if (quota[i] < sizes[i]) {
      quota[i]++;
      left--;
    }
  }
  return quota;
}

/** Ids de la muestra, en el orden original de `items`. */
export function stratifiedSample(items: readonly Stratifiable[], size: number, seed = DEFAULT_SAMPLE_SEED): string[] {
  if (!Number.isInteger(size) || size <= 0) throw new Error("El tamaño de la muestra debe ser un entero positivo.");
  if (size >= items.length) return items.map((i) => i.id);
  const rand = mulberry32(seed);
  const groups = new Map<string, Map<string, string[]>>();
  for (const it of items) {
    const g = groups.get(it.group) ?? new Map<string, string[]>();
    g.set(it.stratum, [...(g.get(it.stratum) ?? []), it.id]);
    groups.set(it.group, g);
  }
  const groupKeys = [...groups.keys()].sort();
  const groupSizes = groupKeys.map((k) => [...groups.get(k)!.values()].reduce((s, ids) => s + ids.length, 0));
  const groupQuota = allocate(groupSizes, size, rand);
  const chosen = new Set<string>();
  groupKeys.forEach((gk, gi) => {
    const strata = groups.get(gk)!;
    const keys = [...strata.keys()].sort();
    const quota = allocate(
      keys.map((k) => strata.get(k)!.length),
      groupQuota[gi],
      rand,
    );
    keys.forEach((k, si) => {
      const ids = [...strata.get(k)!];
      for (let i = ids.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [ids[i], ids[j]] = [ids[j], ids[i]];
      }
      for (const id of ids.slice(0, quota[si])) chosen.add(id);
    });
  });
  return items.filter((i) => chosen.has(i.id)).map((i) => i.id);
}
