// Live evaluation of the handwritten-copy path on the fictitious fixtures of
// tests/fixtures/handwriting (spec.json + manifest.json + images): the real
// reader (lib/scan-transcription.ts) and the real analysis
// (lib/pedagogy/openai-client.ts + validators), exactly as the server calls
// them, then scoring against the ground truth. Shared by
// scripts/run-handwriting-eval.ts (any machine with OPENAI_API_KEY) and the
// evaluation Preview endpoint. Records contain only fictitious content.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { evidenceOnlyOutcomes, relatedNotionCodes, validateModelAnalysis } from "../../lib/pedagogy/analysis";
import { requestPedagogicalAnalysisWithUsage, type ReasoningEffort } from "../../lib/pedagogy/openai-client";
import { normalizedResponses, scanCopyIssue, type ScanQuestion } from "../../lib/scan-import-core";
import { transcribeScan } from "../../lib/scan-transcription";

export const HANDWRITING_DIR = path.join(__dirname, "..", "fixtures", "handwriting");

export interface HandwritingSpec {
  assessments: Record<string, { title: string; questions: Array<{ key: string; prompt: string; correction: string; maxPoints: number; notions: string[] }> }>;
  students: Record<string, { name: string; profile: string }>;
}
export interface ManifestQuestion {
  key: string;
  text: string;
  hidden: string[];
  crossedOut: string[];
  points: string | null;
  expect: { outcome: string | string[]; errorTypes?: string[]; notions?: string[]; legibility?: string };
}
export interface ManifestCopy {
  id: string;
  kind: "profile" | "legibility_series" | "failure_mode";
  assessment: string;
  student?: string;
  studentName?: string;
  level?: string;
  image: string | null;
  pdf?: string;
  transform?: string;
  expect?: string;
  questions: ManifestQuestion[];
}
export interface CurriculumProjection {
  aiCurriculum: unknown;
  mappable: Record<string, string>;
  summaries: Array<{ code: string; parents: string[]; prerequisites: string[] }>;
  catalogue: Record<string, string[]>;
}

export const loadSpec = () => JSON.parse(readFileSync(path.join(HANDWRITING_DIR, "spec.json"), "utf8")) as HandwritingSpec;
export const loadManifest = () => JSON.parse(readFileSync(path.join(HANDWRITING_DIR, "manifest.json"), "utf8")) as { copies: ManifestCopy[] };

