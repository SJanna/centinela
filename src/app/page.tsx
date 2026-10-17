import type { Metadata } from "next";
import { connection } from "next/server";
import { Dashboard, vendorCountriesOf } from "@/components/dashboard";
import { getShellStatus } from "@/components/shell/status";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Card } from "@/components/ui/sheet";
import { getCompany, getStats, listDecisions } from "@/store";

export const metadata: Metadata = {
  title: "Resumen · Centinela",
};

/** Datos del resumen. Se leen en cada petición: cambian con cada factura. */
async function loadDashboard() {
  const now = new Date();
  const [stats, decisions, company, status] = await Promise.all([
    getStats(now.toISOString()),
    listDecisions(),
    getCompany(),
    getShellStatus(),
  ]);
  return {
    stats,
    decisions,
    vendorCountries: vendorCountriesOf(company?.vendors ?? []),
    readingMode: status.readingMode,
    renderedAt: now.getTime(),
  };
}

export default async function HomePage() {
  // Fuera del try: si no, el aviso de "ruta dinámica" de Next durante el build se tomaría
  // como un error de base y la portada quedaría prerenderizada con el estado de error.
  await connection();
  let data: Awaited<ReturnType<typeof loadDashboard>>;
  try {
    data = await loadDashboard();
  } catch (err) {
    console.error("[resumen] No se pudieron leer los datos:", err);
    return (
      <Card padding="none">
        <EmptyState
          headingLevel={1}
          title="No se pudieron leer los datos."
          description="La base no respondió. Revisa el registro del servidor y vuelve a cargar."
          action={
            <Button href="/" variant="secondary" size="sm">
              Volver a cargar
            </Button>
          }
        />
      </Card>
    );
  }

  return (
    <Dashboard
      initialStats={data.stats}
      initialDecisions={data.decisions}
      vendorCountries={data.vendorCountries}
      readingMode={data.readingMode}
      renderedAt={data.renderedAt}
    />
  );
}
