/**
 * Detalle de una factura (/facturas/[id]): la pantalla que explica por qué se decidió.
 * Servidor: DecisionHeader, ContextPanel. Cliente: el resto (hover compartido vía DetailProvider).
 */
export { InvoiceDetail } from "./invoice-detail";
export { DetailProvider, useDetail, DOCUMENT_PANEL_ID, type DocTab } from "./detail-context";
export { DecisionHeader } from "./decision-header";
export { SuspiciousBar } from "./suspicious-bar";
export { DocumentPanel } from "./document-panel";
export { ChecksPanel } from "./checks-panel";
export { ReadingTable, MaskedAccount } from "./reading-table";
export { ContextPanel } from "./context-panel";
export { DecisionTrace } from "./decision-trace";
export { DetailActions } from "./detail-actions";
export { CheckMark } from "./check-mark";
export { displayVendorName, uniqueSuspicious } from "./decision-utils";
export { invoiceIdsIn, linkInvoiceIds, type InvoiceRef, type InvoiceRefs } from "./invoice-links";
export { PdfSheet } from "./pdf-sheet";
