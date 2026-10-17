import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter, Playfair_Display } from "next/font/google";
import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";
import "./globals.css";

// Inter variable sin fijar `weight`: conserva el eje para usar 450. Con `opsz` los títulos usan el corte display.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  axes: ["opsz"],
  display: "swap",
});

// IDs, cuentas (•••• 4821), códigos de regla y la traza de la decisión.
const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

// Solo una palabra del primer uso: "Tu agente *paga*. Tú decides."
const playfair = Playfair_Display({
  subsets: ["latin"],
  style: "italic",
  variable: "--font-playfair",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Centinela · Agente de pagos",
  description:
    "Lee facturas y decide si pagar, frenar o escalar según las reglas de la empresa. Explica cada decisión. No mueve dinero.",
  icons: { icon: [{ url: "/icon.svg", type: "image/svg+xml" }] },
};

export const viewport: Viewport = {
  themeColor: "#F7F7F4",
  colorScheme: "light",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="es" className={`${inter.variable} ${geistMono.variable} ${playfair.variable}`}>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
