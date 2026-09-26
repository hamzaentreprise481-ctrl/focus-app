import "server-only";

// Server-side data access for the pedagogical workflow. Every function takes
// the cookie-bound Supabase client of the signed-in teacher: RLS and the
// database functions authorize each row; the checks here only give clear
// errors and keep other teachers' data out of reach before any query.

import type { createAuthClient } from "@/lib/auth/server";
import {
  buildCurriculumIndex,
  parseCurriculumGraphPayload,
  resolveCurriculumScope,
  type CurriculumIndex,
} from "@/lib/curriculum/graph";
import { relatedNotionCodes } from "@/lib/pedagogy/analysis";
import type {
  AssessmentAnalysisState,
  CatalogueSuggestion,
  ModelAnalysisStatus,
  NotionOption,
  NotionTimeline,
  PedagogicalConfidence,
  PedagogicalRecommendationView,
  RecommendationStatus,
} from "@/lib/pedagogy/types";

export type SupabaseClient = NonNullable<Awaited<ReturnType<typeof createAuthClient>>>;

// The pedagogical AI V1 is limited to mathematics.
export const CURRICULUM_SUBJECT_CODE = "MATH";

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class AccessError extends Error {}

export function ensureOk(error: { message: string } | null, label: string) {
  if (error) throw new Error(`${label}: ${error.message}`);
}

export type AssessmentRow = {
  id: string;
  school_id: string;
  class_id: string;
  subject_id: string;
  teacher_id: string;
  title: string;
  date: string;
};
export type QuestionRow = {
  id: string;
  assessment_id: string;
  position: number;
  prompt: string;
  correction_text: string;
  rubric: { text?: string } | null;
  max_points: number | string | null;
};
export type ResponseRow = {
  id: string;
  assessment_id: string;
  question_id: string;
  student_id: string;
  response_text: string;
  awarded_points: number | string | null;
  teacher_annotation: string | null;
};
export type MaterialRow = {
  assessment_id: string;
  context_text: string | null;
  instructions_text: string | null;
};
type RunRow = {
  id: string;
  assessment_id: string;
  student_id: string;
  status: "completed" | "failed" | "no_evidence";
  failure_reason: string | null;
  created_at: string;
};
type RecommendationRow = {
  id: string;
  analysis_run_id: string;
  assessment_id: string;
  curriculum_node_id: string;
  difficulty: string;
  evidence: unknown;
  confidence: PedagogicalConfidence;
  explanation: string;
  recommended_action: string;
  teacher_decision: "validated" | "dismissed" | null;
  teacher_decided_at: string | null;
  teacher_note: string | null;
  superseded_at: string | null;
  catalogue_error_id: string | null;
  created_at: string;
};

export const toNumber = (value: number | string | null | undefined) =>
  value === null || value === undefined || value === "" ? null : Number(value);

function isMathSubject(subject: { name: string; code: string | null }) {
  return (
    subject.code?.toUpperCase().startsWith("MATH") === true ||
    subject.name.toLocaleLowerCase("fr").includes("math")
  );
}

/** The teacher's access to one assessment (read through class RLS). */
export async function assessmentAccess(supabase: SupabaseClient, teacherId: string, assessmentId: string) {
  if (!UUID_RE.test(assessmentId)) throw new AccessError("Évaluation invalide.");
  const response = await supabase
    .from("assessments")
    .select("id,school_id,class_id,subject_id,teacher_id,title,date")
    .eq("id", assessmentId)
    .maybeSingle();
  ensureOk(response.error, "Évaluation");
  const assessment = response.data as AssessmentRow | null;
  if (!assessment) throw new AccessError("Évaluation introuvable ou inaccessible.");

  const [classResponse, subjectResponse, assignmentResponse] = await Promise.all([
    supabase.from("classes").select("level").eq("id", assessment.class_id).maybeSingle(),
    supabase.from("subjects").select("name,code").eq("id", assessment.subject_id).maybeSingle(),
    supabase
      .from("teacher_assignments")
      .select("class_id")
      .eq("teacher_id", teacherId)
      .eq("class_id", assessment.class_id)
      .limit(1),
  ]);
  ensureOk(classResponse.error, "Classe");
  ensureOk(subjectResponse.error, "Matière");
  ensureOk(assignmentResponse.error, "Affectation");
  if (!(assignmentResponse.data ?? []).length)
    throw new AccessError("Cette évaluation n’appartient pas à une de vos classes.");
  const subject = subjectResponse.data as { name: string; code: string | null } | null;
  return {
    assessment,
    classLevel: (classResponse.data as { level: string | null } | null)?.level ?? null,
    editable: assessment.teacher_id === teacherId,
    isMath: subject ? isMathSubject(subject) : false,
  };
}

