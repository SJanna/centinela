/**
 * Destino tras entrar con el código de acceso. Solo rutas internas: empieza con "/" y no con "//"
 * ni "/\" (el navegador los lee como otro dominio). Cualquier otra cosa lleva al resumen.
 */
export function safeNextPath(raw: string | string[] | undefined | null): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return "/";
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  // Sin caracteres de control (un salto de línea o tabulador puede cambiar cómo se interpreta la URL).
  for (let i = 0; i < value.length; i++) if (value.charCodeAt(i) < 0x20 || value.charCodeAt(i) === 0x7f) return "/";
  // Volver a /acceso no sirve de nada.
  if (value === "/acceso" || value.startsWith("/acceso?") || value.startsWith("/acceso/") || value.startsWith("/acceso#")) return "/";
  return value;
}
