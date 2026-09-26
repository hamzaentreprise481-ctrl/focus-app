"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createAuthClient, requireTeacher } from "@/lib/auth/server";
import { toAiCurriculum } from "@/lib/curriculum/graph";
import { validateModelAnalysis } from "@/lib/pedagogy/analysis";
import {
  analyzePedagogicalEvidence,
  pedagogicalAiConfigured,
  pedagogicalAiModel,
} from "@/lib/pedagogy/openai";
import { buildAnalysisPersistence } from "@/lib/pedagogy/pipeline";
import { pickNextEvidenceSet } from "@/lib/pedagogy/queue";
import {
  AccessError,
  assessmentAccess,
  currentRuns,
  curriculumGraph,
  ensureOk,
  evidenceRows,
  notionOptions,
  relatedCodesFor,
  runStatus,
  studentMathContext,
  studentPedagogy,
  toNumber,
  UUID_RE,
  type SupabaseClient,
} from "@/lib/pedagogy/server";
import type {
  AssessmentDefinitionDraft,
  AssessmentDefinitionView,
  PedagogicalSnapshot,
  ResponseOverviewRow,
  StudentEvidenceView,
  StudentResponseDraft,
} from "@/lib/pedagogy/types";

type Failure = { ok: false; error: string };

const GENERIC_ERROR = "L’opération n’a pas pu aboutir. Réessayez ; si le problème persiste, rechargez la page.";

function failure(error: unknown, fallback = GENERIC_ERROR): Failure {
  if (error instanceof AccessError) return { ok: false, error: error.message };
  console.error("FOCUS pedagogy action failed", error instanceof Error ? error.message : error);
  return { ok: false, error: fallback };
}

async function session() {
  const teacher = await requireTeacher();
  const supabase = await createAuthClient();
  if (!supabase) throw new AccessError("Le service de données n’est pas configuré.");
  return { teacher, supabase };
}

// ---------------------------------------------------------------------------
// Assessment definition: subject, questions, correction, rubric, notions
// ---------------------------------------------------------------------------

export async function loadAssessmentDefinition(
  assessmentId: string,
): Promise<{ ok: true; definition: AssessmentDefinitionView } | Failure> {
  try {
    const { teacher, supabase } = await session();
    const access = await assessmentAccess(supabase, teacher.id, assessmentId);
    const { materials, questions, responses, tags } = await evidenceRows(supabase, [assessmentId]);
    const graph = await curriculumGraph(supabase, access.classLevel);
    const answersByQuestion: Record<string, number> = {};
    for (const response of responses)
      if (response.response_text.trim() || response.awarded_points !== null)
        answersByQuestion[response.question_id] = (answersByQuestion[response.question_id] ?? 0) + 1;
    return {
      ok: true,
      definition: {
        assessmentId,
        editable: access.editable,
        contextText: materials[0]?.context_text ?? "",
        instructionsText: materials[0]?.instructions_text ?? "",
        questions: questions.map((question) => ({
          id: question.id,
          prompt: question.prompt,
          correctionText: question.correction_text,
          rubricText: question.rubric?.text ?? "",
          maxPoints: question.max_points === null ? "" : String(Number(question.max_points)),
          nodeCodes: tags.filter((tag) => tag.question_id === question.id).map((tag) => tag.code).sort(),
        })),
        notions: access.isMath ? notionOptions(graph) : [],
        answersByQuestion,
      },
    };
  } catch (error) {
    return failure(error, "Impossible de charger le sujet et le corrigé.");
  }
}

function invalidDefinition(input: AssessmentDefinitionDraft): string | null {
  if (!input || !UUID_RE.test(input.assessmentId)) return "Évaluation invalide.";
  if ((input.contextText ?? "").length > 12_000 || (input.instructionsText ?? "").length > 12_000)
    return "Le sujet ou les consignes dépassent 12 000 caractères.";
  if (!Array.isArray(input.questions) || input.questions.length > 40) return "40 questions au maximum.";
  const ids = new Set<string>();
  for (const [index, question] of input.questions.entries()) {
    const label = `Question ${index + 1}`;
    if (!question || !UUID_RE.test(question.id) || ids.has(question.id)) return `${label} : identifiant invalide.`;
    ids.add(question.id);
    if (!question.prompt?.trim()) return `${label} : l’énoncé est obligatoire.`;
    if (!question.correctionText?.trim()) return `${label} : le corrigé attendu est obligatoire.`;
    if (question.prompt.length > 12_000 || question.correctionText.length > 12_000) return `${label} : texte trop long.`;
    if ((question.rubricText ?? "").length > 8_000) return `${label} : barème trop long.`;
    const max = question.maxPoints?.trim().replace(",", ".");
    if (max && !(/^\d+(\.\d{1,2})?$/.test(max) && Number(max) > 0 && Number(max) <= 1000))
      return `${label} : les points maximum doivent être un nombre positif (1000 au plus).`;
    if (!Array.isArray(question.nodeCodes) || question.nodeCodes.length > 6 || question.nodeCodes.some((code) => typeof code !== "string"))
      return `${label} : 6 notions au plus.`;
  }
  return null;
}

