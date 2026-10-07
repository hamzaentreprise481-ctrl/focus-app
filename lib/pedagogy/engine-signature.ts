// Provenance of AI output: the FOCUS server signs what it records, and the
// database (public.focus_record_engine_analysis) accepts only what carries a
// valid signature for the signed-in teacher, made within ten minutes, for the
// evidence version read before the evidence itself. A teacher calling the
// API directly cannot produce one: the key lives in this server's
// environment and in focus_private.engine_keys, never in the browser.
//
// Pure module (no "server-only" import) so that tests can sign envelopes with
// a test key; the application imports it from server code only.

import { createHmac } from "node:crypto";

export const ENGINE_KEY_ENV = "FOCUS_ANALYSIS_SIGNING_KEY";

/** 32 to 64 random bytes, hex-encoded; anything else counts as absent. */
export function engineSigningKey(env: Record<string, string | undefined> = process.env): Buffer | null {
  const raw = env[ENGINE_KEY_ENV]?.trim() ?? "";
  if (!/^(?:[0-9a-fA-F]{2}){32,64}$/.test(raw)) return null;
  return Buffer.from(raw, "hex");
}

interface EnvelopeBase {
  teacherId: string;
  schoolId: string;
  studentId: string;
  assessmentId: string;
  model: string;
  inputHash: string;
  /** focus_analysis_evidence_versions, read before the evidence. */
  evidenceVersion: string;
}

export type EngineEnvelope =
  | (EnvelopeBase & { kind: "analysis"; errors: unknown[]; recommendations: unknown[] })
  | (EnvelopeBase & { kind: "no_evidence"; reason: string });

/**
 * The exact text the database verifies and parses, and its HMAC-SHA256.
 * The text is sent as is: nothing re-serializes it on the way.
 */
export function signEngineEnvelope(envelope: EngineEnvelope, key: Buffer, issuedAt = new Date()) {
  const text = JSON.stringify({ v: 1, issuedAt: issuedAt.toISOString(), ...envelope });
  return { p_envelope: text, p_signature: createHmac("sha256", key).update(text, "utf8").digest("hex") };
}