/** The student belongs to one of the teacher's classes; math assessments of that class. */
export async function studentMathContext(supabase: SupabaseClient, teacherId: string, studentId: string) {
  if (!UUID_RE.test(studentId)) throw new AccessError("Élève invalide.");
  const assignmentsResponse = await supabase
    .from("teacher_assignments")
    .select("school_id,class_id,subject_id")
    .eq("teacher_id", teacherId);
  ensureOk(assignmentsResponse.error, "Affectations professeur");
  const assignments = (assignmentsResponse.data ?? []) as Array<{ school_id: string; class_id: string; subject_id: string }>;
  if (!assignments.length) throw new AccessError("Aucune classe n’est affectée à ce compte professeur.");

  const enrollmentResponse = await supabase
    .from("student_enrollments")
    .select("school_id,class_id")
    .eq("student_id", studentId)
    .in("class_id", [...new Set(assignments.map((row) => row.class_id))])
    .limit(1)
    .maybeSingle();
  ensureOk(enrollmentResponse.error, "Inscription élève");
  const enrollment = enrollmentResponse.data as { school_id: string; class_id: string } | null;
  if (!enrollment) throw new AccessError("Cet élève n’appartient pas à une de vos classes.");

  const subjectIds = [...new Set(assignments.filter((row) => row.class_id === enrollment.class_id).map((row) => row.subject_id))];
  const [classResponse, subjectsResponse] = await Promise.all([
    supabase.from("classes").select("level").eq("id", enrollment.class_id).maybeSingle(),
    supabase.from("subjects").select("id,name,code").in("id", subjectIds),
  ]);
  ensureOk(classResponse.error, "Classe");
  ensureOk(subjectsResponse.error, "Matières");
  const mathSubject = ((subjectsResponse.data ?? []) as Array<{ id: string; name: string; code: string | null }>).find(isMathSubject);
  if (!mathSubject) throw new AccessError("La V1 de l’IA pédagogique est limitée aux mathématiques.");

  const assessmentsResponse = await supabase
    .from("assessments")
    .select("id,school_id,class_id,subject_id,teacher_id,title,date")
    .eq("class_id", enrollment.class_id)
    .eq("subject_id", mathSubject.id)
    .order("date", { ascending: false });
  ensureOk(assessmentsResponse.error, "Évaluations");
  return {
    schoolId: enrollment.school_id,
    classId: enrollment.class_id,
    classLevel: (classResponse.data as { level: string | null } | null)?.level ?? null,
    assessments: (assessmentsResponse.data ?? []) as AssessmentRow[],
  };
}

/**
 * The official graph for the class level, through one RPC returning a single
 * JSON value: no PostgREST row cap, deterministic order, only active nodes of
 * the class's programme plus prior-level prerequisites as context.
 */
export async function curriculumGraph(supabase: SupabaseClient, classLevel: string | null): Promise<CurriculumIndex> {
  const sourcesResponse = await supabase
    .from("curriculum_sources")
    .select("level_code")
    .eq("subject_code", CURRICULUM_SUBJECT_CODE);
  ensureOk(sourcesResponse.error, "Sources du programme");
  const scope = resolveCurriculumScope(
    classLevel,
    ((sourcesResponse.data ?? []) as Array<{ level_code: string }>).map((row) => row.level_code),
  );
  if (scope.resolution === "subject_fallback")
    console.warn("FOCUS curriculum scope: class level not matched to an imported programme; using every level of the subject.");
  const graphResponse = await supabase.rpc("focus_curriculum_graph", {
    p_subject_code: CURRICULUM_SUBJECT_CODE,
    p_level_codes: scope.levelCodes,
  });
  ensureOk(graphResponse.error, "Graphe du programme");
  return buildCurriculumIndex(parseCurriculumGraphPayload(graphResponse.data));
}

