import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
import { AccessForm } from "@/components/config/access-form";
import { safeNextPath } from "@/components/config/safe-next";
import { Ribbon } from "@/components/ui/ribbon";
import { Sheet } from "@/components/ui/sheet";
import { Eyebrow } from "@/components/ui/typography";

export const metadata: Metadata = {
  title: "Acceso · Centinela",
  robots: { index: false },
};

/** Pantalla de acceso a la demo. Va sin barra lateral ni header (BARE_ROUTES). */
export default async function AccessPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { next } = await searchParams;
  const destination = safeNextPath(next);

  return (
    <div className="relative isolate flex min-h-dvh flex-col overflow-hidden">
      {/* Cinta sutil, asomando desde abajo. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-[64vh] [mask-image:linear-gradient(to_top,#000_15%,transparent_95%)]"
      >
        <Ribbon opacity={0.26} lines={72} />
      </div>
      <div aria-hidden className="field-glow pointer-events-none absolute inset-0 -z-20" />

      <main className="flex flex-1 items-center justify-center px-4 py-16">
        <div className="w-full max-w-[400px]">
          <p className="mb-8 flex flex-col items-center gap-2 text-center">
            <span className="inline-flex items-baseline text-[28px] leading-none font-medium tracking-[-0.035em] text-navy">
              Centinela
              <span aria-hidden className="ml-[3px] inline-block size-[7px] rounded-full bg-accent" />
            </span>
            <span className="text-small text-muted">Agente de pagos</span>
          </p>

          <Sheet as="section" padding="none" aria-labelledby="acceso-titulo" className="space-y-6 p-7">
            <div className="space-y-2">
              <Eyebrow>Acceso</Eyebrow>
              <h1 id="acceso-titulo" className="text-h1">
                Esta demo está protegida.
              </h1>
              <p className="text-small text-ink-2">Escribe el código que te dio el equipo para entrar.</p>
            </div>
            <AccessForm next={destination} />
          </Sheet>

          <p className="mt-6 flex items-center justify-center gap-2 text-caption text-muted">
            <ShieldCheck aria-hidden size={14} strokeWidth={1.5} className="text-ink-3" />
            No mueve dinero. Lee facturas, decide y deja registro.
          </p>
        </div>
      </main>

      <footer className="px-4 pb-6 text-center text-caption text-muted">
        Hecho en <span className="rounded-[4px] bg-lime px-1.5 py-0.5 font-medium text-night">HackRadar 30X</span>
      </footer>
    </div>
  );
}
