/**
 * Intervalos de confianza exactos (Clopper-Pearson) para proporciones del banco de pruebas.
 * Sin dependencias: función beta incompleta regularizada (fracción continua) e inversa por bisección.
 */

/** ln Γ(x) (aproximación de Lanczos, error < 1e-14 para x > 0). */
function lnGamma(x: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  const xx = x - 1;
  let a = c[0];
  const t = xx + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (xx + i);
  return 0.5 * Math.log(2 * Math.PI) + (xx + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Fracción continua de la beta incompleta (Numerical Recipes, betacf). */
function betaContinuedFraction(a: number, b: number, x: number): number {
  const maxIter = 300;
  const eps = 3e-16;
  const tiny = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= maxIter; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < eps) break;
  }
  return h;
}

/** Función beta incompleta regularizada I_x(a, b). */
export function regularizedBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lnFront = lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x);
  if (x < (a + 1) / (a + b + 2)) return (Math.exp(lnFront) * betaContinuedFraction(a, b, x)) / a;
  return 1 - (Math.exp(lnFront) * betaContinuedFraction(b, a, 1 - x)) / b;
}

/** x tal que I_x(a, b) = p (bisección; I es creciente en x). */
export function inverseRegularizedBeta(p: number, a: number, b: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (regularizedBeta(mid, a, b) < p) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-12) break;
  }
  return (lo + hi) / 2;
}

export interface Interval {
  /** Proporción observada k / n (0 si n = 0). */
  rate: number;
  low: number;
  high: number;
}

/**
 * Intervalo exacto de Clopper-Pearson para k éxitos en n intentos, al nivel 1 − alpha (95 % por
 * defecto). Con n = 0 no hay información: [0, 1].
 */
export function clopperPearson(k: number, n: number, alpha = 0.05): Interval {
  if (!Number.isInteger(k) || !Number.isInteger(n) || k < 0 || n < 0 || k > n) throw new Error(`clopperPearson: k=${k}, n=${n} no válidos`);
  if (n === 0) return { rate: 0, low: 0, high: 1 };
  const low = k === 0 ? 0 : inverseRegularizedBeta(alpha / 2, k, n - k + 1);
  const high = k === n ? 1 : inverseRegularizedBeta(1 - alpha / 2, k + 1, n - k);
  return { rate: k / n, low, high };
}