/** In-scope notions a question can be tagged with, grouped by their parent. */
export function notionOptions(graph: CurriculumIndex): NotionOption[] {
  return graph.summaries
    .filter((summary) => summary.inScope && summary.nodeType === "notion")
    .map((summary) => {
      const parent = summary.parents.map((code) => graph.nodeByCode.get(code)).find(Boolean);
      return { code: summary.code, title: summary.title, group: parent?.title ?? "Autres notions" };
    })
    .sort((a, b) => a.group.localeCompare(b.group, "fr") || a.title.localeCompare(b.title, "fr"));
}

export function relatedCodesFor(graph: CurriculumIndex) {
  const cache = new Map<string, Set<string>>();
  return (assessedCodes: string[]) => {
    const key = [...assessedCodes].sort().join("|");
    let set = cache.get(key);
    if (!set) cache.set(key, (set = relatedNotionCodes(graph.summaries, assessedCodes)));
    return set;
  };
}

export async function evidenceRows(supabase: SupabaseClient, assessmentIds: string[], studentId?: string) {
  if (!assessmentIds.length)
    return { materials: [] as MaterialRow[], questions: [] as QuestionRow[], responses: [] as ResponseRow[], tags: [] as Array<{ question_id: string; code: string }> };
  let responsesQuery = supabase
    .from("student_responses")
    .select("id,assessment_id,question_id,student_id,response_text,awarded_points,teacher_annotation")
    .in("assessment_id", assessmentIds);
  if (studentId) responsesQuery = responsesQuery.eq("student_id", studentId);
  const [materials, questions, responses] = await Promise.all([
    supabase.from("assessment_materials").select("assessment_id,context_text,instructions_text").in("assessment_id", assessmentIds),
    supabase
      .from("assessment_questions")
      .select("id,assessment_id,position,prompt,correction_text,rubric,max_points")
      .in("assessment_id", assessmentIds)
      .order("position", { ascending: true }),
    responsesQuery,
  ]);
  ensureOk(materials.error, "Sujets d’évaluation");
  ensureOk(questions.error, "Questions");
  ensureOk(responses.error, "Réponses élève");
  const questionRows = (questions.data ?? []) as QuestionRow[];
  const tagsResponse = questionRows.length
    ? await supabase
        .from("question_curriculum_nodes")
        .select("question_id,relation,node:curriculum_nodes(code)")
        .in("question_id", questionRows.map((row) => row.id))
        .eq("relation", "assesses")
    : { data: [], error: null };
  ensureOk(tagsResponse.error, "Notions évaluées");
  const tags = ((tagsResponse.data ?? []) as unknown as Array<{ question_id: string; node: { code: string } | null }>)
    .filter((row) => row.node)
    .map((row) => ({ question_id: row.question_id, code: row.node!.code }));
  return {
    materials: (materials.data ?? []) as MaterialRow[],
    questions: questionRows,
    responses: (responses.data ?? []) as ResponseRow[],
    tags,
  };
}

/** Current (not superseded) terminal runs, newest first. */
export async function currentRuns(supabase: SupabaseClient, assessmentIds: string[], studentId?: string) {
  if (!assessmentIds.length) return [] as RunRow[];
  let query = supabase
    .from("ai_analysis_runs")
    .select("id,assessment_id,student_id,status,failure_reason,created_at")
    .in("assessment_id", assessmentIds)
    .is("superseded_at", null)
    .order("created_at", { ascending: false });
  if (studentId) query = query.eq("student_id", studentId);
  const response = await query;
  ensureOk(response.error, "Analyses pédagogiques");
  return (response.data ?? []) as RunRow[];
}

export function runStatus(run: RunRow | undefined, recommendationCount: number): ModelAnalysisStatus | null {
  if (!run) return null;
  if (run.status === "no_evidence") return "insufficient_evidence";
  if (run.status === "completed") return recommendationCount > 0 ? "errors_found" : "no_error_observed";
  return null;
}

function recommendationStatus(row: RecommendationRow): RecommendationStatus {
  if (row.superseded_at) return "superseded";
  return row.teacher_decision ?? "pending";
}

type CatalogueErrorRow = { id: string; node_id: string; code: string; description: string; position: number };
type CatalogueRemediationRow = {
  id: string;
  node_id: string;
  code: string;
  title: string;
  steps: string[];
  check_prompt: string | null;
  check_expected_answer: string | null;
  position: number;
  targets: Array<{ error_id: string }> | null;
};

