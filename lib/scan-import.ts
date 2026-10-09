import "server-only";

import { pedagogicalAiModel } from "@/lib/pedagogy/openai";
import type { ScanExtraction, ScanQuestion, ScanRosterStudent } from "@/lib/scan-import-core";
import { scanReasoningEffort, transcribeScan, type ScanSource } from "@/lib/scan-transcription";

export {
  MAX_SCAN_BYTES,
  MAX_SCAN_IMAGE_BYTES,
  MAX_SCAN_IMAGES,
  SCAN_BUCKET,
  SCAN_IMAGE_TYPES,
  normalizedResponses,
  scanCopyIssue,
} from "@/lib/scan-import-core";
export type {
  ScanCopyCandidate,
  ScanExtraction,
  ScanQuestion,
  ScanResponseCandidate,
  ScanReviewCopy,
  ScanRosterStudent,
} from "@/lib/scan-import-core";
export type { ScanSource } from "@/lib/scan-transcription";

/** The reading model: FOCUS_SCAN_MODEL, else the analysis model. */
export function scanImportModel() {
  return process.env.FOCUS_SCAN_MODEL?.trim() || pedagogicalAiModel();
}

/** Reads a scanned stack or photos with this server's key, model and effort. */
export function extractScanStack(
  source: ScanSource | Uint8Array,
  roster: ScanRosterStudent[],
  questions: ScanQuestion[],
): Promise<ScanExtraction> {
  return transcribeScan(source, roster, questions, {
    apiKey: process.env.OPENAI_API_KEY,
    model: scanImportModel(),
    effort: scanReasoningEffort(),
  });
}
