/**
 * Lectura y verificación de lecturas.
 *
 *   const assessment = await readInvoice(doc, { primary, secondary });
 *
 * Lectores: createAnthropicReader (API), createCachedReader (+ createFileReadingCache),
 * createSimulatedReader (lectura «perfecta» del manifiesto del dataset).
 */
export { PROMPT_VERSION, UNTRUSTED_TAG, READER_SYSTEM_PROMPT, buildReaderMessages } from "./prompt";
export type { ReaderContentBlock, ReaderMessages } from "./prompt";

export {
  createAnthropicReader,
  extractionOutputFormat,
  describeApiError,
  supportsServerFallback,
  PRIMARY_MODEL,
  SECONDARY_MODEL,
  DEFAULT_MAX_TOKENS,
  SERVER_FALLBACK_BETA,
} from "./anthropic-reader";
export type { AnthropicReaderOptions } from "./anthropic-reader";

export { readingCacheKey, createCachedReader, createFileReadingCache, createMemoryReadingCache } from "./cache";

export { createSimulatedReader, SIMULATED_MODEL, SIMULATED_UNAVAILABLE_MESSAGE } from "./simulated";

export { detectSuspiciousInstructions } from "./heuristics";
export type { SuspiciousMatch } from "./heuristics";

export {
  assessReadings,
  readInvoice,
  toInvoiceData,
  compareReadings,
  arithmeticIssues,
  collectSuspiciousInstructions,
  findEvidenceNotFound,
  canonicalText,
  normalizeCurrency,
  normalizeInvoiceNumber,
  SECOND_READING_UNAVAILABLE,
  PERIOD_DISAGREEMENT,
  billedPeriodOfReading,
} from "./assess";