/** Typical errors per in-scope notion code, for the model input. */
export async function catalogueErrorsByCode(supabase: SupabaseClient, graph: CurriculumIndex) {
  const byCode = new Map<string, Array<{ code: string; description: string }>>();
  const nodeIds = [...graph.mappableNotionIdsByCode.values()];
  if (!nodeIds.length) return byCode;
  const response = await supabase
    .from("curriculum_typical_errors")
    .select("node_id,code,description,position")
    .in("node_id", nodeIds)
    .eq("active", true)
    .order("position", { ascending: true });
  // The catalogue is optional: without it the model sees the graph only.
  if (response.error) return byCode;
  for (const row of (response.data ?? []) as CatalogueErrorRow[]) {
    const code = graph.nodeById.get(row.node_id)?.code;
    if (code) byCode.set(code, [...(byCode.get(code) ?? []), { code: row.code, description: row.description }]);
  }
  return byCode;
}

async function catalogueFor(supabase: SupabaseClient, nodeIds: string[]) {
  const errorsByNode = new Map<string, CatalogueErrorRow[]>();
  const remediationsByNode = new Map<string, CatalogueRemediationRow[]>();
  if (!nodeIds.length) return { errorsByNode, remediationsByNode };
  const [errors, remediations] = await Promise.all([
    supabase
      .from("curriculum_typical_errors")
      .select("id,node_id,code,description,position")
      .in("node_id", nodeIds)
      .eq("active", true)
      .order("position", { ascending: true }),
    supabase
      .from("curriculum_remediations")
      .select("id,node_id,code,title,steps,check_prompt,check_expected_answer,position")
      .in("node_id", nodeIds)
      .eq("active", true)
      .order("position", { ascending: true }),
  ]);
  // The catalogue is optional: a project without it still shows analyses.
  if (errors.error || remediations.error) return { errorsByNode, remediationsByNode };
  const remediationRows = (remediations.data ?? []) as CatalogueRemediationRow[];
  const targets = remediationRows.length
    ? await supabase
        .from("curriculum_remediation_targets")
        .select("remediation_id,error_id")
        .in("remediation_id", remediationRows.map((row) => row.id))
    : { data: [], error: null };
  const targetsByRemediation = new Map<string, Array<{ error_id: string }>>();
  if (!targets.error)
    for (const row of (targets.data ?? []) as Array<{ remediation_id: string; error_id: string }>)
      targetsByRemediation.set(row.remediation_id, [...(targetsByRemediation.get(row.remediation_id) ?? []), { error_id: row.error_id }]);
  for (const row of (errors.data ?? []) as CatalogueErrorRow[])
    errorsByNode.set(row.node_id, [...(errorsByNode.get(row.node_id) ?? []), row]);
  for (const row of remediationRows)
    remediationsByNode.set(row.node_id, [...(remediationsByNode.get(row.node_id) ?? []), { ...row, targets: targetsByRemediation.get(row.id) ?? [] }]);
  return { errorsByNode, remediationsByNode };
}

function catalogueSuggestions(
  catalogue: Awaited<ReturnType<typeof catalogueFor>>,
  nodeId: string,
  matchedErrorId: string | null,
): CatalogueSuggestion[] {
  const errors = catalogue.errorsByNode.get(nodeId) ?? [];
  const remediations = catalogue.remediationsByNode.get(nodeId) ?? [];
  const matched = matchedErrorId ? errors.find((row) => row.id === matchedErrorId) : undefined;
  const pickedErrors = matched ? [matched] : errors;
  const pickedRemediations = matched
    ? remediations.filter((row) => (row.targets ?? []).some((target) => target.error_id === matched.id))
    : remediations;
  return [
    ...pickedErrors.map((row) => ({ kind: "typical_error" as const, code: row.code, title: "Erreur type", text: row.description, matched: !!matched })),
    ...pickedRemediations.map((row) => ({
      kind: "remediation" as const,
      code: row.code,
      title: row.title || "Remédiation",
      text: (row.steps ?? []).join(" → "),
      matched: !!matched,
      check: row.check_prompt ? { prompt: row.check_prompt, expectedAnswer: row.check_expected_answer } : null,
    })),
  ];
}

