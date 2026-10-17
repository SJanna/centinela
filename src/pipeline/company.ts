/**
 * Empresa activa: la guardada en la base o, si todavía no hay ninguna, la del dataset
 * (dataset/company.json), que se guarda en ese momento.
 */
import type { Company } from "../core/schemas";
import { getCompany, saveCompany } from "../store";
import { loadDatasetCompany } from "./dataset";

let seeding: Promise<Company> | null = null;

/** Devuelve la empresa guardada; si no hay, carga dataset/company.json, la guarda y la devuelve. */
export async function ensureCompany(): Promise<Company> {
  const existing = await getCompany();
  if (existing) return existing;
  // Dos peticiones simultáneas con la base vacía comparten la misma carga.
  seeding ??= (async () => {
    try {
      const again = await getCompany();
      if (again) return again;
      const company = loadDatasetCompany();
      await saveCompany(company);
      return company;
    } finally {
      seeding = null;
    }
  })();
  return seeding;
}
