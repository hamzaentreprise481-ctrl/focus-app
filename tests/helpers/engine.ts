// The FOCUS engine signature in tests: a fixed, fictitious key installed in
// the test database and given to the app under test, and the same envelope
// the server builds (lib/pedagogy/engine-signature.ts).

import type { PGlite } from "@electric-sql/pglite";
import { signEngineEnvelope, type EngineEnvelope } from "../../lib/pedagogy/engine-signature";

/** Test-only key (not a secret: it signs fictitious analyses in PGlite). */
export const TEST_ENGINE_KEY = "666f6375732d746573742d6f6e6c792d6b65792c206e6f74206120736563726574";

/** Installs the key where public.focus_record_engine_analysis reads it, if that schema exists. */
export async function installEngineKey(db: PGlite, hex = TEST_ENGINE_KEY) {
  const { rows } = await db.query<{ present: boolean }>("select to_regclass('focus_private.engine_keys') is not null as present");
  if (!rows[0].present) return false;
  await db.query(
    `insert into focus_private.engine_keys (id, secret) values (1, decode($1, 'hex'))
     on conflict (id) do update set secret = excluded.secret, rotated_at = now()`,
    [hex],
  );
  return true;
}

/** The evidence version as the server reads it before the evidence (read here as superuser). */
export async function evidenceVersion(db: PGlite, assessmentId: string, studentId: string) {
  const { rows } = await db.query<{ v: string }>("select focus_private.evidence_version($1, $2) as v", [assessmentId, studentId]);
  return rows[0].v;
}

type Fields = {
  teacherId: string;
  schoolId: string;
  studentId: string;
  assessmentId: string;
  model?: string;
  inputHash?: string;
  evidenceVersion?: string;
} & ({ kind: "analysis"; errors: unknown[]; recommendations?: unknown[] } | { kind: "no_evidence"; reason: string });

/** A signed envelope for the current evidence, unless the caller overrides any field. */
export async function signedEnvelope(db: PGlite, fields: Fields, options: { key?: string; issuedAt?: Date } = {}) {
  const base = {
    teacherId: fields.teacherId,
    schoolId: fields.schoolId,
    studentId: fields.studentId,
    assessmentId: fields.assessmentId,
    model: fields.model ?? "test-model",
    inputHash: fields.inputHash ?? "a".repeat(64),
    evidenceVersion: fields.evidenceVersion ?? (await evidenceVersion(db, fields.assessmentId, fields.studentId)),
  };
  const envelope: EngineEnvelope =
    fields.kind === "analysis"
      ? { ...base, kind: "analysis", errors: fields.errors, recommendations: fields.recommendations ?? [] }
      : { ...base, kind: "no_evidence", reason: fields.reason };
  return signEngineEnvelope(envelope, Buffer.from(options.key ?? TEST_ENGINE_KEY, "hex"), options.issuedAt);
}

export const RECORD_SQL = "select public.focus_record_engine_analysis($1, $2) as run";