/** Everything the student file needs about analyses and recommendations. */
export async function studentPedagogy(
  supabase: SupabaseClient,
  context: Awaited<ReturnType<typeof studentMathContext>>,
  studentId: string,
) {
  const assessmentIds = context.assessments.map((assessment) => assessment.id);
  const [{ questions, responses, tags }, runs, recommendationsResponse] = await Promise.all([
    evidenceRows(supabase, assessmentIds, studentId),
    currentRuns(supabase, assessmentIds, studentId),
    assessmentIds.length
      ? supabase
          .from("pedagogical_recommendations")
          .select(
            "id,analysis_run_id,assessment_id,curriculum_node_id,difficulty,evidence,confidence,explanation,recommended_action,teacher_decision,teacher_decided_at,teacher_note,superseded_at,catalogue_error_id,created_at",
          )
          .eq("student_id", studentId)
          .in("assessment_id", assessmentIds)
          .order("created_at", { ascending: false })
          .limit(200)
      : Promise.resolve({ data: [], error: null }),
  ]);
  ensureOk(recommendationsResponse.error, "Recommandations pédagogiques");
  const recommendationRows = (recommendationsResponse.data ?? []) as RecommendationRow[];

  const graph = await curriculumGraph(supabase, context.classLevel);
  const missingIds = [...new Set(recommendationRows.map((row) => row.curriculum_node_id))].filter((id) => !graph.nodeById.has(id));
  const extraNodes = new Map<string, { code: string; title: string; source_locator: string; source: { source_url: string } | null }>();
  if (missingIds.length) {
    // Recommendations stay readable if an import later deactivated or
    // re-scoped their node.
    const response = await supabase
      .from("curriculum_nodes")
      .select("id,code,title,source_locator,source:curriculum_sources(source_url)")
      .in("id", missingIds);
    ensureOk(response.error, "Notions des recommandations");
    for (const row of (response.data ?? []) as unknown as Array<{ id: string; code: string; title: string; source_locator: string; source: { source_url: string } | null }>)
      extraNodes.set(row.id, row);
  }
  const nodeInfo = (id: string) => {
    const node = graph.nodeById.get(id);
    if (node)
      return { code: node.code, title: node.title, sourceLocator: node.sourceLocator, sourceUrl: graph.summaryByCode.get(node.code)?.sourceUrl ?? "" };
    const extra = extraNodes.get(id);
    return extra ? { code: extra.code, title: extra.title, sourceLocator: extra.source_locator, sourceUrl: extra.source?.source_url ?? "" } : null;
  };
  const titles = (codes: string[] | undefined) =>
    (codes ?? []).map((code) => graph.nodeByCode.get(code)?.title).filter((value): value is string => Boolean(value));
  const catalogue = await catalogueFor(supabase, [...new Set(recommendationRows.map((row) => row.curriculum_node_id))]);
  const assessmentById = new Map(context.assessments.map((assessment) => [assessment.id, assessment]));
  const questionById = new Map(questions.map((question) => [question.id, question]));

  const views: PedagogicalRecommendationView[] = recommendationRows.flatMap((row) => {
    const node = nodeInfo(row.curriculum_node_id);
    const assessment = assessmentById.get(row.assessment_id);
    if (!node || !assessment) return [];
    const summary = graph.summaryByCode.get(node.code);
    const evidence = (Array.isArray(row.evidence) ? row.evidence : []).flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const value = item as Record<string, unknown>;
      const questionId = typeof value.questionId === "string" ? value.questionId : "";
      const excerpt = typeof value.excerpt === "string" ? value.excerpt : "";
      const question = questionById.get(questionId);
      if (!excerpt) return [];
      return [{ questionId, questionLabel: question ? `Question ${question.position}` : "Question supprimée", excerpt }];
    });
    return [
      {
        id: row.id,
        assessmentId: assessment.id,
        assessmentTitle: assessment.title,
        assessmentDate: assessment.date,
        curriculumNodeCode: node.code,
        curriculumNodeTitle: node.title,
        difficulty: row.difficulty,
        evidence,
        confidence: row.confidence,
        explanation: row.explanation,
        recommendedAction: row.recommended_action,
        sourceLocator: node.sourceLocator,
        sourceUrl: node.sourceUrl,
        prerequisites: titles(summary?.prerequisites),
        competencies: titles(summary?.competencies),
        status: recommendationStatus(row),
        decidedAt: row.teacher_decided_at,
        teacherNote: row.teacher_note,
        createdAt: row.created_at,
        catalogue: catalogueSuggestions(catalogue, row.curriculum_node_id, row.catalogue_error_id),
      },
    ];
  });

  // Per assessment: evidence and current analysis state.
  const questionsByAssessment = new Map<string, QuestionRow[]>();
  for (const question of questions)
    questionsByAssessment.set(question.assessment_id, [...(questionsByAssessment.get(question.assessment_id) ?? []), question]);
  const answeredByAssessment = new Map<string, number>();
  for (const response of responses)
    if (response.response_text.trim())
      answeredByAssessment.set(response.assessment_id, (answeredByAssessment.get(response.assessment_id) ?? 0) + 1);
  const latestRun = new Map<string, RunRow>();
  for (const run of runs) if (!latestRun.has(run.assessment_id)) latestRun.set(run.assessment_id, run);
  const activeCountByRun = new Map<string, number>();
  for (const row of recommendationRows)
    if (!row.superseded_at) activeCountByRun.set(row.analysis_run_id, (activeCountByRun.get(row.analysis_run_id) ?? 0) + 1);

  const assessments: AssessmentAnalysisState[] = context.assessments
    .filter((assessment) => (questionsByAssessment.get(assessment.id) ?? []).length > 0)
    .map((assessment) => {
      const run = latestRun.get(assessment.id);
      const answered = answeredByAssessment.get(assessment.id) ?? 0;
      return {
        assessmentId: assessment.id,
        title: assessment.title,
        date: assessment.date,
        questionCount: (questionsByAssessment.get(assessment.id) ?? []).length,
        answeredCount: answered,
        status: runStatus(run, run ? activeCountByRun.get(run.id) ?? 0 : 0),
        reason: run?.failure_reason ?? null,
        analyzedAt: run?.created_at ?? null,
        needsAnalysis: answered > 0 && !run,
      };
    });

  // Notions over time: kept errors, and questions assessing a notion that a
  // current analysis did not find an error on ("no error observed" is never
  // shown as mastery).
  const timelines = new Map<string, NotionTimeline>();
  const push = (code: string, title: string, observation: NotionTimeline["observations"][number]) => {
    const timeline = timelines.get(code) ?? { code, title, observations: [] };
    if (!timeline.observations.some((item) => item.assessmentId === observation.assessmentId && item.kind === observation.kind))
      timeline.observations.push(observation);
    timelines.set(code, timeline);
  };
  for (const view of views) {
    if (view.status === "superseded") continue;
    push(view.curriculumNodeCode, view.curriculumNodeTitle, {
      assessmentId: view.assessmentId,
      assessmentTitle: view.assessmentTitle,
      assessmentDate: view.assessmentDate,
      kind: "error",
      teacherDecision: view.status === "validated" || view.status === "dismissed" ? view.status : null,
    });
  }
  const answeredQuestions = new Set(responses.filter((row) => row.response_text.trim()).map((row) => row.question_id));
  for (const tag of tags) {
    const question = questionById.get(tag.question_id);
    if (!question || !answeredQuestions.has(question.id)) continue;
    const run = latestRun.get(question.assessment_id);
    if (!run || run.status !== "completed") continue;
    const assessment = assessmentById.get(question.assessment_id)!;
    const hasError = views.some(
      (view) => view.status !== "superseded" && view.assessmentId === assessment.id && view.curriculumNodeCode === tag.code,
    );
    if (hasError) continue;
    const title = graph.nodeByCode.get(tag.code)?.title ?? tag.code;
    push(tag.code, title, {
      assessmentId: assessment.id,
      assessmentTitle: assessment.title,
      assessmentDate: assessment.date,
      kind: "no_error",
      teacherDecision: null,
    });
  }
  const notions = [...timelines.values()]
    .map((timeline) => ({
      ...timeline,
      observations: timeline.observations.sort((a, b) => a.assessmentDate.localeCompare(b.assessmentDate)),
    }))
    .sort((a, b) => a.title.localeCompare(b.title, "fr"));

  return {
    active: views.filter((view) => view.status === "pending" || view.status === "validated"),
    history: views.filter((view) => view.status === "dismissed" || view.status === "superseded").slice(0, 30),
    notions,
    assessments,
  };
}
