/**
 * Llamadas del resumen a la API (docs/API.md). Errores siempre en español.
 */
import { SAMPLE_MEDIA_TYPE } from "./format";
import type { DecisionSummary, Sample, Stats } from "./types";

const OFFLINE = "No hay conexión con el servidor. Revisa que siga encendido.";

async function request(input: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, { cache: "no-store", ...init });
  } catch {
    throw new Error(OFFLINE);
  }
}

async function readJson<T>(res: Response): Promise<T> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Respuesta sin JSON: se informa con el código.
  }
  if (!res.ok) {
    const message =
      body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string"
        ? (body as { error: string }).error
        : res.status === 401
          ? "La demo pide un código de acceso. Vuelve a entrar."
          : `El servidor respondió con un error (${res.status}).`;
    throw new Error(message);
  }
  return body as T;
}

/** POST /api/invoices: sube un archivo y devuelve la decisión. */
export async function uploadInvoice(file: File): Promise<DecisionSummary> {
  const form = new FormData();
  form.append("file", file, file.name);
  const res = await request("/api/invoices", { method: "POST", body: form });
  const data = await readJson<{ decision: DecisionSummary }>(res);
  return data.decision;
}

export async function fetchStats(): Promise<Stats> {
  return readJson<Stats>(await request("/api/stats"));
}

export async function fetchDecisions(): Promise<DecisionSummary[]> {
  const data = await readJson<{ decisions: DecisionSummary[] }>(await request("/api/decisions"));
  return data.decisions;
}

/** POST /api/demo/reset: borra facturas y decisiones y recarga la empresa del dataset. */
export async function resetDemo(): Promise<{ vendors: { name: string; aliases: string[]; country: string }[] }> {
  const data = await readJson<{ company: { vendors: { name: string; aliases: string[]; country: string }[] } }>(
    await request("/api/demo/reset", { method: "POST" }),
  );
  return data.company;
}

export async function fetchSamples(): Promise<Sample[]> {
  const data = await readJson<{ samples: Sample[] }>(await request("/api/samples"));
  return data.samples;
}

/** GET /api/samples/[caseId] como File, listo para subir. */
export async function fetchSampleFile(sample: Sample): Promise<File> {
  const res = await request(`/api/samples/${encodeURIComponent(sample.caseId)}`);
  if (!res.ok) await readJson(res);
  const blob = await res.blob();
  const type = SAMPLE_MEDIA_TYPE[sample.formato] ?? (blob.type.split(";")[0] || "application/octet-stream");
  return new File([blob], sample.filename, { type });
}
