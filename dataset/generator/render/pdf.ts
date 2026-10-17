/**
 * Página → PDF con pdfkit. Determinista: fechas, productor e ID del archivo fijos,
 * fuentes estándar (no se incrustan), sin nada que dependa del reloj ni del sistema.
 */
import PDFDocument from "pdfkit";
import { PDF_FONTS, type Op, type Page } from "../layout";

export interface PdfMeta {
  title: string;
  author: string;
  subject: string;
  /** Fecha fija de creación (se deriva de la fecha de emisión). */
  createdAt: Date;
}

function drawOp(doc: PDFKit.PDFDocument, op: Op): void {
  doc.save();
  switch (op.kind) {
    case "text": {
      doc.font(PDF_FONTS[op.font]).fontSize(op.size);
      const w = doc.widthOfString(op.text, { characterSpacing: op.letterSpacing });
      const x = op.align === "left" ? op.x : op.align === "right" ? op.x - w : op.x - w / 2;
      doc.fillColor(op.color, op.opacity);
      doc.text(op.text, x, op.y, { lineBreak: false, baseline: "alphabetic", characterSpacing: op.letterSpacing });
      break;
    }
    case "rect": {
      if (op.opacity < 1) doc.opacity(op.opacity);
      doc.lineWidth(op.lineWidth);
      if (op.radius > 0) doc.roundedRect(op.x, op.y, op.w, op.h, op.radius);
      else doc.rect(op.x, op.y, op.w, op.h);
      paint(doc, op.fill, op.stroke);
      break;
    }
    case "line": {
      if (op.opacity < 1) doc.opacity(op.opacity);
      doc.lineWidth(op.width);
      if (op.dash) doc.dash(op.dash[0], { space: op.dash[1] });
      doc.moveTo(op.x1, op.y1).lineTo(op.x2, op.y2).stroke(op.color);
      if (op.dash) doc.undash();
      break;
    }
    case "circle": {
      if (op.opacity < 1) doc.opacity(op.opacity);
      doc.lineWidth(op.lineWidth);
      doc.circle(op.cx, op.cy, op.r);
      paint(doc, op.fill, op.stroke);
      break;
    }
    case "ellipse": {
      if (op.opacity < 1) doc.opacity(op.opacity);
      doc.lineWidth(op.lineWidth);
      doc.ellipse(op.cx, op.cy, op.rx, op.ry);
      paint(doc, op.fill, op.stroke);
      break;
    }
    case "path": {
      if (op.opacity < 1) doc.opacity(op.opacity);
      doc.lineWidth(op.lineWidth);
      doc.lineCap(op.lineCap);
      doc.lineJoin(op.lineCap === "round" ? "round" : "miter");
      doc.path(op.d);
      paint(doc, op.fill, op.stroke, op.evenOdd);
      break;
    }
  }
  doc.restore();
}

function paint(doc: PDFKit.PDFDocument, fill: string | null, stroke: string | null, evenOdd = false): void {
  const rule = evenOdd ? "even-odd" : undefined;
  if (fill && stroke) doc.fillAndStroke(fill, stroke, rule);
  else if (fill) doc.fill(fill, rule);
  else if (stroke) doc.stroke(stroke);
}

export function renderPdf(page: Page, meta: PdfMeta): Promise<Buffer> {
  const doc = new PDFDocument({
    size: [page.width, page.height],
    margin: 0,
    compress: true,
    info: {
      Title: meta.title,
      Author: meta.author,
      Subject: meta.subject,
      Creator: meta.author,
      Producer: "PDFKit",
      CreationDate: meta.createdAt,
      ModDate: meta.createdAt,
    },
  });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  if (page.background.toUpperCase() !== "#FFFFFF") {
    doc.rect(0, 0, page.width, page.height).fill(page.background);
  }
  for (const op of page.ops) drawOp(doc, op);
  doc.end();
  return done;
}
