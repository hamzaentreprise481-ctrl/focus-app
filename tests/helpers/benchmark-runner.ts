// Runs benchmark cases through exactly the production analysis path:
// the curriculum as the model sees it (focus_curriculum_graph of the
// migrated schema + the catalogue's typical errors), the same model input
// shape as the teacher action, and the production validators.

import { createHash } from "node:crypto";
import { buildCurriculumIndex, parseCurriculumGraphPayload, toAiCurriculum, type CurriculumIndex } from "../../lib/curriculum/graph";
import { relatedNotionCodes, validateModelAnalysis } from "../../lib/pedagogy/analysis";
import type { BenchmarkCase, CaseRun } from "../../lib/pedagogy/benchmark";
import { createMigratedDatabase } from "./pg";

export function benchmarkUuid(seed: string) {
  const hex = createHash("sha256").update(`focus-benchmark:${seed}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export interface BenchmarkContext {
  graph: CurriculumIndex;
  aiCurriculum: ReturnType<typeof toAiCurriculum>;
  catalogueCodes: Map<string, Set<string>>;
  relatedCodes: (assessed: string[]) => Set<string>;
}

export async function loadProductionCurriculum(): Promise<BenchmarkContext> {
  const db = await createMigratedDatabase();
  try {
    const [{ graph }] = (await db.query<{ graph: unknown }>("select public.focus_curriculum_graph('MATH', array['SECONDE_GT']) as graph")).rows;
    const index = buildCurriculumIndex(parseCurriculumGraphPayload(graph));
    const { rows } = await db.query<{ node_code: string; code: string; description: string }>(
      `select n.code as node_code, te.code, te.description
       from public.curriculum_typical_errors te join public.curriculum_nodes n on n.id = te.node_id
       where te.active order by n.code, te.position`,
    );
    const typicalErrors = new Map<string, Array<{ code: string; description: string }>>();
    for (const row of rows) {
      if (!index.mappableNotionIdsByCode.has(row.node_code)) continue;
      typicalErrors.set(row.node_code, [...(typicalErrors.get(row.node_code) ?? []), { code: row.code, description: row.description }]);
    }
    const cache = new Map<string, Set<string>>();
    return {
      graph: index,
      aiCurriculum: toAiCurriculum(index.summaries, typicalErrors),
      catalogueCodes: new Map([...typicalErrors].map(([code, entries]) => [code, new Set(entries.map((entry) => entry.code))])),
      relatedCodes: (assessed) => {
        const key = [...assessed].sort().join("|");
        let set = cache.get(key);
        if (!set) cache.set(key, (set = relatedNotionCodes(index.summaries, assessed)));
        return set;
      },
    };
  } finally {
    await db.close();
  }
}

export function questionIdsOf(testCase: BenchmarkCase) {
  return new Map(testCase.questions.map((question) => [question.key, benchmarkUuid(`${testCase.id}:${question.key}`)]));
}

/** The model input, shaped like the teacher action's. */
export function modelInput(testCase: BenchmarkCase, context: BenchmarkContext) {
  const assessmentId = benchmarkUuid(testCase.id);
  const ids = questionIdsOf(testCase);
  return {
    assessment: { id: assessmentId, title: testCase.title, contextText: testCase.context ?? null, instructionsText: null },
    questions: testCase.questions.map((question) => ({
      assessmentId,
      questionId: ids.get(question.key)!,
      prompt: question.prompt,
      correctionText: question.correction,
      rubricText: question.rubric ?? "",
      maxPoints: question.maxPoints,
      responseText: question.response,
      awardedPoints: question.awardedPoints,
      teacherAnnotation: question.annotation ?? null,
      assessedNotions: [...question.assessedNotions].sort(),
    })),
    curriculum: context.aiCurriculum,
  };
}

/** What an ideal model would answer: the expected findings, nothing else. */
export function referenceOutput(testCase: BenchmarkCase) {
  const assessmentId = benchmarkUuid(testCase.id);
  const ids = questionIdsOf(testCase);
  return {
    status: testCase.expected.status,
    insufficientReason: testCase.expected.status === "insufficient_evidence" ? "La réponse ne montre pas d’étape permettant d’identifier une erreur précise." : "",
    errors: testCase.expected.errors.map((error) => ({
      assessmentId,
      questionId: ids.get(error.question)!,
      nodeCode: error.notions[0],
      errorType: error.errorTypes[0],
      difficulty: "Point à retravailler à partir de l’extrait cité",
      evidenceExcerpt: error.excerpt,
      explanation: "L’extrait cité montre une étape qui ne correspond pas au corrigé.",
      recommendedAction: "Reprendre cette étape sur un exemple guidé puis un exemple autonome.",
      catalogueErrorCode: error.catalogue ?? "",
    })),
  };
}

export type ModelCall = (input: ReturnType<typeof modelInput>) => Promise<{ raw: unknown; latencyMs: number | null; totalTokens: number | null }>;

export async function runCase(testCase: BenchmarkCase, context: BenchmarkContext, call: ModelCall): Promise<CaseRun> {
  const input = modelInput(testCase, context);
  const evidence = input.questions.map((question) => ({
    assessmentId: question.assessmentId,
    questionId: question.questionId,
    responseText: question.responseText,
    correctionText: question.correctionText,
    maxPoints: question.maxPoints,
    awardedPoints: question.awardedPoints,
    assessedCodes: question.assessedNotions,
  }));
  const options = { relatedCodes: context.relatedCodes, catalogueCodes: context.catalogueCodes };
  // Like the teacher action: no answer at all, no model call.
  if (!input.questions.some((question) => question.responseText.trim()))
    return {
      caseId: testCase.id,
      category: testCase.category,
      modelCalled: false,
      raw: null,
      validated: validateModelAnalysis(null, evidence, context.graph.mappableNotionIdsByCode, options),
      latencyMs: null,
      totalTokens: null,
      failure: null,
    };
  try {
    const { raw, latencyMs, totalTokens } = await call(input);
    return {
      caseId: testCase.id,
      category: testCase.category,
      modelCalled: true,
      raw,
      validated: validateModelAnalysis(raw, evidence, context.graph.mappableNotionIdsByCode, options),
      latencyMs,
      totalTokens,
      failure: null,
    };
  } catch (error) {
    return {
      caseId: testCase.id,
      category: testCase.category,
      modelCalled: true,
      raw: null,
      validated: validateModelAnalysis(null, evidence, context.graph.mappableNotionIdsByCode, options),
      latencyMs: null,
      totalTokens: null,
      failure: error instanceof Error ? error.message : "UNKNOWN",
    };
  }
}