export async function saveAssessmentDefinition(
  input: AssessmentDefinitionDraft,
  options: { confirmResponseDeletion?: boolean } = {},
): Promise<
  | { ok: true; changed: boolean; supersededAnalyses: number; deletedAnswers: number }
  | (Failure & { needsConfirmation?: number })
> {
  const invalid = invalidDefinition(input);
  if (invalid) return { ok: false, error: invalid };
  try {
    const { supabase } = await session();
    const { data, error } = await supabase.rpc("focus_save_assessment_questions", {
      p_assessment_id: input.assessmentId,
      p_context_text: input.contextText ?? "",
      p_instructions_text: input.instructionsText ?? "",
      p_questions: input.questions.map((question) => ({
        id: question.id,
        prompt: question.prompt.trim(),
        correctionText: question.correctionText.trim(),
        rubricText: (question.rubricText ?? "").trim(),
        maxPoints: question.maxPoints?.trim().replace(",", ".") ?? "",
        nodeCodes: question.nodeCodes,
      })),
      p_confirm_response_deletion: options.confirmResponseDeletion === true,
    });
    if (error) {
      const deleted = error.message.match(/deletes (\d+) student answers/);
      if (error.code === "55000" && deleted)
        return {
          ok: false,
          needsConfirmation: Number(deleted[1]),
          error: `Supprimer ces questions effacera ${deleted[1]} réponse(s) d’élèves déjà saisie(s).`,
        };
      console.error("FOCUS assessment definition save failed", { code: error.code, message: error.message });
      return {
        ok: false,
        error:
          error.code === "42501"
            ? "Vous n’avez pas les droits nécessaires pour modifier cette évaluation."
            : error.code === "23514"
              ? "Des points déjà attribués dépassent le nouveau maximum d’une question. Ajustez d’abord les points des élèves."
              : "Enregistrement impossible. Vérifiez les questions et réessayez.",
      };
    }
    const result = data as { changed: boolean; supersededAnalyses: number; deletedAnswers: number };
    revalidatePath(`/app/evaluations/${input.assessmentId}`);
    return { ok: true, ...result };
  } catch (error) {
    return failure(error);
  }
}

// ---------------------------------------------------------------------------
// One student's evidence
// ---------------------------------------------------------------------------

async function analysisStateFor(supabase: SupabaseClient, assessmentId: string, studentId: string, questionCount: number, answered: number) {
  const runs = await currentRuns(supabase, [assessmentId], studentId);
  const run = runs[0];
  let active = 0;
  if (run?.status === "completed") {
    const count = await supabase
      .from("pedagogical_recommendations")
      .select("id", { count: "exact", head: true })
      .eq("analysis_run_id", run.id)
      .is("superseded_at", null);
    ensureOk(count.error, "Recommandations");
    active = count.count ?? 0;
  }
  return { run, status: runStatus(run, active), questionCount, answered };
}

