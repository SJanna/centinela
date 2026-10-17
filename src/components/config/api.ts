/**
 * Llamadas a la API desde el navegador: errores en español y descargas.
 * Solo cliente (usa fetch, Blob y el DOM).
 */

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

/** fetch con JSON de ida y vuelta. Nunca lanza: devuelve el error de la API (`{ error }`) o uno genérico. */
export async function requestJson<T>(url: string, init: { method: string; body?: unknown }): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method,
      headers: init.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
  } catch {
    return { ok: false, status: 0, error: "No hay conexión con el servidor. Revisa tu red e intenta de nuevo." };
  }
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // Respuesta sin JSON: se usa el mensaje genérico.
  }
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && typeof (payload as { error?: unknown }).error === "string"
        ? (payload as { error: string }).error
        : `El servidor respondió con un error (${response.status}).`;
    return { ok: false, status: response.status, error: message };
  }
  return { ok: true, data: payload as T };
}

/** Guarda un Blob como archivo. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Descarga un JSON generado en el navegador. */
export function saveJson(data: unknown, filename: string): void {
  saveBlob(new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: "application/json;charset=utf-8" }), filename);
}

/** Nombre de archivo de `Content-Disposition` (prefiere `filename*`). */
function filenameFrom(disposition: string | null, fallback: string): string {
  if (!disposition) return fallback;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (star) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      // Sigue con el nombre simple.
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(disposition);
  return plain ? plain[1] : fallback;
}

/** Descarga un archivo de la API. Devuelve el error en español si la API falla. */
export async function downloadFrom(url: string, fallbackName: string): Promise<{ ok: true } | { ok: false; error: string }> {
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store" });
  } catch {
    return { ok: false, error: "No hay conexión con el servidor. Revisa tu red e intenta de nuevo." };
  }
  if (!response.ok) {
    let message = `El servidor respondió con un error (${response.status}).`;
    try {
      const payload = (await response.json()) as { error?: unknown };
      if (typeof payload.error === "string") message = payload.error;
    } catch {
      // Sin JSON: mensaje genérico.
    }
    return { ok: false, error: message };
  }
  const blob = await response.blob();
  saveBlob(blob, filenameFrom(response.headers.get("Content-Disposition"), fallbackName));
  return { ok: true };
}
