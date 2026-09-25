"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createAuthClient, requireTeacher } from "@/lib/auth/server";
import {
  confidenceForEvidence,
  validateModelAnalysis,
} from "@/lib/pedagogy/analysis";
import {
  analyzePedagogicalEvidence,
  pedagogicalAiConfigured,
  pedagogicalAiModel,
} from "@/lib/pedagogy/openai";
import { pickNextEvidenceSet } from "@/lib/pedagogy/queue";
import type {
  AssessmentEvidenceDraft,
  CurriculumNodeSummary,
  PedagogicalConfidence,
  PedagogicalRecommendationView,
  PedagogicalSnapshot,
} from "@/lib/pedagogy/types";

type SupabaseClient = NonNullable<Awaited<ReturnType<typeof createAuthClient>>>;

type AssignmentRow = {
  school_id: string;
  class_id: string;
  subject_id: string;
};
type SubjectRow = { id: string; name: string; code: string | null };
type EnrollmentRow = { school_id: string; class_id: string };
type AssessmentRow = {
  id: string;
  school_id: string;
  class_id: string;
  subject_id: string;
  teacher_id: string;
  title: string;
  date: string;
};
type MaterialRow = {
  assessment_id: string;
  context_text: string | null;
  instructions_text: string | null;
};
type QuestionRow = {
  id: string;
  assessment_id: string;
  position: number;
  prompt: string;
  correction_text: string;
  rubric: { text?: string } | null;
  max_points: number | string | null;
};
type ResponseRow = {
  id: string;
  assessment_id: string;
  question_id: string;
  student_id: string;
  response_text: string;
  awarded_points: number | string | null;
  teacher_annotation: string | null;
};
type CurriculumNodeRow = {
  id: string;
  source_id: string;
  code: string;
  node_type: "domain" | "notion" | "competency" | "prerequisite";
  title: string;
  description: string | null;
  source_locator: string;
};
type CurriculumEdgeRow = {
  from_node_id: string;
  to_node_id: string;
  relation: "prerequisite_of" | "supports" | "part_of";
};
type CurriculumSourceRow = {
  id: string;
  source_url: string;
};
type RecommendationRow = {
  id: string;
  assessment_id: string;
  curriculum_node_id: string;
  difficulty: string;
  evidence: unknown;
  confidence: PedagogicalConfidence;
  explanation: string;
  recommended_action: string;
  teacher_validated: boolean;
  created_at: string;
};
type PriorErrorRow = {
  curriculum_node_id: string;
  assessment_id: string;
  verified_by_teacher: boolean;
};
type AnalysisRunRow = {
  status: "completed" | "failed" | "no_evidence";
  failure_reason: string | null;
  created_at: string;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function ensureOk(error: { message: string } | null, label: string) {
  if (error) throw new Error(`${label}: ${error.message}`);
}

function isMathSubject(subject: SubjectRow) {
  return (
    subject.code?.toUpperCase().startsWith("MATH") === true ||
    subject.name.toLocaleLowerCase("fr").includes("math")
  );
}

async function teacherMathContext(
  supabase: SupabaseClient,
  teacherId: string,
  studentId: string,
) {
  if (!UUID_RE.test(studentId)) throw new Error("Élève invalide.");

  const assignmentsResponse = await supabase
    .from("teacher_assignments")
    .select("school_id,class_id,subject_id")
    .eq("teacher_id", teacherId);
  ensureOk(assignmentsResponse.error, "Affectations professeur");
  const assignments = (assignmentsResponse.data ?? []) as AssignmentRow[];
  if (!assignments.length)
    throw new Error("Aucune classe n’est affectée à ce compte professeur.");

  const classIds = [...new Set(assignments.map((row) => row.class_id))];
  const enrollmentResponse = await supabase
    .from("student_enrollments")
    .select("school_id,class_id")
    .eq("student_id", studentId)
    .in("class_id", classIds)
    .limit(1)
    .maybeSingle();
  ensureOk(enrollmentResponse.error, "Inscription élève");
  const enrollment = enrollmentResponse.data as EnrollmentRow | null;
  if (!enrollment)
    throw new Error("Cet élève n’appartient pas à une de vos classes.");

  const relevantAssignments = assignments.filter(
    (row) => row.class_id === enrollment.class_id,
  );
  const subjectIds = [
    ...new Set(relevantAssignments.map((row) => row.subject_id)),
  ];
  const subjectsResponse = await supabase
    .from("subjects")
    .select("id,name,code")
    .in("id", subjectIds);
  ensureOk(subjectsResponse.error, "Matières");
  const subjects = (subjectsResponse.data ?? []) as SubjectRow[];
  const mathSubject = subjects.find(isMathSubject);
  if (!mathSubject)
    throw new Error("La V1 de l’IA pédagogique est limitée aux mathématiques.");

  const assessmentsResponse = await supabase
    .from("assessments")
    .select("id,school_id,class_id,subject_id,teacher_id,title,date")
    .eq("class_id", enrollment.class_id)
    .eq("subject_id", mathSubject.id)
    .order("date", { ascending: false });
  ensureOk(assessmentsResponse.error, "Évaluations");
  const assessments = (assessmentsResponse.data ?? []) as AssessmentRow[];

  return {
    schoolId: enrollment.school_id,
    classId: enrollment.class_id,
    mathSubject,
    assessments,
  };
}

async function evidenceRows(
  supabase: SupabaseClient,
  assessmentIds: string[],
  studentId: string,
) {
  if (!assessmentIds.length)
    return {
      materials: [] as MaterialRow[],
      questions: [] as QuestionRow[],
      responses: [] as ResponseRow[],
    };

  const [materialsResponse, questionsResponse, responsesResponse] =
    await Promise.all([
      supabase
        .from("assessment_materials")
        .select("assessment_id,context_text,instructions_text")
        .in("assessment_id", assessmentIds),
      supabase
        .from("assessment_questions")
        .select(
          "id,assessment_id,position,prompt,correction_text,rubric,max_points",
        )
        .in("assessment_id", assessmentIds)
        .order("position", { ascending: true }),
      supabase
        .from("student_responses")
        .select(
          "id,assessment_id,question_id,student_id,response_text,awarded_points,teacher_annotation",
        )
        .eq("student_id", studentId)
        .in("assessment_id", assessmentIds),
    ]);
  ensureOk(materialsResponse.error, "Supports d’évaluation");
  ensureOk(questionsResponse.error, "Questions");
  ensureOk(responsesResponse.error, "Réponses élève");

  return {
    materials: (materialsResponse.data ?? []) as MaterialRow[],
    questions: (questionsResponse.data ?? []) as QuestionRow[],
    responses: (responsesResponse.data ?? []) as ResponseRow[],
  };
}

export async function loadAssessmentEvidence(
  assessmentId: string,
  studentId: string,
): Promise<AssessmentEvidenceDraft> {
  const teacher = await requireTeacher();
  const supabase = await createAuthClient();
  if (!supabase) throw new Error("Supabase n’est pas configuré.");

  const context = await teacherMathContext(supabase, teacher.id, studentId);
  const assessment = context.assessments.find((a) => a.id === assessmentId);
  if (!assessment) throw new Error("Évaluation inaccessible.");

  const { materials, questions, responses } = await evidenceRows(
    supabase,
    [assessmentId],
    studentId,
  );
  const material = materials.find((row) => row.assessment_id === assessmentId);
  const responseByQuestion = new Map(
    responses.map((row) => [row.question_id, row]),
  );

  return {
    assessmentId,
    studentId,
    contextText: material?.context_text ?? "",
    instructionsText: material?.instructions_text ?? "",
    questions: questions.map((question) => {
      const response = responseByQuestion.get(question.id);
      return {
        id: question.id,
        position: question.position,
        prompt: question.prompt,
        correctionText: question.correction_text,
        rubricText: question.rubric?.text ?? "",
        maxPoints:
          question.max_points === null ? "" : String(question.max_points),
        responseText: response?.response_text ?? "",
        awardedPoints:
          response?.awarded_points === null ||
          response?.awarded_points === undefined
            ? ""
            : String(response.awarded_points),
        teacherAnnotation: response?.teacher_annotation ?? "",
      };
    }),
  };
}

export async function saveAssessmentEvidence(
  input: AssessmentEvidenceDraft,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireTeacher();
  const supabase = await createAuthClient();
  if (!supabase)
    return { ok: false, error: "Supabase n’est pas configuré." };

  if (
    !UUID_RE.test(input.assessmentId) ||
    !UUID_RE.test(input.studentId) ||
    input.contextText.length > 12_000 ||
    input.instructionsText.length > 12_000 ||
    !Array.isArray(input.questions) ||
    input.questions.length > 30
  )
    return { ok: false, error: "Les données saisies sont invalides." };

  const positions = new Set<number>();
  for (const question of input.questions) {
    if (
      !UUID_RE.test(question.id) ||
      !Number.isInteger(question.position) ||
      question.position <= 0 ||
      positions.has(question.position) ||
      !question.prompt.trim() ||
      !question.correctionText.trim() ||
      question.prompt.length > 12_000 ||
      question.correctionText.length > 12_000 ||
      question.rubricText.length > 8_000 ||
      question.responseText.length > 20_000 ||
      question.teacherAnnotation.length > 5_000
    )
      return { ok: false, error: "Une question ou une réponse est invalide." };
    positions.add(question.position);
  }

  const { error } = await supabase.rpc("focus_save_pedagogical_evidence", {
    p_assessment_id: input.assessmentId,
    p_student_id: input.studentId,
    p_context_text: input.contextText,
    p_instructions_text: input.instructionsText,
    p_questions: input.questions.map((question) => ({
      id: question.id,
      position: question.position,
      prompt: question.prompt.trim(),
      correctionText: question.correctionText.trim(),
      rubricText: question.rubricText.trim(),
      maxPoints: question.maxPoints.trim(),
      responseText: question.responseText.trim(),
      awardedPoints: question.awardedPoints.trim(),
      teacherAnnotation: question.teacherAnnotation.trim(),
    })),
  });

  if (error) {
    console.error("FOCUS pedagogical evidence save failed", {
      code: error.code,
      message: error.message,
    });
    return {
      ok: false,
      error:
        error.code === "42501"
          ? "Vous n’avez pas les droits nécessaires pour modifier cette évaluation."
          : "Enregistrement impossible. Vérifiez les questions et les réponses.",
    };
  }

  revalidatePath(`/app/evaluations/${input.assessmentId}`);
  revalidatePath(`/app/eleves/${input.studentId}`);
  return { ok: true };
}

export async function reviewPedagogicalRecommendation(
  recommendationId: string,
  decision: "validate" | "dismiss",
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireTeacher();
  const supabase = await createAuthClient();
  if (!supabase)
    return { ok: false, error: "Supabase n’est pas configuré." };
  if (!UUID_RE.test(recommendationId) || !["validate", "dismiss"].includes(decision))
    return { ok: false, error: "Décision invalide." };

  const recommendationResponse = await supabase
    .from("pedagogical_recommendations")
    .select("student_id,assessment_id")
    .eq("id", recommendationId)
    .maybeSingle();
  if (recommendationResponse.error || !recommendationResponse.data)
    return { ok: false, error: "Recommandation introuvable ou inaccessible." };

  const { error } = await supabase.rpc(
    "focus_review_pedagogical_recommendation",
    {
      p_recommendation_id: recommendationId,
      p_decision: decision,
    },
  );
  if (error) {
    console.error("FOCUS recommendation review failed", {
      code: error.code,
      message: error.message,
    });
    return { ok: false, error: "La décision n’a pas pu être enregistrée." };
  }

  const row = recommendationResponse.data as {
    student_id: string;
    assessment_id: string;
  };
  revalidatePath(`/app/eleves/${row.student_id}`);
  revalidatePath(`/app/evaluations/${row.assessment_id}`);
  return { ok: true };
}

async function curriculumGraph(supabase: SupabaseClient) {
  const [nodesResponse, edgesResponse, sourcesResponse] = await Promise.all([
    supabase
      .from("curriculum_nodes")
      .select("id,source_id,code,node_type,title,description,source_locator")
      .like("code", "MATH.%")
      .eq("active", true),
    supabase
      .from("curriculum_edges")
      .select("from_node_id,to_node_id,relation"),
    supabase.from("curriculum_sources").select("id,source_url"),
  ]);
  ensureOk(nodesResponse.error, "Programme officiel");
  ensureOk(edgesResponse.error, "Graphe du programme");
  ensureOk(sourcesResponse.error, "Sources du programme");

  const nodes = (nodesResponse.data ?? []) as CurriculumNodeRow[];
  const edges = (edgesResponse.data ?? []) as CurriculumEdgeRow[];
  const sources = (sourcesResponse.data ?? []) as CurriculumSourceRow[];
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const sourceById = new Map(sources.map((source) => [source.id, source]));

  const summaries: CurriculumNodeSummary[] = nodes.map((node) => ({
    id: node.id,
    code: node.code,
    nodeType: node.node_type,
    title: node.title,
    description: node.description,
    sourceLocator: node.source_locator,
    sourceUrl: sourceById.get(node.source_id)?.source_url ?? "",
    prerequisites: edges
      .filter(
        (edge) =>
          edge.to_node_id === node.id && edge.relation === "prerequisite_of",
      )
      .map((edge) => nodeById.get(edge.from_node_id)?.code)
      .filter((value): value is string => Boolean(value)),
    competencies: edges
      .filter(
        (edge) => edge.from_node_id === node.id && edge.relation === "supports",
      )
      .map((edge) => nodeById.get(edge.to_node_id)?.code)
      .filter((value): value is string => Boolean(value)),
  }));

  return { summaries, nodes, edges, sourceById, nodeById };
}

export async function loadPedagogicalSnapshot(
  studentId: string,
): Promise<PedagogicalSnapshot> {
  const teacher = await requireTeacher();
  const supabase = await createAuthClient();
  if (!supabase) throw new Error("Supabase n’est pas configuré.");

  const context = await teacherMathContext(supabase, teacher.id, studentId);
  const assessmentIds = context.assessments.map((a) => a.id);
  const { materials, questions } = await evidenceRows(
    supabase,
    assessmentIds,
    studentId,
  );
  const materialIds = new Set(materials.map((row) => row.assessment_id));
  const questionIdsByAssessment = new Map<string, string[]>();
  for (const question of questions) {
    const ids = questionIdsByAssessment.get(question.assessment_id) ?? [];
    ids.push(question.id);
    questionIdsByAssessment.set(question.assessment_id, ids);
  }
  const analyzable = context.assessments.filter((assessment) => {
    const questionIds = questionIdsByAssessment.get(assessment.id) ?? [];
    return materialIds.has(assessment.id) && questionIds.length > 0;
  });

  const latestRunResponse = await supabase
    .from("ai_analysis_runs")
    .select("status,failure_reason,created_at")
    .eq("student_id", studentId)
    .is("superseded_at", null)
    .in(
      "assessment_id",
      assessmentIds.length
        ? assessmentIds
        : ["00000000-0000-0000-0000-000000000000"],
    )
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  ensureOk(latestRunResponse.error, "Dernière analyse pédagogique");
  const latestRun = latestRunResponse.data as AnalysisRunRow | null;

  const recommendationsResponse = await supabase
    .from("pedagogical_recommendations")
    .select(
      "id,assessment_id,curriculum_node_id,difficulty,evidence,confidence,explanation,recommended_action,teacher_validated,created_at",
    )
    .eq("student_id", studentId)
    .is("dismissed_at", null)
    .order("created_at", { ascending: false })
    .limit(12);
  ensureOk(recommendationsResponse.error, "Recommandations pédagogiques");
  const recRows = (recommendationsResponse.data ?? []) as RecommendationRow[];

  const graph = await curriculumGraph(supabase);
  const assessmentById = new Map(
    context.assessments.map((assessment) => [assessment.id, assessment]),
  );
  const questionById = new Map(questions.map((question) => [question.id, question]));

  const recommendations: PedagogicalRecommendationView[] = recRows.flatMap(
    (row) => {
      const node = graph.nodeById.get(row.curriculum_node_id);
      const assessment = assessmentById.get(row.assessment_id);
      if (!node || !assessment) return [];
      const summary = graph.summaries.find((item) => item.id === node.id);
      const evidenceRaw = Array.isArray(row.evidence) ? row.evidence : [];
      const evidence = evidenceRaw.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const value = item as Record<string, unknown>;
        const questionId =
          typeof value.questionId === "string" ? value.questionId : "";
        const excerpt = typeof value.excerpt === "string" ? value.excerpt : "";
        const question = questionById.get(questionId);
        if (!question || !excerpt) return [];
        return [
          {
            questionId,
            questionLabel: `Question ${question.position}`,
            excerpt,
          },
        ];
      });
      return [
        {
          id: row.id,
          assessmentId: assessment.id,
          assessmentTitle: assessment.title,
          curriculumNodeCode: node.code,
          curriculumNodeTitle: node.title,
          difficulty: row.difficulty,
          evidence,
          confidence: row.confidence,
          explanation: row.explanation,
          recommendedAction: row.recommended_action,
          sourceLocator: node.source_locator,
          sourceUrl: summary?.sourceUrl ?? "",
          prerequisites:
            summary?.prerequisites
              .map((code) => graph.nodes.find((n) => n.code === code)?.title)
              .filter((value): value is string => Boolean(value)) ?? [],
          competencies:
            summary?.competencies
              .map((code) => graph.nodes.find((n) => n.code === code)?.title)
              .filter((value): value is string => Boolean(value)) ?? [],
          teacherValidated: row.teacher_validated,
          createdAt: row.created_at,
        },
      ];
    },
  );

  return {
    recommendations,
    documentedAssessmentCount: materialIds.size,
    analyzableAssessmentCount: analyzable.length,
    latestAnalyzableAssessmentTitle: analyzable[0]?.title ?? null,
    latestAnalysisStatus:
      latestRun?.status === "no_evidence"
        ? "insufficient_evidence"
        : latestRun?.status === "completed"
          ? recommendations.length > 0
            ? "errors_found"
            : "no_error_observed"
          : null,
    latestAnalysisReason: latestRun?.failure_reason ?? null,
    latestAnalysisAt: latestRun?.created_at ?? null,
    aiConfigured: pedagogicalAiConfigured(),
  };
}

