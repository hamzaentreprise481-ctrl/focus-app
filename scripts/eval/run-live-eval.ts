// TEMPORARY live evaluation harness — evaluation branch only.
//
// BASELINE MODE: runs the CURRENT, unmodified FOCUS pipeline on the
// fictitious handwritten fixtures (tests/fixtures/handwriting):
//   JPEG photo → PDF (the current import accepts PDF only) → extractScanStack
//   (lib/scan-import.ts, production prompt/schema/model) → scanCopyIssue
//   (auto-import gate) → the analysis input the teacher action builds →
//   requestPedagogicalAnalysisWithUsage → validateModelAnalysis.
// It records raw transcriptions and analysis outputs of fictitious copies
// plus latencies; never keys. Output: public/__focus-eval/results.json.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { extractScanStack, scanImportModel } from "../../lib/scan-import";
import { normalizedResponses, scanCopyIssue, type ScanQuestion } from "../../lib/scan-import-core";
import { pedagogicalReasoningEffort, requestPedagogicalAnalysisWithUsage } from "../../lib/pedagogy/openai-client";
import { pedagogicalAiModel } from "../../lib/pedagogy/openai";
import { validateModelAnalysis } from "../../lib/pedagogy/analysis";
import { loadProductionCurriculum } from "../../tests/helpers/benchmark-runner";

const ROOT = path.join(__dirname, "..", "..");
const FIXTURES = path.join(ROOT, "tests", "fixtures", "handwriting");
const OUT = path.join(ROOT, "public", "__focus-eval");

type Spec = {
  assessments: Record<string, { title: string; questions: Array<{ key: string; prompt: string; correction: string; maxPoints: number; notions: string[] }> }>;
  students: Record<string, { name: string }>;
};
type ManifestCopy = { id: string; kind: string; assessment: string; student?: string; level?: string; image: string | null; pdf?: string; questions: Array<{ key: string; text: string }> };

