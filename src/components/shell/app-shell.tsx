import type { ReactNode } from "react";
import { Header } from "./header";
import { ShellFrame, ShellProviders } from "./shell-frame";
import { Sidebar } from "./sidebar";

/** Pie con el co-branding. Segundo y último uso del lima. */
export function ShellFooter() {
  return (
    <footer className="mx-auto w-full max-w-[1280px] px-8 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-line pt-5 text-caption text-muted">
        <p>
          Prototipo para el reto Blinka · Hecho en{" "}
          <span className="rounded-[4px] bg-lime px-1.5 py-0.5 font-medium text-night">HackRadar 30X</span>
        </p>
        <p>El modelo lee. Las reglas deciden.</p>
      </div>
    </footer>
  );
}

/** Armazón de la app: barra lateral, header fijo con blur, contenido y pie. Va en el layout raíz. */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <ShellProviders>
      <ShellFrame sidebar={<Sidebar />} header={<Header />} footer={<ShellFooter />}>
        {children}
      </ShellFrame>
    </ShellProviders>
  );
}
