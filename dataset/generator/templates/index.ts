/**
 * Plantillas visuales: spec → lienzo (con las citas literales de cada campo).
 */
import type { Canvas } from "../layout";
import type { DocumentSpec, TemplateKind } from "../spec";
import { renderCuentaCobro } from "./cuentaCobro";
import { renderLatam } from "./latam";
import { renderNotaServico } from "./notaServico";
import { renderPortal } from "./portal";
import { renderSaas } from "./saas";

export const TEMPLATE_RENDERERS: Record<TemplateKind, (spec: DocumentSpec) => Canvas> = {
  saas: renderSaas,
  latam: renderLatam,
  cuenta_cobro: renderCuentaCobro,
  nota_servico: renderNotaServico,
  portal: renderPortal,
};

export function renderTemplate(spec: DocumentSpec, template: TemplateKind): Canvas {
  return TEMPLATE_RENDERERS[template](spec);
}
