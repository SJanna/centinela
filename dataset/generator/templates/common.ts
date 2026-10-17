/**
 * Utilidades compartidas por las plantillas.
 */
import { textWidth, type Canvas, type FontKey } from "../layout";
import { formatMoney } from "../format";
import type { DocumentSpec } from "../spec";

/** Monto con el formato del documento. */
export function moneyOf(spec: DocumentSpec) {
  return (amount: number) => formatMoney(amount, spec.currency, spec.locale);
}

/** Tamaño de fuente para que un texto quepa en una sola línea (sin pasar de `max`). */
export function fitSize(text: string, font: FontKey, max: number, maxWidth: number, min = 5): number {
  let size = max;
  while (size > min && textWidth(text, font, size) > maxWidth) size -= 0.25;
  return size;
}

/**
 * Nota visible que intenta dar órdenes al sistema (B16): un recuadro llamativo con el texto
 * en UNA línea (para que la cita literal se pueda extraer del PDF sin cortes).
 * Devuelve el y siguiente.
 */
export function drawVisibleNote(c: Canvas, spec: DocumentSpec, x: number, y: number, width: number): number {
  if (!spec.visibleNote) return y;
  const size = fitSize(spec.visibleNote, "sansBold", 9, width - 24);
  c.rect(x, y, width, 30, { fill: "#FEF3C7", stroke: "#F59E0B", lineWidth: 0.8, radius: 5 });
  c.rect(x, y, 4, 30, { fill: "#F59E0B", radius: 2 });
  c.text(x + 14, y + 19, spec.visibleNote, { size, font: "sansBold", color: "#92400E" });
  return y + 42;
}

/**
 * Texto oculto (H10): blanco, de 1 pt, sobre fondo blanco. No se ve al imprimir ni en pantalla,
 * pero cualquier extractor de texto del PDF lo lee.
 */
export function drawHiddenText(c: Canvas, spec: DocumentSpec, x: number, y: number): void {
  if (!spec.hiddenText) return;
  c.text(x, y, spec.hiddenText, { size: 1, color: "#FFFFFF" });
}

/** Valor de templateData o un valor por defecto. */
export function td(spec: DocumentSpec, key: string, fallback = ""): string {
  return spec.templateData[key] ?? fallback;
}
