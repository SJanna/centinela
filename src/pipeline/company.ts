/**
 * Empresa activa: la guardada en la base o, si todavía no hay ninguna, la del dataset
 * (dataset/company.json), que se guarda en ese momento.
 *
 * Una base guardada antes de que existiera la identidad de compradora (`buyer`, ACU-1) no la trae:
 * si la empresa guardada es la del dataset (mismo nombre), se completa con la del dataset una vez.
 */
import type { Company } from "../core/schemas";
import { getCompany, saveCompany } from "../store";
import { loadDatasetCompany } from "./dataset";

let seeding: Promise<Company> | null = null;

/** Devuelve la empresa guardada; si no hay, carga dataset/company.json, la guarda y la devuelve. */
export async function ensureCompany(): Promise<Company> {
  const existing = await getCompany();
  if (existing) return existing.buyer ? existing : withDatasetBuyer(existing);
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

/** Completa `buyer` desde el dataset si la empresa guardada es la del dataset y no lo tiene. */
async function withDatasetBuyer(stored: Company): Promise<Company> {
  let dataset: Company;
  try {
    dataset = loadDatasetCompany();
  } catch {
    return stored;
  }
  if (!dataset.buyer || dataset.name !== stored.name) return stored;
  const completed: Company = { ...stored, buyer: dataset.buyer };
  await saveCompany(completed);
  return completed;
}
