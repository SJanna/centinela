/**
 * API pública del generador del dataset.
 */
export { generateAll, generateCase, toManifest, manifestJson, writeGenerated, sha256, MEDIA_TYPES, type GeneratedCase } from "./build";
export { loadSpecs, parseSpec, documentOf, datasetDir, type CaseSpec, type DocumentSpec, type CopySpec, type PhotoOfSpec } from "./spec";
export { readCases, readCompany, readScenarios, type Scenario } from "./cases";
export { buildGroundTruth } from "./groundTruth";
export { evaluateScenario, evaluateDataset, matchVendor, type OracleInput, type OracleResult } from "./oracle";