const uuid = (seed: string) => {
  const h = createHash("sha256").update(`focus-eval:${seed}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

async function jpegToPdf(jpeg: Uint8Array) {
  const pdf = await PDFDocument.create();
  const image = await pdf.embedJpg(jpeg);
  const page = pdf.addPage([image.width * 0.6, image.height * 0.6]);
  page.drawImage(image, { x: 0, y: 0, width: image.width * 0.6, height: image.height * 0.6 });
  return pdf.save();
}

async function pool<T>(items: T[], size: number, run: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: size }, async () => {
    for (let item = queue.shift(); item; item = queue.shift()) await run(item);
  }));
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const spec = JSON.parse(readFileSync(path.join(FIXTURES, "spec.json"), "utf8")) as Spec;
  const manifest = JSON.parse(readFileSync(path.join(FIXTURES, "manifest.json"), "utf8")) as { copies: ManifestCopy[] };
  const only = process.env.FOCUS_EVAL_ONLY?.split(",");
  const copies = only ? manifest.copies.filter((c) => only.includes(c.id)) : manifest.copies;
  const roster = Object.entries(spec.students).map(([key, s]) => ({ id: uuid(`student:${key}`), name: s.name, key }));
  const curriculum = await loadProductionCurriculum();
  const results: Record<string, unknown>[] = [];
  const report = () =>
    writeFileSync(
      path.join(OUT, "results.json"),
      `${JSON.stringify({ mode: "baseline-current-pipeline", generatedAt: new Date().toISOString(), sha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
        scanModel: scanImportModel(), analysisModel: pedagogicalAiModel(), analysisEffort: pedagogicalReasoningEffort(), results }, null, 2)}\n`,
    );

  await pool(copies, 4, async (copy) => {
    const assessment = spec.assessments[copy.assessment];
    const questions: ScanQuestion[] = assessment.questions.map((q, index) => ({
      id: uuid(`question:${copy.assessment}:${q.key}`), position: index + 1, prompt: q.prompt, maxPoints: q.maxPoints,
    }));
    const keyById = new Map(questions.map((q, i) => [q.id, assessment.questions[i].key]));
    const entry: Record<string, unknown> = { id: copy.id, kind: copy.kind, level: copy.level ?? null };
    try {
      const file = copy.pdf ?? copy.image!;
      const raw = new Uint8Array(readFileSync(path.join(FIXTURES, file)));
      const bytes = file.endsWith(".pdf") ? raw : await jpegToPdf(raw);
      const started = Date.now();
      let extraction;
      try {
        extraction = await extractScanStack(bytes, roster.map(({ id, name }) => ({ id, name })), questions);
      } catch (error) {
        entry.scan = { ok: false, error: error instanceof Error ? error.message : String(error), latencyMs: Date.now() - started };
        return;
      }
      const rosterIds = new Set(roster.map((s) => s.id));
      entry.scan = {
        ok: true,
        latencyMs: Date.now() - started,
        pageCount: extraction.pageCount,
        warnings: extraction.warnings,
        unassignedPages: extraction.unassignedPages,
        copies: extraction.copies.map((c) => ({
          student: roster.find((s) => s.id === c.studentId)?.key ?? null,
          studentNameRead: c.studentNameRead,
          identificationConfidence: c.identificationConfidence,
          groupingConfidence: c.groupingConfidence,
          transcriptionConfidence: c.transcriptionConfidence,
          score: c.score,
          scoreConfidence: c.scoreConfidence,
          pages: [c.startPage, c.endPage],
          warnings: c.warnings,
          autoImportIssue: scanCopyIssue(c, rosterIds, questions),
          responses: normalizedResponses(c, questions).map((r) => ({ q: keyById.get(r.questionId), text: r.responseText, points: r.awardedPoints, annotation: r.teacherAnnotation })),
        })),
      };
      const target = extraction.copies.find((c) => roster.find((s) => s.id === c.studentId)?.key === copy.student) ?? extraction.copies[0];
      if (!target) return;
      const responses = normalizedResponses(target, questions);
      const assessmentId = uuid(`assessment:${copy.assessment}`);
      const num = (value: string) => {
        const n = Number(value.replace(",", "."));
        return value.trim() && Number.isFinite(n) ? n : null;
      };
      const aiInput = {
        assessment: { id: assessmentId, contextText: null, instructionsText: null },
        questions: assessment.questions.map((q, index) => {
          const response = responses[index];
          return {
            assessmentId, questionId: questions[index].id, prompt: q.prompt, correctionText: q.correction, rubricText: "",
            maxPoints: q.maxPoints, responseText: response.responseText, awardedPoints: num(response.awardedPoints),
            teacherAnnotation: response.teacherAnnotation || null, assessedNotions: [...q.notions].sort(),
          };
        }),
        curriculum: curriculum.aiCurriculum,
      };
      const analysisStarted = Date.now();
      try {
        const result = await requestPedagogicalAnalysisWithUsage(aiInput, {
          apiKey: process.env.OPENAI_API_KEY!, model: pedagogicalAiModel(), reasoningEffort: pedagogicalReasoningEffort(),
        });
        const validated = validateModelAnalysis(result.analysis, aiInput.questions.map((q) => ({
          assessmentId, questionId: q.questionId, responseText: q.responseText, correctionText: q.correctionText,
          maxPoints: q.maxPoints, awardedPoints: q.awardedPoints, assessedCodes: q.assessedNotions,
        })), curriculum.graph.mappableNotionIdsByCode, { relatedCodes: curriculum.relatedCodes, catalogueCodes: curriculum.catalogueCodes });
        entry.analysis = {
          ok: true, latencyMs: result.latencyMs, tokens: result.usage.totalTokens,
          raw: { status: result.analysis.status, insufficientReason: result.analysis.insufficientReason,
            errors: result.analysis.errors.map((e) => ({ q: keyById.get(e.questionId) ?? e.questionId, nodeCode: e.nodeCode, errorType: e.errorType, excerpt: e.evidenceExcerpt, difficulty: e.difficulty, explanation: e.explanation })) },
          validated: { status: validated.status, insufficientReason: validated.insufficientReason,
            errors: validated.errors.map((e) => ({ q: keyById.get(e.questionId), nodeCode: e.nodeCode, errorType: e.errorType, excerpt: e.evidenceExcerpt })),
            rejected: validated.rejected.map((r) => ({ q: keyById.get(r.questionId) ?? r.questionId, nodeCode: r.nodeCode, reason: r.reason })) },
        };
      } catch (error) {
        entry.analysis = { ok: false, error: error instanceof Error ? error.message : String(error), latencyMs: Date.now() - analysisStarted };
      }
    } finally {
      results.push(entry);
      report();
      console.log(`[focus-eval] ${copy.id}: scan=${(entry.scan as { ok?: boolean })?.ok} analysis=${(entry.analysis as { ok?: boolean })?.ok ?? "-"}`);
    }
  });
  report();
}

main().catch((error) => {
  console.error("[focus-eval] harness failed", error instanceof Error ? error.message : error);
  process.exit(1);
});