export const evalUuid = (seed: string) => {
  const h = createHash("sha256").update(`focus-eval:${seed}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

export interface RunOptions {
  apiKey: string;
  scanModel: string;
  scanEffort: ReasoningEffort;
  analysisModel: string;
  analysisEffort: ReasoningEffort;
  /** How photos reach the reader: wrapped in a PDF (what the browser sends) or as images. */
  input: "pdf" | "images";
  analyse: boolean;
  fetchImpl?: typeof fetch;
}

async function jpegToPdf(jpeg: Uint8Array) {
  const pdf = await PDFDocument.create();
  const image = await pdf.embedJpg(jpeg);
  const ratio = 842 / Math.max(image.width, image.height);
  const page = pdf.addPage([image.width * ratio, image.height * ratio]);
  page.drawImage(image, { x: 0, y: 0, width: image.width * ratio, height: image.height * ratio });
  return pdf.save();
}

/** One fixture through the reader and (optionally) the analysis. Never throws. */
export async function runHandwritingCopy(
  copy: ManifestCopy,
  spec: HandwritingSpec,
  curriculum: CurriculumProjection,
  options: RunOptions,
  fileBytes?: Uint8Array,
) {
  const assessment = spec.assessments[copy.assessment];
  const questions: ScanQuestion[] = assessment.questions.map((q, index) => ({
    id: evalUuid(`question:${copy.assessment}:${q.key}`), position: index + 1, prompt: q.prompt, maxPoints: q.maxPoints, correctionText: q.correction,
  }));
  const keyOf = new Map(questions.map((q, index) => [q.id, assessment.questions[index].key]));
  const roster = Object.entries(spec.students).map(([key, s]) => ({ id: evalUuid(`student:${key}`), name: s.name, key }));
  const record: Record<string, unknown> = { id: copy.id, kind: copy.kind, level: copy.level ?? null, options: { ...options, apiKey: undefined, fetchImpl: undefined } };
  const file = copy.pdf ?? copy.image!;
  const raw = fileBytes ?? new Uint8Array(readFileSync(path.join(HANDWRITING_DIR, file)));
  const started = Date.now();
  let extraction;
  try {
    const source =
      file.endsWith(".pdf")
        ? { kind: "pdf" as const, bytes: raw }
        : options.input === "images"
          ? { kind: "images" as const, images: [{ bytes: raw, mime: "image/jpeg" as const }] }
          : { kind: "pdf" as const, bytes: await jpegToPdf(raw) };
    extraction = await transcribeScan(source, roster.map(({ id, name }) => ({ id, name })), questions, {
      apiKey: options.apiKey, model: options.scanModel, effort: options.scanEffort, fetchImpl: options.fetchImpl,
    });
  } catch (error) {
    record.scan = { ok: false, error: error instanceof Error ? error.message : String(error), latencyMs: Date.now() - started };
    return record;
  }
  const rosterIds = new Set(roster.map((s) => s.id));
  record.scan = {
    ok: true,
    latencyMs: Date.now() - started,
    attempts: extraction.attempts,
    pageCount: extraction.pageCount,
    pages: extraction.pages,
    warnings: extraction.warnings,
    copies: extraction.copies.map((c) => ({
      student: roster.find((s) => s.id === c.studentId)?.key ?? null,
      studentNameRead: c.studentNameRead,
      identificationConfidence: c.identificationConfidence,
      score: c.score,
      autoImportIssue: scanCopyIssue(c, rosterIds, questions, extraction.pages),
      responses: normalizedResponses(c, questions).map((r) => ({ q: keyOf.get(r.questionId), text: r.responseText, legibility: r.legibility, crossedOut: r.crossedOut, points: r.awardedPoints, annotation: r.teacherAnnotation })),
    })),
  };
  const target = extraction.copies.find((c) => roster.find((s) => s.id === c.studentId)?.key === copy.student) ?? extraction.copies[0];
  if (!target || !options.analyse) return record;
  const responses = normalizedResponses(target, questions);
  const assessmentId = evalUuid(`assessment:${copy.assessment}`);
  const number = (value: string) => {
    const n = Number(value.replace(",", "."));
    return value.trim() && Number.isFinite(n) ? n : null;
  };
  const aiInput = {
    assessment: { id: assessmentId, contextText: null, instructionsText: null },
    questions: assessment.questions.map((q, index) => ({
      assessmentId, questionId: questions[index].id, prompt: q.prompt, correctionText: q.correction, rubricText: "", maxPoints: q.maxPoints,
      responseText: responses[index].responseText, awardedPoints: number(responses[index].awardedPoints),
      teacherAnnotation: responses[index].teacherAnnotation || null, assessedNotions: [...q.notions].sort(),
      transcription: { source: "scan", verified: false, legibility: responses[index].legibility },
    })),
    curriculum: curriculum.aiCurriculum,
  };
  const cache = new Map<string, Set<string>>();
  const validationInput = aiInput.questions.map((q) => ({
    assessmentId, questionId: q.questionId, responseText: q.responseText, correctionText: q.correctionText,
    maxPoints: q.maxPoints, awardedPoints: q.awardedPoints, assessedCodes: q.assessedNotions, legibility: q.transcription.legibility,
  }));
  // As in production (pedagogy-actions): when the evidence alone decides every
  // question (nothing written, illegible, absent), the model is not called.
  const decidedByEvidence = evidenceOnlyOutcomes(validationInput);
  if (decidedByEvidence) {
    record.analysis = {
      ok: true,
      modelCalled: false,
      latencyMs: 0,
      tokens: 0,
      status: "insufficient_evidence",
      insufficientReason: "decided by the evidence alone",
      outcomes: decidedByEvidence.map((o) => ({ q: keyOf.get(o.questionId), outcome: o.outcome, excerpt: o.excerpt, note: o.note })),
      errors: [],
      rejected: [],
    };
    return record;
  }
  const analysisStarted = Date.now();
  try {
    const result = await requestPedagogicalAnalysisWithUsage(aiInput, {
      apiKey: options.apiKey, model: options.analysisModel, reasoningEffort: options.analysisEffort, fetchImpl: options.fetchImpl,
    });
    const validated = validateModelAnalysis(result.analysis, validationInput, new Map(Object.entries(curriculum.mappable)), {
      relatedCodes: (assessed) => {
        const key = [...assessed].sort().join("|");
        let set = cache.get(key);
        if (!set) cache.set(key, (set = relatedNotionCodes(curriculum.summaries, assessed)));
        return set;
      },
      catalogueCodes: new Map(Object.entries(curriculum.catalogue).map(([code, codes]) => [code, new Set(codes)])),
    });
    record.analysis = {
      ok: true,
      latencyMs: result.latencyMs,
      tokens: result.usage.totalTokens,
      status: validated.status,
      insufficientReason: validated.insufficientReason,
      outcomes: validated.questionOutcomes.map((o) => ({ q: keyOf.get(o.questionId), outcome: o.outcome, excerpt: o.excerpt, note: o.note })),
      errors: validated.errors.map((e) => ({ q: keyOf.get(e.questionId), nodeCode: e.nodeCode, errorType: e.errorType, excerpt: e.evidenceExcerpt, difficulty: e.difficulty, explanation: e.explanation })),
      rejected: validated.rejected.map((r) => ({ q: keyOf.get(r.questionId) ?? r.questionId, nodeCode: r.nodeCode, reason: r.reason })),
    };
  } catch (error) {
    record.analysis = { ok: false, error: error instanceof Error ? error.message : String(error), latencyMs: Date.now() - analysisStarted };
  }
  return record;
}

// ---------------------------------------------------------------------------
// Scoring against the ground truth
// ---------------------------------------------------------------------------

export function normalizeForScore(text: string) {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\[\s*illisible\s*\]/g, "§")
    .replace(/\[\?([^\]]*)\]/g, "$1")
    .replace(/\^2/g, "2")
    .replace(/²/g, "2")
    .replace(/[×·*]/g, "x")
    .replace(/[−–]/g, "-")
    .replace(/÷/g, ":")
    .replace(/\s+/g, "")
    .replace(/[.;]+$/g, "");
}

export function levenshtein(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

type ScanRecord = { ok: boolean; latencyMs?: number; copies?: Array<{ student: string | null; responses: Array<{ q: string; text: string; legibility: string; crossedOut: string }> }> };
type AnalysisRecord = { ok: boolean; latencyMs?: number; outcomes?: Array<{ q: string; outcome: string }>; errors?: Array<{ q: string; nodeCode: string; errorType: string }> };

export function scoreHandwritingRecord(record: { id: string; scan?: ScanRecord; analysis?: AnalysisRecord }, copy: ManifestCopy) {
  const scan = record.scan;
  if (!scan?.ok) return { id: copy.id, level: copy.level ?? null, scanOk: false };
  const read = scan.copies?.find((c) => c.student === copy.student) ?? scan.copies?.[0];
  const questions = copy.questions.map((q) => {
    const got = read?.responses.find((r) => r.q === q.key);
    const text = got?.text ?? "";
    const truth = normalizeForScore(q.text);
    const predicted = normalizeForScore(text);
    const visible = predicted.replace(/§/g, "");
    const hiddenLeaks = q.hidden.filter((h) => {
      const hidden = normalizeForScore(h);
      return hidden.length > 0 && visible.includes(hidden) && !normalizeForScore(q.text.replace(/\[illisible\]/g, "")).includes(hidden);
    });
    const crossedLeaks = q.crossedOut.filter((c) => {
      const crossed = normalizeForScore(c);
      return crossed.length > 0 && predicted.includes(crossed) && !truth.includes(crossed);
    });
    const outcome = record.analysis?.ok ? record.analysis.outcomes?.find((o) => o.q === q.key)?.outcome ?? null : null;
    const expected = Array.isArray(q.expect.outcome) ? q.expect.outcome : [q.expect.outcome];
    const finding = record.analysis?.ok ? record.analysis.errors?.find((e) => e.q === q.key) : undefined;
    return {
      key: q.key,
      cer: truth.length ? levenshtein(predicted, truth) / truth.length : predicted.length ? 1 : 0,
      legibility: got?.legibility ?? "absente",
      hiddenPresent: q.hidden.length > 0,
      hiddenLeaks,
      uncertaintyFlagged: q.hidden.length ? got?.legibility !== "lisible" : null,
      crossedLeaks,
      outcome,
      outcomeExpected: expected,
      outcomeOk: outcome === null ? null : expected.map((value) => (value === "no_error" ? "no_error_observed" : value)).includes(outcome),
      findingOk:
        finding && q.expect.notions
          ? q.expect.notions.includes(finding.nodeCode) && (!q.expect.errorTypes || q.expect.errorTypes.includes(finding.errorType))
          : null,
      // An error asserted where the ground truth has none: a hallucinated diagnosis.
      falseFinding: record.analysis?.ok ? Boolean(finding) && !expected.includes("error") : null,
      // A real error (the only acceptable outcome) that the analysis did not report.
      missedError: record.analysis?.ok ? expected.length === 1 && expected[0] === "error" && outcome !== "error" : null,
    };
  });
  const latencyMs = (scan.latencyMs ?? 0) + (record.analysis?.latencyMs ?? 0);
  return { id: copy.id, level: copy.level ?? null, kind: copy.kind, scanOk: true, studentFound: read?.student === copy.student, latencyMs, questions };
}

/**
 * The five tests of the 9 October mission, on the fictitious fixtures (images
 * of simulated handwriting, never typed text):
 * A perfect copy · B errors (calculation, reasoning, notation) · C difficult
 * handwriting with crossings-out and corrections · D right method, wrong
 * intermediate step · E insufficient evidence (destroyed, absent, blank).
 */
export const PEDAGOGICAL_TESTS: Record<string, { label: string; copies: string[]; questions?: Record<string, string[]> }> = {
  A: { label: "Copie parfaite", copies: ["E2-S1-B", "E3-S1-B"] },
  B: { label: "Copie avec erreurs (calcul, concept, raisonnement, notation)", copies: ["E1-S1-A", "E1-S2-B", "E2-S2-B", "E2-S3-B", "E1-S6-C"] },
  C: { label: "Écriture difficile : ratures, corrections, chiffres ambigus", copies: ["E1-S3-C", "E1-S3-series-C", "E1-S3-series-D", "E1-S6-C"] },
  D: { label: "Méthode pertinente, erreur intermédiaire", copies: ["E1-S1-A", "E1-S6-C", "E3-S3-B"], questions: { "E1-S1-A": ["Q4"], "E1-S6-C": ["Q4"], "E3-S3-B": ["Q2"] } },
  E: { label: "Preuves insuffisantes", copies: ["E1-S5-E", "E1-S3-series-E", "FM-cut", "FM-blank"] },
};

export function aggregatePedagogicalTests(scores: ReturnType<typeof scoreHandwritingRecord>[]) {
  const byId = new Map(scores.map((score) => [score.id, score]));
  return Object.fromEntries(
    Object.entries(PEDAGOGICAL_TESTS).map(([test, definition]) => {
      const present = definition.copies.map((id) => byId.get(id)).filter((score): score is NonNullable<typeof score> => Boolean(score));
      const read = present.filter((score) => "questions" in score && score.questions);
      const questions = read.flatMap((score) =>
        ("questions" in score && score.questions ? score.questions : []).filter((q) => !definition.questions?.[score.id] || definition.questions[score.id].includes(q.key)),
      );
      const visible = questions.filter((q) => !q.hiddenPresent);
      const analysed = questions.filter((q) => q.outcomeOk !== null);
      const findings = questions.filter((q) => q.findingOk !== null);
      const latencies = read.map((score) => ("latencyMs" in score ? score.latencyMs ?? 0 : 0)).sort((a, b) => a - b);
      return [
        test,
        {
          label: definition.label,
          copies: definition.copies.length,
          copiesRun: present.length,
          copiesRead: read.length,
          meanCer: visible.length ? Number((visible.reduce((sum, q) => sum + q.cer, 0) / visible.length).toFixed(3)) : null,
          inventedUnderDestroyedOrAbsent: questions.filter((q) => q.hiddenLeaks.length).length,
          crossedOutKept: questions.reduce((sum, q) => sum + q.crossedLeaks.length, 0),
          outcomes: analysed.length,
          outcomesCorrect: analysed.filter((q) => q.outcomeOk).length,
          hallucinatedErrors: questions.filter((q) => q.falseFinding).length,
          missedErrors: questions.filter((q) => q.missedError).length,
          diagnosesChecked: findings.length,
          diagnosesCorrect: findings.filter((q) => q.findingOk).length,
          medianLatencyMs: latencies.length ? latencies[Math.floor(latencies.length / 2)] : null,
          maxLatencyMs: latencies.length ? latencies[latencies.length - 1] : null,
        },
      ];
    }),
  );
}

export function aggregateHandwriting(scores: ReturnType<typeof scoreHandwritingRecord>[]) {
  const byLevel: Record<string, { copies: number; meanCer: number | null; hiddenSpans: number; hiddenLeaks: number; uncertaintyFlagged: number; crossedLeaks: number; outcomes: number; outcomesOk: number }> = {};
  for (const score of scores) {
    const level = score.level ?? "-";
    const bucket = (byLevel[level] ??= { copies: 0, meanCer: 0, hiddenSpans: 0, hiddenLeaks: 0, uncertaintyFlagged: 0, crossedLeaks: 0, outcomes: 0, outcomesOk: 0 });
    bucket.copies++;
    if (!("questions" in score) || !score.questions) continue;
    const visible = score.questions.filter((q) => !q.hiddenPresent);
    bucket.meanCer = (bucket.meanCer ?? 0) + visible.reduce((sum, q) => sum + q.cer, 0) / Math.max(1, visible.length);
    for (const q of score.questions) {
      if (q.hiddenPresent) {
        bucket.hiddenSpans++;
        if (q.hiddenLeaks.length) bucket.hiddenLeaks++;
        if (q.uncertaintyFlagged) bucket.uncertaintyFlagged++;
      }
      bucket.crossedLeaks += q.crossedLeaks.length;
      if (q.outcomeOk !== null) {
        bucket.outcomes++;
        if (q.outcomeOk) bucket.outcomesOk++;
      }
    }
  }
  for (const bucket of Object.values(byLevel)) bucket.meanCer = bucket.copies ? Number(((bucket.meanCer ?? 0) / bucket.copies).toFixed(3)) : null;
  return byLevel;
}
