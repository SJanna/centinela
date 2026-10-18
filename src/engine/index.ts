/**
 * Motor de reglas de Centinela. Función pura: sin E/S, sin reloj, sin aleatoriedad.
 * Solo importa src/core.
 */
export { decide, aggregateOutcome, effectOf } from "./decide";
export {
  matchVendor,
  selectAgreement,
  agreementPeriodOf,
  agreementCoversPeriod,
  referenceDateOf,
  billedPeriodOf,
  previousPeriod,
  computeUsdAmount,
  isAgreementValidOn,
  normalizeInvoiceNumber,
  type VendorMatch,
  type VendorMatchBasis,
  type AgreementSelection,
  type AgreementSelectionStatus,
  type ReferenceDate,
  type BilledPeriod,
  type BilledPeriodSource,
  type UsdAmount,
} from "./facts";
