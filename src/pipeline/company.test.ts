/**
 * Empresa activa (ensureCompany): siembra desde el dataset y completa la identidad de compradora de
 * una base guardada antes de que existiera. Base en memoria (PGLITE_DIR=memory).
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Company } from "../core/schemas";
import { getCompany, resetDbForTests, saveCompany } from "../store";
import { ensureCompany } from "./company";
import { loadDatasetCompany } from "./dataset";

process.env.PGLITE_DIR = "memory";

const dataset = loadDatasetCompany();
const withoutBuyer = (c: Company): Company => ({ name: c.name, rules: c.rules, vendors: c.vendors });

beforeEach(async () => {
  await resetDbForTests();
});

afterAll(async () => {
  await resetDbForTests();
});

describe("ensureCompany", () => {
  it("con la base vacía guarda la empresa del dataset, con su identidad de compradora", async () => {
    const company = await ensureCompany();
    expect(company.buyer?.taxIds).toEqual(["93-4127765"]);
    expect((await getCompany())?.buyer).toEqual(dataset.buyer);
  });

  it("una base guardada sin identidad de compradora la recibe del dataset (misma empresa)", async () => {
    await saveCompany(withoutBuyer(dataset));
    expect((await getCompany())?.buyer).toBeUndefined();
    const company = await ensureCompany();
    expect(company.buyer).toEqual(dataset.buyer);
    expect((await getCompany())?.buyer).toEqual(dataset.buyer);
  });

  it("otra empresa sin identidad de compradora queda como está", async () => {
    const other: Company = { ...withoutBuyer(dataset), name: "Otra Empresa S.A." };
    await saveCompany(other);
    const company = await ensureCompany();
    expect(company).toEqual(other);
    expect((await getCompany())?.buyer).toBeUndefined();
  });
});
