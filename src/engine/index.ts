/**
 * Motor de reglas de Centinela. Función pura: sin E/S, sin reloj, sin aleatoriedad.
 * Solo importa src/core.
 */
export { decide, aggregateOutcome, effectOf } from "./decide";
export {
  matchVendor,
  selectAgreement,
  agreementPeriodOf,
  computeUsdAmount,
  isAgreementValidOn,
  normalizeInvoiceNumber,
  type VendorMatch,
  type VendorMatchBasis,
  type AgreementSelection,
  type AgreementSelectionStatus,
  type UsdAmount,
} from "./facts";
