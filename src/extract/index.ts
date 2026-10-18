/**
 * Lectura y verificación de lecturas.
 *
 *   const assessment = await readInvoice(doc, { primary, secondary });
 *
 * Lectores: createAnthropicReader (API), createCachedReader (+ createFileReadingCache),
 * createSimulatedReader (lectura «perfecta» del manifiesto del dataset).
 * Perfiles de lectura (modelo y variante de prompt de cada lectura): READER_PROFILES.
 */
export {
  PROMPT_VERSION,
  PROMPT_VERSION_B,
  PROMPT_VERSIONS,
  promptVersionOf,
  UNTRUSTED_TAG,
  READER_SYSTEM_PROMPT,
  READER_SYSTEM_PROMPT_B,
  readerSystemPrompt,
  buildReaderMessages,
} from "./prompt";
export type { PromptVariant, ReaderContentBlock, ReaderMessages } from "./prompt";

export {
  createAnthropicReader,
  extractionOutputFormat,
  describeApiError,
  supportsServerFallback,
  PRIMARY_MODEL,
  SECONDARY_MODEL,
  SONNET_MODEL,
  HAIKU_MODEL,
  DEFAULT_MAX_TOKENS,
  SERVER_FALLBACK_BETA,
} from "./anthropic-reader";
export type { AnthropicReaderOptions } from "./anthropic-reader";

export {
  READER_PROFILES,
  READER_PROFILE_NAMES,
  DEFAULT_READER_PROFILE,
  parseReaderProfile,
  profileModels,
  profilePromptVersions,
} from "./profiles";
export type { ReaderProfile, ReaderProfileSpec, ReaderSlotSpec } from "./profiles";

export { readingCacheKey, createCachedReader, createFileReadingCache, createMemoryReadingCache } from "./cache";

export { createSimulatedReader, SIMULATED_MODEL, SIMULATED_UNAVAILABLE_MESSAGE } from "./simulated";

export { detectSuspiciousInstructions } from "./heuristics";
export type { SuspiciousMatch } from "./heuristics";

export { detectPaidDocumentMarkers } from "./paid-markers";
export type { PaidMarker } from "./paid-markers";

export {
  assessReadings,
  readInvoice,
  toInvoiceData,
  compareReadings,
  arithmeticIssues,
  collectSuspiciousInstructions,
  collectPaidDocumentMarkers,
  collectIngestWarnings,
  INGEST_WARNING_WITHOUT_MESSAGE,
  RECEIPT_READING_REASON,
  findEvidenceNotFound,
  hasVerifiableText,
  quoteHasTotalLabel,
  totalNotConfirmedByQuote,
  totalDoubtedInNotes,
  canonicalText,
  normalizeCurrency,
  normalizeInvoiceNumber,
  SECOND_READING_UNAVAILABLE,
  PERIOD_DISAGREEMENT,
  billedPeriodOfReading,
} from "./assess";