export async function loadStudentEvidence(
  assessmentId: string,
  studentId: string,
): Promise<{ ok: true; evidence: StudentEvidenceView } | Failure> {
  try {
    const { teacher, supabase } = await session();
    if (!UUID_RE.test(studentId)) throw new AccessError("Élève invalide.");
    const access = await assessmentAccess(supabase, teacher.id, assessmentId);
    const enrolled = await supabase
      .from("student_enrollments")
      .select("student_id")
      .eq("student_id", studentId)
      .eq("class_id", access.assessment.class_id)
      .limit(1);
    ensureOk(enrolled.error, "Inscription élève");
    if (!(enrolled.data ?? []).length) throw new AccessError("Cet élève n’est pas inscrit dans la classe de l’évaluation.");
    const { questions, responses } = await evidenceRows(supabase, [assessmentId], studentId);
    const byQuestion = new Map(responses.map((row) => [row.question_id, row]));
    const answered = responses.filter((row) => row.response_text.trim()).length;
    const state = await analysisStateFor(supabase, assessmentId, studentId, questions.length, answered);
    return {
      ok: true,
      evidence: {
        assessmentId,
        studentId,
        editable: access.editable,
        questions: questions.map((question) => ({
          id: question.id,
          position: question.position,
          prompt: question.prompt,
          correctionText: question.correction_text,
          maxPoints: toNumber(question.max_points),
        })),
        responses: questions.map((question) => {
          const row = byQuestion.get(question.id);
          return {
            questionId: question.id,
            responseText: row?.response_text ?? "",
            awardedPoints: row?.awarded_points === null || row?.awarded_points === undefined ? "" : String(Number(row.awarded_points)),
            teacherAnnotation: row?.teacher_annotation ?? "",
          };
        }),
        analysis: {
          assessmentId,
          title: access.assessment.title,
          date: access.assessment.date,
          questionCount: questions.length,
          answeredCount: answered,
          status: state.status,
          reason: state.run?.failure_reason ?? null,
          analyzedAt: state.run?.created_at ?? null,
          needsAnalysis: answered > 0 && !state.run,
        },
      },
    };
  } catch (error) {
    return failure(error, "Impossible de charger la copie de cet élève.");
  }
}

export async function saveStudentEvidence(
  assessmentId: string,
  studentId: string,
  responses: StudentResponseDraft[],
): Promise<{ ok: true; changed: boolean; supersededAnalyses: number } | Failure> {
  if (!UUID_RE.test(assessmentId) || !UUID_RE.test(studentId) || !Array.isArray(responses) || responses.length > 40)
    return { ok: false, error: "Les données saisies sont invalides." };
  for (const [index, response] of responses.entries()) {
    const label = `Question ${index + 1}`;
    if (!response || !UUID_RE.test(response.questionId)) return { ok: false, error: `${label} : question invalide.` };
    if ((response.responseText ?? "").length > 20_000) return { ok: false, error: `${label} : réponse trop longue (20 000 caractères au plus).` };
    if ((response.teacherAnnotation ?? "").length > 5_000) return { ok: false, error: `${label} : annotation trop longue (5 000 caractères au plus).` };
    const points = (response.awardedPoints ?? "").trim().replace(",", ".");
    if (points && !/^\d+(\.\d{1,2})?$/.test(points)) return { ok: false, error: `${label} : points invalides.` };
  }
  try {
    const { supabase } = await session();
    const { data, error } = await supabase.rpc("focus_save_student_responses", {
      p_assessment_id: assessmentId,
      p_student_id: studentId,
      p_responses: responses.map((response) => ({
        questionId: response.questionId,
        responseText: (response.responseText ?? "").trim(),
        awardedPoints: (response.awardedPoints ?? "").trim().replace(",", "."),
        teacherAnnotation: (response.teacherAnnotation ?? "").trim(),
      })),
    });
    if (error) {
      console.error("FOCUS student evidence save failed", { code: error.code, message: error.message });
      return {
        ok: false,
        error:
          error.code === "42501"
            ? "Vous n’avez pas les droits nécessaires pour modifier cette copie."
            : /points/.test(error.message)
              ? "Des points dépassent le maximum de la question."
              : "Enregistrement impossible. Vérifiez les réponses et réessayez.",
      };
    }
    revalidatePath(`/app/evaluations/${assessmentId}`);
    revalidatePath(`/app/eleves/${studentId}`);
    return { ok: true, ...(data as { changed: boolean; supersededAnalyses: number }) };
  } catch (error) {
    return failure(error);
  }
}

