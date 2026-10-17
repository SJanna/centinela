/**
 * API pública de src/pipeline: orquesta ingest → extract → engine → guard → store.
 * Solo para el servidor (Route Handlers, scripts).
 */
export { processInvoice, withProcessingLock, APP_VERSION, type ProcessInput, type ProcessOptions } from "./process";
export { applyGuard, decideWithGuard } from "./guard-apply";
export { escalateDuplicatePayment } from "./duplicate-payment";
export { getReaders, withReadTimeout, LIVE_READ_TIMEOUT_MS, PRIMARY_READER_ID, SECONDARY_READER_ID, type ReaderPair } from "./readers";
export { readingMode, getAppStatus, modelsFor, isAccessProtected, type AppStatus, type ReadingMode } from "./status";
export { ensureCompany } from "./company";
export { resetDemo, listSamples, readSample, type Sample, type SampleFile } from "./demo";
export {
  loadDatasetCompany,
  loadManifest,
  manifestFilePath,
  readCaseRows,
  readScenarios,
  companyForScenario,
  datasetPath,
  type Scenario,
} from "./dataset";
export { decisionsToCsv, csvCell, CSV_COLUMNS, READING_MODE_LABEL } from "./export";
export {
  ACCESS_COOKIE,
  ACCESS_COOKIE_MAX_AGE,
  configuredAccessCode,
  constantTimeEqual,
  isPublicPath,
  isValidAccessCookie,
  sha256HexOf,
} from "./access";
