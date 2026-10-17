/**
 * Geometría del texto de un PDF para dibujar marcas sobre la hoja: dónde cae cada fragmento
 * (instrucción sospechosa, cita de un dato leído) en coordenadas de la página. Funciones puras.
 */
import { findSuspiciousSpans, type SuspiciousNeedle, type TextSpan } from "./doc-text";

/** Un fragmento de texto de la página, ya en coordenadas de pantalla a escala 1 (origen arriba a la izquierda). */
export interface PageTextItem {
  str: string;
  /** Borde izquierdo y ancho, en puntos. */
  left: number;
  width: number;
  /** Línea base y tamaño de letra, en puntos (y crece hacia abajo). */
  baseline: number;
  fontSize: number;
  hasEOL: boolean;
}

export interface PageText {
  /** Texto de la página, unido como lo une la ingesta (saltos de línea y espacios entre fragmentos). */
  text: string;
  /** Inicio y fin de cada fragmento dentro de `text`. */
  ranges: { item: number; start: number; end: number }[];
  items: PageTextItem[];
}

/** Rectángulo en porcentaje de la página (para que la marca siga a la hoja al cambiar de tamaño). */
export interface PageRect {
  left: number;
  top: number;
  width: number;
  height: number;
  /** Tamaño de letra en puntos: con menos de 3 pt el texto no se ve en la hoja. */
  fontSize: number;
}

/** Une los fragmentos respetando líneas y huecos, igual que `pageItemsToText` de la ingesta. */
export function joinPageText(items: readonly PageTextItem[]): PageText {
  const parts: string[] = [];
  const ranges: PageText["ranges"] = [];
  let length = 0;
  let lastChar = "";
  const emit = (s: string) => {
    if (s === "") return;
    parts.push(s);
    length += s.length;
    lastChar = s[s.length - 1];
  };
  let prev: PageTextItem | null = null;
  items.forEach((item, index) => {
    if (prev && !prev.hasEOL && item.str !== "") {
      const tolerance = Math.max(1, Math.min(item.fontSize || 1, prev.fontSize || 1) * 0.5);
      const sameLine = Math.abs(item.baseline - prev.baseline) <= tolerance;
      if (!sameLine) {
        if (lastChar !== "\n") emit("\n");
      } else {
        const gap = item.left - (prev.left + prev.width);
        const needsSpace = gap > Math.max(0.5, (prev.fontSize || 1) * 0.15);
        if (needsSpace && !/\s/.test(lastChar) && !/^\s/.test(item.str)) emit(" ");
      }
    }
    const start = length;
    emit(item.str);
    if (item.str !== "") ranges.push({ item: index, start, end: length });
    if (item.hasEOL) emit("\n");
    if (item.str !== "" || item.hasEOL) prev = item;
  });
  return { text: parts.join(""), ranges, items: [...items] };
}

/** Rectángulos (uno por renglón) que ocupa un tramo del texto de la página. */
export function rectsForSpan(page: PageText, span: Pick<TextSpan, "start" | "end">, pageWidth: number, pageHeight: number): PageRect[] {
  const boxes: { left: number; right: number; top: number; bottom: number; fontSize: number }[] = [];
  for (const r of page.ranges) {
    if (r.end <= span.start || r.start >= span.end) continue;
    const item = page.items[r.item];
    const len = Math.max(1, r.end - r.start);
    const from = Math.max(span.start, r.start) - r.start;
    const to = Math.min(span.end, r.end) - r.start;
    const left = item.left + (item.width * from) / len;
    const right = item.left + (item.width * to) / len;
    const top = item.baseline - item.fontSize * 0.92;
    const bottom = item.baseline + item.fontSize * 0.26;
    const last = boxes[boxes.length - 1];
    // Mismo renglón: se une con el anterior.
    if (last && Math.abs(last.bottom - bottom) <= Math.max(1, item.fontSize * 0.5)) {
      last.left = Math.min(last.left, left);
      last.right = Math.max(last.right, right);
      last.top = Math.min(last.top, top);
      last.bottom = Math.max(last.bottom, bottom);
      last.fontSize = Math.max(last.fontSize, item.fontSize);
    } else {
      boxes.push({ left, right, top, bottom, fontSize: item.fontSize });
    }
  }
  return boxes.map((b) => ({
    left: (b.left / pageWidth) * 100,
    top: (b.top / pageHeight) * 100,
    width: (Math.max(0.5, b.right - b.left) / pageWidth) * 100,
    height: (Math.max(0.5, b.bottom - b.top) / pageHeight) * 100,
    fontSize: b.fontSize,
  }));
}

export interface FoundMark {
  rects: PageRect[];
  reason: string;
  /** Texto encontrado en la página. */
  text: string;
}

/** Busca los fragmentos en la página y devuelve dónde están. */
export function locate(page: PageText, needles: readonly SuspiciousNeedle[], pageWidth: number, pageHeight: number): FoundMark[] {
  if (needles.length === 0) return [];
  return findSuspiciousSpans(page.text, needles)
    .map((span) => ({
      rects: rectsForSpan(page, span, pageWidth, pageHeight),
      reason: span.reason,
      text: page.text.slice(span.start, span.end).replace(/\s+/g, " ").trim(),
    }))
    .filter((m) => m.rects.length > 0);
}
