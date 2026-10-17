/**
 * Configuración del armazón: navegación, títulos de sección e ids de los huecos del header.
 * Sin "use client": lo importan tanto el servidor como el cliente.
 */
import { Building, LayoutGrid, Scale, ScrollText, type LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "Resumen", icon: LayoutGrid },
  { href: "/registro", label: "Registro", icon: ScrollText },
  { href: "/reglas", label: "Reglas", icon: Scale },
  { href: "/proveedores", label: "Proveedores", icon: Building },
];

/** Rutas que se muestran sin barra lateral ni header (p. ej. la pantalla de acceso). */
export const BARE_ROUTES: readonly string[] = ["/acceso"];

/** Secciones fuera de la navegación principal. */
const EXTRA_SECTIONS: readonly { href: string; label: string }[] = [{ href: "/dev/ui", label: "Guía de estilo" }];

/** true si `pathname` está dentro de `href` ("/" solo coincide consigo misma). */
export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Sección a la que pertenece una ruta, para el breadcrumb del header. */
export function sectionFor(pathname: string): { href: string; label: string } | null {
  const all = [...NAV_ITEMS, ...EXTRA_SECTIONS];
  return all.find((item) => isActivePath(pathname, item.href)) ?? null;
}

export function isBareRoute(pathname: string): boolean {
  return BARE_ROUTES.some((route) => isActivePath(pathname, route));
}

/** Modo de lectura que muestra el header: modelos reales o lectura de referencia del dataset. */
export type ReadingMode = "live" | "simulated";

/** Hueco del header para acciones de la página (lo llena <HeaderActions>). */
export const HEADER_ACTIONS_ID = "centinela-header-actions";
/** Hueco del header para migas extra tras la sección (lo llena <HeaderCrumb>). */
export const HEADER_CRUMBS_ID = "centinela-header-crumbs";
