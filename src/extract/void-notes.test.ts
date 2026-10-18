import { describe, expect, it } from "vitest";
import { voidMarkersInNotes } from "./void-notes";

const reasons = (notes: string) => voidMarkersInNotes(notes).flatMap((m) => m.reason.split("; "));

describe("voidMarkersInNotes: marca", () => {
  it.each([
    ["marca de agua BORRADOR (R2-14, lectura real)", "El documento tiene una marca de agua 'BORRADOR' y el texto 'Documento preliminar · sin validez'. Se extrajo como factura según su contenido.", "es un borrador"],
    ["proforma (R2-13, lectura real)", "Documento titulado PROFORMA INVOICE; indica 'This proforma is not a tax invoice. The final invoice will be issued once the period closes.'", "es una proforma"],
    ["sello ANULADA (R2-09, lectura real)", "El documento tiene un sello rojo 'ANULADA' con la leyenda 'Reemplazada por CRD-1091'.", "está anulado"],
    ["nota crédito", "Es una nota de crédito por -240 USD que aplica a la factura CM-INV-2026-10-0412.", "es una nota crédito"],
    ["no es factura fiscal", "Se clasifica como invoice porque cobra un monto, pero no es factura fiscal definitiva.", "dice que no es una factura válida"],
    ["sin validez", "Lleva la leyenda «sin validez» al pie.", "dice que no es una factura válida"],
    ["voided", "The invoice was voided and replaced by INV-2.", "está anulado"],
    ["negación lejana no tapa la marca", "No tiene fecha de vencimiento y es una proforma.", "es una proforma"],
  ])("%s", (_name, notes, reason) => {
    expect(reasons(notes)).toContain(reason);
  });

  it("cita la parte de la nota", () => {
    expect(voidMarkersInNotes("Todo legible. La factura está anulada según el sello.")).toEqual([
      { text: "La factura está anulada según el sello", reason: "está anulado", kind: "void" },
    ]);
  });
});

describe("voidMarkersInNotes: no marca", () => {
  it.each([
    ["nota vacía", ""],
    ["sin nota", null],
    ["negación", "No hay sellos de anulado ni marcas de borrador."],
    ["sin marca", "Sin marca de borrador; todos los campos legibles."],
    ["no es un borrador", "No es un borrador: es la factura definitiva."],
    ["no tiene notas crédito", "No tiene notas crédito asociadas."],
    ["cuenta de cobro (lectura real del dataset)", "Es una factura electrónica, no es un cobro de cuenta de cobro."],
    ["nota normal", "El total se lee con claridad. La cuenta coincide con el pie de página."],
  ])("%s", (_name, notes) => {
    expect(voidMarkersInNotes(notes)).toEqual([]);
  });
});