export async function loadResponseOverview(
  assessmentId: string,
): Promise<{ ok: true; rows: ResponseOverviewRow[]; questionCount: number } | Failure> {
  try {
    const { teacher, supabase } = await session();
    await assessmentAccess(supabase, teacher.id, assessmentId);
    const [{ questions, responses }, runs, pending] = await Promise.all([
      evidenceRows(supabase, [assessmentId]),
      currentRuns(supabase, [assessmentId]),
      supabase
        .from("pedagogical_recommendations")
        .select("student_id,analysis_run_id")
        .eq("assessment_id", assessmentId)
        .is("superseded_at", null)
        .is("teacher_decision", null),
    ]);
    ensureOk(pending.error, "Recommandations");
    const allActive = await supabase
      .from("pedagogical_recommendations")
      .select("analysis_run_id")
      .eq("assessment_id", assessmentId)
      .is("superseded_at", null);
    ensureOk(allActive.error, "Recommandations");
    const activeByRun = new Map<string, number>();
    for (const row of (allActive.data ?? []) as Array<{ analysis_run_id: string }>)
      activeByRun.set(row.analysis_run_id, (activeByRun.get(row.analysis_run_id) ?? 0) + 1);
    const students = new Map<string, ResponseOverviewRow>();
    const row = (studentId: string) => {
      const existing = students.get(studentId) ?? { studentId, answeredCount: 0, analysisStatus: null, needsAnalysis: false, pendingRecommendations: 0 };
      students.set(studentId, existing);
      return existing;
    };
    for (const response of responses) if (response.response_text.trim()) row(response.student_id).answeredCount++;
    const seenRun = new Set<string>();
    for (const run of runs) {
      if (seenRun.has(run.student_id)) continue;
      seenRun.add(run.student_id);
      row(run.student_id).analysisStatus = runStatus(run, activeByRun.get(run.id) ?? 0);
    }
    for (const item of (pending.data ?? []) as Array<{ student_id: string }>) row(item.student_id).pendingRecommendations++;
    for (const value of students.values()) value.needsAnalysis = value.answeredCount > 0 && !seenRun.has(value.studentId);
    return { ok: true, rows: [...students.values()], questionCount: questions.length };
  } catch (error) {
    return failure(error, "Impossible de charger l’état des copies.");
  }
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

export async function loadPedagogicalSnapshot(
  studentId: string,
): Promise<{ ok: true; snapshot: PedagogicalSnapshot } | Failure> {
  try {
    const { teacher, supabase } = await session();
    const context = await studentMathContext(supabase, teacher.id, studentId);
    const pedagogy = await studentPedagogy(supabase, context, studentId);
    return { ok: true, snapshot: { ...pedagogy, aiConfigured: pedagogicalAiConfigured() } };
  } catch (error) {
    return failure(error, "Impossible de charger le suivi pédagogique de cet élève.");
  }
}

type AnalysisOutcome =
  | {
      ok: true;
      assessmentId: string;
      assessmentTitle: string;
      recommendationCount: number;
      reused: boolean;
      analysisStatus: "errors_found" | "no_error_observed" | "insufficient_evidence";
      insufficientReason: string;
      rejectedCandidates: number;
    }
  | Failure;

export async function generatePedagogicalAnalysis(studentId: string, assessmentId?: string): Promise<AnalysisOutcome> {
  let teacherId: string;
  let supabase: SupabaseClient;
  let context: Awaited<ReturnType<typeof studentMathContext>>;
  try {
    const current = await session();
    teacherId = current.teacher.id;
    supabase = current.supabase;
    context = await studentMathContext(supabase, teacherId, studentId);
  } catch (error) {
    return failure(error, "Analyse impossible.");
  }
  if (assessmentId !== undefined && !context.assessments.some((assessment) => assessment.id === assessmentId))
    return { ok: false, error: "Cette évaluation n’est pas une évaluation de mathématiques de la classe de l’élève." };

  try {
    const candidates = assessmentId ? context.assessments.filter((assessment) => assessment.id === assessmentId) : context.assessments;
    const { materials, questions, responses, tags } = await evidenceRows(supabase, candidates.map((a) => a.id), studentId);
    const graph = await curriculumGraph(supabase, context.classLevel);
    const aiCurriculum = toAiCurriculum(graph.summaries);
    const model = pedagogicalAiModel();
    const materialByAssessment = new Map(materials.map((material) => [material.assessment_id, material]));
    const responsesByQuestion = new Map(responses.map((response) => [response.question_id, response]));
    const tagsByQuestion = new Map<string, string[]>();
    for (const tag of tags) tagsByQuestion.set(tag.question_id, [...(tagsByQuestion.get(tag.question_id) ?? []), tag.code].sort());
    const runs = await currentRuns(supabase, candidates.map((a) => a.id), studentId);

    const prepared = candidates.flatMap((assessment) => {
      const assessmentQuestions = questions
        .filter((question) => question.assessment_id === assessment.id)
        .sort((a, b) => a.position - b.position);
      if (!assessmentQuestions.length) return [];
      const material = materialByAssessment.get(assessment.id);
      const aiInput = {
        assessment: {
          id: assessment.id,
          title: assessment.title,
          contextText: material?.context_text ?? null,
          instructionsText: material?.instructions_text ?? null,
        },
        questions: assessmentQuestions.map((question) => {
          const response = responsesByQuestion.get(question.id);
          return {
            assessmentId: assessment.id,
            questionId: question.id,
            prompt: question.prompt,
            correctionText: question.correction_text,
            rubricText: question.rubric?.text ?? "",
            maxPoints: toNumber(question.max_points),
            responseText: response?.response_text ?? "",
            awardedPoints: toNumber(response?.awarded_points),
            teacherAnnotation: response?.teacher_annotation ?? null,
            assessedNotions: tagsByQuestion.get(question.id) ?? [],
          };
        }),
        curriculum: aiCurriculum,
      };
      const inputHash = createHash("sha256").update(JSON.stringify({ model, aiInput })).digest("hex");
      const run = runs.find((item) => item.assessment_id === assessment.id);
      const existing = run && run.status !== "failed" ? { run, sameInput: false } : null;
      return [{ assessment, aiInput, inputHash, existing }];
    });

    if (!prepared.length)
      return { ok: false, error: "Ajoutez d’abord le sujet, le corrigé et au moins une réponse de l’élève à une évaluation." };

    // Newest evidence set without a current analysis first; once all are
    // analysed, re-running reuses the current result.
    const target = pickNextEvidenceSet(prepared);
    if (!target) return { ok: false, error: "Aucune évaluation ne contient de preuves exploitables." };
    const { assessment, aiInput, inputHash } = target;

    const existing = await supabase
      .from("ai_analysis_runs")
      .select("id,status,failure_reason")
      .eq("teacher_id", teacherId)
      .eq("student_id", studentId)
      .eq("assessment_id", assessment.id)
      .eq("input_hash", inputHash)
      .in("status", ["completed", "no_evidence"])
      .is("superseded_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    ensureOk(existing.error, "Historique d’analyse");
    if (existing.data) {
      // Same evidence, same model: the current result stands, including the
      // teacher's decisions on it (a dismissed recommendation stays dismissed).
      const run = existing.data as { id: string; status: "completed" | "no_evidence"; failure_reason: string | null };
      const count = await supabase
        .from("pedagogical_recommendations")
        .select("id", { count: "exact", head: true })
        .eq("analysis_run_id", run.id)
        .is("superseded_at", null);
      ensureOk(count.error, "Recommandations réutilisées");
      return {
        ok: true,
        assessmentId: assessment.id,
        assessmentTitle: assessment.title,
        recommendationCount: count.count ?? 0,
        reused: true,
        analysisStatus: run.status === "no_evidence" ? "insufficient_evidence" : (count.count ?? 0) > 0 ? "errors_found" : "no_error_observed",
        insufficientReason: run.failure_reason ?? "",
        rejectedCandidates: 0,
      };
    }

    const persistNoEvidence = async (reason: string, usedModel: string) => {
      const { error } = await supabase.rpc("focus_persist_no_evidence", {
        p_school_id: context.schoolId,
        p_student_id: studentId,
        p_assessment_id: assessment.id,
        p_model: usedModel,
        p_input_hash: inputHash,
        p_reason: reason,
      });
      ensureOk(error, "Trace d’analyse insuffisante");
    };

    if (!aiInput.questions.some((question) => question.responseText.trim())) {
      // No answer: the model is not called at all.
      const reason = "Aucune réponse exploitable de l’élève n’est enregistrée pour cette évaluation.";
      await persistNoEvidence(reason, model);
      revalidatePath(`/app/eleves/${studentId}`);
      return {
        ok: true,
        assessmentId: assessment.id,
        assessmentTitle: assessment.title,
        recommendationCount: 0,
        reused: false,
        analysisStatus: "insufficient_evidence",
        insufficientReason: reason,
        rejectedCandidates: 0,
      };
    }

    let modelResult: Awaited<ReturnType<typeof analyzePedagogicalEvidence>>;
    try {
      modelResult = await analyzePedagogicalEvidence(aiInput);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message === "OPENAI_API_KEY_MISSING")
        return { ok: false, error: "L’IA n’est pas encore configurée sur ce serveur (clé d’API absente). Aucune analyse n’a été enregistrée." };
      console.error("FOCUS pedagogical AI request failed", message);
      return { ok: false, error: "L’analyse IA a échoué. Aucune recommandation n’a été enregistrée ; réessayez plus tard." };
    }

    // Only notions of the class's programme may carry a recommendation;
    // prior-level prerequisites are context for the model, not targets.
    const validated = validateModelAnalysis(
      modelResult.analysis,
      aiInput.questions.map((question) => ({
        assessmentId: assessment.id,
        questionId: question.questionId,
        responseText: question.responseText,
        correctionText: question.correctionText,
        maxPoints: question.maxPoints,
        awardedPoints: question.awardedPoints,
        assessedCodes: question.assessedNotions,
      })),
      graph.mappableNotionIdsByCode,
      { relatedCodes: relatedCodesFor(graph) },
    );
    if (validated.rejected.length)
      console.warn("FOCUS model candidates rejected", validated.rejected.map((item) => item.reason));

    if (validated.status === "insufficient_evidence") {
      await persistNoEvidence(validated.insufficientReason, modelResult.model);
      revalidatePath(`/app/eleves/${studentId}`);
      return {
        ok: true,
        assessmentId: assessment.id,
        assessmentTitle: assessment.title,
        recommendationCount: 0,
        reused: false,
        analysisStatus: "insufficient_evidence",
        insufficientReason: validated.insufficientReason,
        rejectedCandidates: validated.rejected.length,
      };
    }

    // Confidence is recomputed by the database from the evidence history.
    const payload = buildAnalysisPersistence({
      validated: validated.errors,
      responseIdByQuestion: new Map(responses.map((response) => [response.question_id, response.id])),
      priorErrors: [],
    });
    const { error } = await supabase.rpc("focus_persist_pedagogical_analysis", {
      p_school_id: context.schoolId,
      p_student_id: studentId,
      p_assessment_id: assessment.id,
      p_model: modelResult.model,
      p_input_hash: inputHash,
      p_errors: payload.errors,
      p_recommendations: payload.recommendations,
    });
    if (error) {
      console.error("FOCUS pedagogical analysis persistence failed", { code: error.code, message: error.message });
      return { ok: false, error: "L’analyse a été produite mais n’a pas pu être enregistrée de façon sûre. Aucune recommandation n’a été conservée." };
    }
    revalidatePath(`/app/eleves/${studentId}`);
    revalidatePath(`/app/evaluations/${assessment.id}`);
    return {
      ok: true,
      assessmentId: assessment.id,
      assessmentTitle: assessment.title,
      recommendationCount: payload.recommendations.length,
      reused: false,
      analysisStatus: payload.recommendations.length > 0 ? "errors_found" : "no_error_observed",
      insufficientReason: "",
      rejectedCandidates: validated.rejected.length,
    };
  } catch (error) {
    return failure(error, "L’analyse n’a pas pu être préparée. Aucune recommandation n’a été enregistrée.");
  }
}

// ---------------------------------------------------------------------------
// Teacher review
// ---------------------------------------------------------------------------

export async function reviewPedagogicalRecommendation(
  recommendationId: string,
  decision: "validate" | "dismiss",
  note = "",
): Promise<{ ok: true } | Failure> {
  if (!UUID_RE.test(recommendationId) || !["validate", "dismiss"].includes(decision))
    return { ok: false, error: "Décision invalide." };
  if (typeof note !== "string" || note.length > 1000) return { ok: false, error: "La note est limitée à 1 000 caractères." };
  try {
    const { supabase } = await session();
    const { data, error } = await supabase.rpc("focus_review_pedagogical_recommendation", {
      p_recommendation_id: recommendationId,
      p_decision: decision,
      p_note: note.trim(),
    });
    if (error) {
      console.error("FOCUS recommendation review failed", { code: error.code, message: error.message });
      return {
        ok: false,
        error:
          error.code === "55000"
            ? "Cette recommandation a été remplacée : les preuves de l’élève ont changé depuis l’analyse. Relancez l’analyse."
            : error.code === "42501"
              ? "Vous n’avez pas les droits nécessaires pour décider de cette recommandation."
              : "La décision n’a pas pu être enregistrée.",
      };
    }
    const row = data as { studentId: string; assessmentId: string };
    revalidatePath(`/app/eleves/${row.studentId}`);
    revalidatePath(`/app/evaluations/${row.assessmentId}`);
    revalidatePath("/app");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}
