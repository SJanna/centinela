/**
 * Código de acceso de la demo. La cookie `centinela_access` guarda el sha256 (hex) del código,
 * nunca el código. Usa Web Crypto: funciona igual en el proxy y en las rutas.
 */

export const ACCESS_COOKIE = "centinela_access";

/** Duración de la cookie de acceso (30 días). */
export const ACCESS_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

/** sha256 en hex de un texto UTF-8. */
export async function sha256HexOf(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Compara dos textos en tiempo constante respecto de su contenido: se comparan los sha256 de ambos
 * (siempre 32 bytes), así que ni el largo ni el primer carácter distinto cambian el tiempo.
 */
export async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([digestBytes(a), digestBytes(b)]);
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha[i] ^ hb[i];
  return diff === 0;
}

async function digestBytes(text: string): Promise<Uint8Array> {
  return new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

/** El código configurado (`DEMO_ACCESS_CODE`), o null si la demo está abierta. */
export function configuredAccessCode(env: Record<string, string | undefined> = process.env): string | null {
  const code = env.DEMO_ACCESS_CODE?.trim();
  return code ? code : null;
}

/** true si el valor de la cookie corresponde al código configurado. */
export async function isValidAccessCookie(cookieValue: string | undefined | null, code: string): Promise<boolean> {
  if (!cookieValue) return false;
  return constantTimeEqual(cookieValue.toLowerCase(), await sha256HexOf(code));
}

// ───────────────────────── Rutas públicas ─────────────────────────

const PUBLIC_PATHS = new Set(["/api/access", "/api/status", "/acceso", "/favicon.ico"]);

/** Archivos estáticos de /public (con extensión), fuera de /api. */
const STATIC_FILE = /\.(?:ico|png|jpe?g|gif|webp|avif|svg|txt|xml|webmanifest|json|css|js|map|woff2?|ttf|otf)$/i;

/**
 * true si la ruta no exige la cookie de acceso (la usa src/proxy.ts).
 *
 * La excepción de «archivo estático» se decide solo por la extensión, y una página con segmento
 * dinámico (p. ej. /decisiones/[id]) también responde en /decisiones/x.png. Por eso vale solo para
 * GET/HEAD: una acción de servidor llega como POST a la ruta de la página y nunca entra por aquí.
 * Las acciones de servidor deben revisar el acceso por su cuenta igual (docs de Next: proxy.md).
 */
export function isPublicPath(pathname: string, method = "GET"): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (PUBLIC_PATHS.has(path)) return true;
  if (path.startsWith("/acceso/")) return true;
  if (path.startsWith("/_next/")) return true;
  const readOnly = method.toUpperCase() === "GET" || method.toUpperCase() === "HEAD";
  if (readOnly && path !== "/api" && !path.startsWith("/api/") && STATIC_FILE.test(path)) return true;
  return false;
}