async function persistNoEvidenceOutcome(params: {
  supabase: SupabaseClient;
  schoolId: string;
  studentId: string;
  assessmentId: string;
  model: string;
  inputHash: string;
  reason: string;
}) {
  const { error } = await params.supabase.rpc("focus_persist_no_evidence", {
    p_school_id: params.schoolId,
    p_student_id: params.studentId,
    p_assessment_id: params.assessmentId,
    p_model: params.model,
    p_input_hash: params.inputHash,
    p_reason: params.reason,
  });
  ensureOk(error, "Trace d’analyse insuffisante");
}

export async function generatePedagogicalAnalysis(
  studentId: string,
): Promise<
  | {
      ok: true;
      recommendationCount: number;
      reused: boolean;
      analysisStatus: "errors_found" | "no_error_observed" | "insufficient_evidence";
      insufficientReason: string;
    }
  | { ok: false; error: string }
> {
  const teacher = await requireTeacher();
  const supabase = await createAuthClient();
  if (!supabase)
    return { ok: false, error: "Supabase n’est pas configuré." };

  let context: Awaited<ReturnType<typeof teacherMathContext>>;
  try {
    context = await teacherMathContext(supabase, teacher.id, studentId);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Analyse impossible.",
    };
  }

  const assessmentIds = context.assessments.map((a) => a.id);
  const { materials, questions, responses } = await evidenceRows(
    supabase,
    assessmentIds,
    studentId,
  );
  const materialByAssessment = new Map(
    materials.map((material) => [material.assessment_id, material]),
  );
  const questionsByAssessment = new Map<string, QuestionRow[]>();
  for (const question of questions) {
    const list = questionsByAssessment.get(question.assessment_id) ?? [];
    list.push(question);
    questionsByAssessment.set(question.assessment_id, list);
  }
  const responsesByQuestion = new Map(
    responses.map((response) => [response.question_id, response]),
  );

  const graph = await curriculumGraph(supabase);
  const model = pedagogicalAiModel();

  type Prepared = {
    assessment: AssessmentRow;
    assessmentQuestions: QuestionRow[];
    aiInput: {
      assessment: {
        id: string;
        title: string;
        contextText: string | null;
        instructionsText: string | null;
      };
      questions: Array<{
        assessmentId: string;
        questionId: string;
        prompt: string;
        correctionText: string;
        rubricText: string;
        maxPoints: number | null;
        responseText: string;
        awardedPoints: number | null;
        teacherAnnotation: string | null;
      }>;
      curriculum: CurriculumNodeSummary[];
    };
    inputHash: string;
    existing: {
      id: string;
      status: "completed" | "no_evidence";
      failure_reason: string | null;
    } | null;
  };

  const prepared: Prepared[] = [];
  for (const assessment of context.assessments) {
    const material = materialByAssessment.get(assessment.id);
    const assessmentQuestions = (questionsByAssessment.get(assessment.id) ?? [])
      .sort((a, b) => a.position - b.position);

    if (!material || !assessmentQuestions.length) continue;

    const aiInput = {
      assessment: {
        id: assessment.id,
        title: assessment.title,
        contextText: material.context_text,
        instructionsText: material.instructions_text,
      },
      questions: assessmentQuestions.map((question) => {
        const response = responsesByQuestion.get(question.id);
        return {
          assessmentId: assessment.id,
          questionId: question.id,
          prompt: question.prompt,
          correctionText: question.correction_text,
          rubricText: question.rubric?.text ?? "",
          maxPoints:
            question.max_points === null ? null : Number(question.max_points),
          responseText: response?.response_text ?? "",
          awardedPoints:
            response?.awarded_points === null ||
            response?.awarded_points === undefined
              ? null
              : Number(response.awarded_points),
          teacherAnnotation: response?.teacher_annotation ?? null,
        };
      }),
      curriculum: graph.summaries,
    };

    const inputHash = createHash("sha256")
      .update(JSON.stringify({ model, aiInput }))
      .digest("hex");

    const existingResponse = await supabase
      .from("ai_analysis_runs")
      .select("id,status,failure_reason")
      .eq("teacher_id", teacher.id)
      .eq("student_id", studentId)
      .eq("assessment_id", assessment.id)
      .eq("input_hash", inputHash)
      .in("status", ["completed", "no_evidence"])
      .is("superseded_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    ensureOk(existingResponse.error, "Historique d’analyse");

    prepared.push({
      assessment,
      assessmentQuestions,
      aiInput,
      inputHash,
      existing: existingResponse.data as Prepared["existing"],
    });
  }

  if (!prepared.length)
    return {
      ok: false,
      error:
        "Ajoutez d’abord le sujet, le corrigé/barème et au moins une réponse de l’élève.",
    };

  // Prefer the newest evidence set that has not yet been analyzed with the
  // current model. Once it is done, the next click can process older evidence
  // and build longitudinal confidence instead of looping on the latest run.
  const target = pickNextEvidenceSet(prepared);
  if (!target)
    return {
      ok: false,
      error: "Aucune évaluation ne contient de preuves exploitables.",
    };
  const {
    assessment,
    assessmentQuestions,
    aiInput,
    inputHash,
    existing,
  } = target;

  if (existing) {
    if (existing.status === "completed") {
      const reactivateResponse = await supabase
        .from("pedagogical_recommendations")
        .update({ dismissed_at: null })
        .eq("analysis_run_id", existing.id);
      ensureOk(
        reactivateResponse.error,
        "Réactivation des recommandations correspondant aux preuves",
      );
    }

    const countResponse = await supabase
      .from("pedagogical_recommendations")
      .select("id", { count: "exact", head: true })
      .eq("analysis_run_id", existing.id)
      .is("dismissed_at", null);
    ensureOk(countResponse.error, "Recommandations réutilisées");

    return {
      ok: true,
      recommendationCount: countResponse.count ?? 0,
      reused: true,
      analysisStatus:
        existing.status === "no_evidence"
          ? "insufficient_evidence"
          : (countResponse.count ?? 0) > 0
            ? "errors_found"
            : "no_error_observed",
      insufficientReason: existing.failure_reason ?? "",
    };
  }

  const hasStudentAnswer = aiInput.questions.some(
    (question) => question.responseText.trim().length > 0,
  );
  if (!hasStudentAnswer) {
    const reason =
      "Aucune réponse exploitable de l’élève n’est enregistrée pour cette évaluation.";
    await persistNoEvidenceOutcome({
      supabase,
      schoolId: context.schoolId,
      studentId,
      assessmentId: assessment.id,
      model,
      inputHash,
      reason,
    });

    revalidatePath(`/app/eleves/${studentId}`);
    return {
      ok: true,
      recommendationCount: 0,
      reused: false,
      analysisStatus: "insufficient_evidence",
      insufficientReason: reason,
    };
  }

  let modelResult: Awaited<ReturnType<typeof analyzePedagogicalEvidence>>;
  try {
    modelResult = await analyzePedagogicalEvidence(aiInput);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "OPENAI_API_KEY_MISSING")
      return {
        ok: false,
        error:
          "L’IA n’est pas encore configurée : ajoutez OPENAI_API_KEY à l’environnement serveur.",
      };
    console.error("FOCUS pedagogical AI request failed", error);
    return {
      ok: false,
      error: "L’analyse IA a échoué. Aucune recommandation n’a été enregistrée.",
    };
  }

  const nodesByCode = new Map(
    graph.nodes
      .filter((node) => node.node_type === "notion")
      .map((node) => [node.code, node.id]),
  );
  const validationQuestions = assessmentQuestions.map((question) => ({
    assessmentId: assessment.id,
    questionId: question.id,
    responseText: responsesByQuestion.get(question.id)?.response_text ?? "",
  }));
  const validatedAnalysis = validateModelAnalysis(
    modelResult.analysis,
    validationQuestions,
    nodesByCode,
  );

  if (validatedAnalysis.status === "insufficient_evidence") {
    await persistNoEvidenceOutcome({
      supabase,
      schoolId: context.schoolId,
      studentId,
      assessmentId: assessment.id,
      model: modelResult.model,
      inputHash,
      reason: validatedAnalysis.insufficientReason,
    });

    revalidatePath(`/app/eleves/${studentId}`);
    return {
      ok: true,
      recommendationCount: 0,
      reused: false,
      analysisStatus: "insufficient_evidence",
      insufficientReason: validatedAnalysis.insufficientReason,
    };
  }

  const validated = validatedAnalysis.errors;
  const nodeIds = [...new Set(validated.map((error) => error.nodeId))];
  let priorErrors: PriorErrorRow[] = [];

  if (nodeIds.length) {
    const priorRunsResponse = await supabase
      .from("ai_analysis_runs")
      .select("id,assessment_id,created_at")
      .eq("student_id", studentId)
      .eq("status", "completed")
      .is("superseded_at", null)
      .neq("assessment_id", assessment.id)
      .order("created_at", { ascending: false });
    ensureOk(priorRunsResponse.error, "Historique des analyses");

    const latestRunByAssessment = new Map<string, string>();
    for (const run of (priorRunsResponse.data ?? []) as Array<{
      id: string;
      assessment_id: string;
      created_at: string;
    }>) {
      if (!latestRunByAssessment.has(run.assessment_id))
        latestRunByAssessment.set(run.assessment_id, run.id);
    }
    const activeRunIds = [...latestRunByAssessment.values()];

    if (activeRunIds.length) {
      const priorResponse = await supabase
        .from("error_observations")
        .select("curriculum_node_id,assessment_id,verified_by_teacher")
        .eq("student_id", studentId)
        .in("analysis_run_id", activeRunIds)
        .in("curriculum_node_id", nodeIds);
      ensureOk(priorResponse.error, "Historique des erreurs");
      priorErrors = (priorResponse.data ?? []) as PriorErrorRow[];
    }
  }

  const occurrencesByNode = new Map<string, number>();
  for (const error of validated)
    occurrencesByNode.set(
      error.nodeId,
      (occurrencesByNode.get(error.nodeId) ?? 0) + 1,
    );

  const confidenceByNode = new Map<string, PedagogicalConfidence>();
  for (const nodeId of nodeIds) {
    const priors = priorErrors.filter(
      (row) => row.curriculum_node_id === nodeId,
    );
    confidenceByNode.set(
      nodeId,
      confidenceForEvidence({
        currentOccurrences: occurrencesByNode.get(nodeId) ?? 0,
        priorAssessmentCount: new Set(priors.map((row) => row.assessment_id))
          .size,
        teacherVerifiedBefore: priors.some((row) => row.verified_by_teacher),
      }),
    );
  }

  const responseByQuestion = new Map(
    responses.map((response) => [response.question_id, response]),
  );
  const persistedErrors = validated.map((error) => ({
    questionId: error.questionId,
    responseId: (() => {
      const response = responseByQuestion.get(error.questionId);
      if (!response)
        throw new Error("Validated error has no persisted student response.");
      return response.id;
    })(),
    nodeId: error.nodeId,
    errorType: error.errorType,
    evidenceExcerpt: error.evidenceExcerpt,
    explanation: error.explanation,
    confidence: confidenceByNode.get(error.nodeId) ?? "limitee",
  }));

  const grouped = new Map<string, typeof validated>();
  for (const error of validated) {
    const list = grouped.get(error.nodeId) ?? [];
    list.push(error);
    grouped.set(error.nodeId, list);
  }
  const recommendations = [...grouped.entries()].map(([nodeId, errors]) => ({
    nodeId,
    difficulty: errors[0].difficulty,
    evidence: errors.map((error) => ({
      questionId: error.questionId,
      excerpt: error.evidenceExcerpt,
    })),
    confidence: confidenceByNode.get(nodeId) ?? "limitee",
    explanation: errors[0].explanation,
    recommendedAction: errors[0].recommendedAction,
  }));

  const persistResponse = await supabase.rpc(
    "focus_persist_pedagogical_analysis",
    {
      p_school_id: context.schoolId,
      p_student_id: studentId,
      p_assessment_id: assessment.id,
      p_model: modelResult.model,
      p_input_hash: inputHash,
      p_errors: persistedErrors,
      p_recommendations: recommendations,
    },
  );
  if (persistResponse.error) {
    console.error("FOCUS pedagogical analysis persistence failed", {
      code: persistResponse.error.code,
      message: persistResponse.error.message,
    });
    return {
      ok: false,
      error:
        "L’analyse a été produite mais n’a pas pu être enregistrée de façon sûre.",
    };
  }

  revalidatePath(`/app/eleves/${studentId}`);
  revalidatePath(`/app/evaluations/${assessment.id}`);
  return {
    ok: true,
    recommendationCount: recommendations.length,
    reused: false,
    analysisStatus:
      recommendations.length > 0 ? "errors_found" : "no_error_observed",
    insufficientReason: "",
  };
}
