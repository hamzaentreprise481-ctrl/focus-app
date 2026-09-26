// End-to-end pedagogical pipeline on the exact Work curriculum (undisputed
// 99-node graph, live node UUIDs), through the real SQL functions and RLS:
//
//   student answer → exact error → notion → competency → prerequisite →
//   evidence → explanation → remediation → confidence
//
// The language model is the only simulated step: this environment has no
// OPENAI_API_KEY, so each case supplies the model's JSON output. Everything
// FOCUS does around it — graph read and scoping, AI input, validation of the
// output, confidence, persistence, RLS — is the production code. The glue of
// generatePedagogicalAnalysis is mirrored step by step in runAnalysis().

import { after, afterEach, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import {
  buildCurriculumIndex,
  parseCurriculumGraphPayload,
  resolveCurriculumScope,
  toAiCurriculum,
  type CurriculumIndex,
} from "../lib/curriculum/graph";
import { validateCurriculumPackage } from "../lib/curriculum/package";
import { relatedNotionCodes, validateModelAnalysis } from "../lib/pedagogy/analysis";
import { buildAnalysisPersistence } from "../lib/pedagogy/pipeline";
import { createMigratedDatabase, seedSchoolFixture } from "./helpers/pg";
import {
  LIVE,
  legacyFingerprint,
  splitWorkEdges,
  useLiveIdentifiers,
  workDocument,
} from "./helpers/work-curriculum";

const MODEL = "simulated-model";
let db: PGlite;
const ids = {
  teacher: randomUUID(),
  student: randomUUID(),
  school: randomUUID(),
  classId: randomUUID(),
  subject: randomUUID(),
};

type WorkNode = {
  code: string;
  competency_codes: string[];
  prerequisite_codes: string[];
  errors: Array<{ id: string; description: string }>;
  remediations: Array<{ id: string; steps: string[] }>;
};
const WORK_NODES = new Map(
  (workDocument().nodes as WorkNode[]).map((node) => [node.code, node]),
);
function work(code: string) {
  const node = WORK_NODES.get(code);
  assert.ok(node, code);
  return node;
}

before(async () => {
  db = await createMigratedDatabase();
  await useLiveIdentifiers(db);
  const { conversion, undisputed } = splitWorkEdges();
  const keep = new Set(undisputed.map((edge) => edge.index));
  const pkg = validateCurriculumPackage({
    ...conversion.raw,
    edges: conversion.raw.edges.filter((_, index) => keep.has(index)),
  }).package!;
  await db.exec("set role service_role");
  await db.query("select public.focus_import_curriculum($1::jsonb, false, false)", [JSON.stringify(pkg)]);
  await db.exec("reset role");

  await seedSchoolFixture(db, {
    teacher: ids.teacher,
    students: [ids.student],
    school: ids.school,
    classId: ids.classId,
    subject: ids.subject,
  });
});
after(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.exec("begin");
});
afterEach(async () => {
  await db.exec("rollback");
});

async function asTeacher<T>(fn: () => Promise<T>): Promise<T> {
  await db.exec("savepoint teacher_call");
  try {
    await db.exec("set local role authenticated");
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [ids.teacher]);
    const result = await fn();
    await db.exec("reset role");
    await db.exec("release savepoint teacher_call");
    return result;
  } catch (error) {
    await db.exec("rollback to savepoint teacher_call");
    throw error;
  }
}

async function createAssessment(title: string) {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.assessments(school_id, class_id, subject_id, teacher_id, title, date)
     values ($1, $2, $3, $4, $5, current_date) returning id`,
    [ids.school, ids.classId, ids.subject, ids.teacher, title],
  );
  return rows[0].id;
}

interface QuestionInput {
  prompt: string;
  correction: string;
  response: string;
  /** Notions the teacher tags as assessed by the question. */
  nodeCodes?: string[];
  maxPoints?: string;
  awardedPoints?: string;
}

interface AnalysisContext {
  assessmentId: string;
  questionIds: string[];
  index: CurriculumIndex;
  aiInput: { curriculum: ReturnType<typeof toAiCurriculum> };
}

// Mirrors generatePedagogicalAnalysis for one evidence set.
async function runAnalysis(
  title: string,
  questions: QuestionInput[],
  model: (context: AnalysisContext) => unknown,
) {
  const assessmentId = await createAssessment(title);
  const questionIds = questions.map(() => randomUUID());

  // 1. Teacher records the subject and correction (shared by the class), then
  //    the student's exact answers.
  await asTeacher(() =>
    db.query("select public.focus_save_assessment_questions($1, $2, $3, $4::jsonb)", [
      assessmentId,
      "Évaluation de seconde.",
      "Justifier les étapes.",
      JSON.stringify(
        questions.map((question, index) => ({
          id: questionIds[index],
          prompt: question.prompt,
          correctionText: question.correction,
          rubricText: "",
          maxPoints: question.maxPoints ?? "2",
          nodeCodes: question.nodeCodes ?? [],
        })),
      ),
    ]),
  );
  await asTeacher(() =>
    db.query("select public.focus_save_student_responses($1, $2, $3::jsonb)", [
      assessmentId,
      ids.student,
      JSON.stringify(
        questions.map((question, index) => ({
          questionId: questionIds[index],
          responseText: question.response,
          awardedPoints: question.awardedPoints ?? "",
          teacherAnnotation: "",
        })),
      ),
    ]),
  );

  // 2. Official graph for the class level, as the teacher reads it.
  const index = await asTeacher(async () => {
    const levels = await db.query<{ level_code: string }>(
      "select level_code from public.curriculum_sources where subject_code = 'MATH'",
    );
    const scope = resolveCurriculumScope("Seconde", levels.rows.map((row) => row.level_code));
    assert.deepEqual(scope, { levelCodes: ["SECONDE_GT"], resolution: "class_level" });
    const graph = await db.query<{ graph: unknown }>(
      "select public.focus_curriculum_graph('MATH', $1::text[]) as graph",
      [scope.levelCodes],
    );
    return buildCurriculumIndex(parseCurriculumGraphPayload(graph.rows[0].graph));
  });

  const responses = await asTeacher(async () =>
    (
      await db.query<{ id: string; question_id: string; response_text: string }>(
        "select id, question_id, response_text from public.student_responses where assessment_id = $1 and student_id = $2",
        [assessmentId, ids.student],
      )
    ).rows,
  );
  const responseByQuestion = new Map(responses.map((row) => [row.question_id, row]));
  const aiInput = {
    assessment: { id: assessmentId, title, contextText: "Évaluation de seconde.", instructionsText: "Justifier les étapes." },
    questions: questions.map((question, position) => ({
      assessmentId,
      questionId: questionIds[position],
      prompt: question.prompt,
      correctionText: question.correction,
      rubricText: "",
      maxPoints: Number(question.maxPoints ?? "2"),
      responseText: responseByQuestion.get(questionIds[position])?.response_text ?? "",
      awardedPoints: question.awardedPoints ? Number(question.awardedPoints) : null,
      teacherAnnotation: null,
      assessedNotions: [...(question.nodeCodes ?? [])].sort(),
    })),
    curriculum: toAiCurriculum(index.summaries),
  };
  const inputHash = createHash("sha256").update(JSON.stringify({ model: MODEL, aiInput })).digest("hex");
  const validationQuestions = aiInput.questions.map((question) => ({
    assessmentId,
    questionId: question.questionId,
    responseText: question.responseText,
    correctionText: question.correctionText,
    maxPoints: question.maxPoints,
    awardedPoints: question.awardedPoints,
    assessedCodes: question.assessedNotions,
  }));

  const persistNoEvidence = (reason: string) =>
    asTeacher(() =>
      db.query("select public.focus_persist_no_evidence($1, $2, $3, $4, $5, $6)", [
        ids.school,
        ids.student,
        assessmentId,
        MODEL,
        inputHash,
        reason,
      ]),
    );

  // 3. No answer: FOCUS does not call the model at all.
  if (!aiInput.questions.some((question) => question.responseText.trim())) {
    const reason = "Aucune réponse exploitable de l’élève n’est enregistrée pour cette évaluation.";
    await persistNoEvidence(reason);
    return { assessmentId, status: "insufficient_evidence" as const, reason, index, modelCalled: false };
  }

  // 4. Model output (simulated) → FOCUS guardrails.
  const raw = model({ assessmentId, questionIds, index, aiInput });
  const validated = validateModelAnalysis(raw, validationQuestions, index.mappableNotionIdsByCode, {
    relatedCodes: (codes) => relatedNotionCodes(index.summaries, codes),
  });
  if (validated.status === "insufficient_evidence") {
    await persistNoEvidence(validated.insufficientReason);
    return { assessmentId, status: validated.status, reason: validated.insufficientReason, index, modelCalled: true };
  }

  // 5. Longitudinal history, same queries as the server action.
  const nodeIds = [...new Set(validated.errors.map((error) => error.nodeId))];
  const priorErrors = nodeIds.length
    ? await asTeacher(async () =>
        (
          await db.query<{ node_id: string; assessment_id: string; verified: boolean }>(
            `with latest as (
               select distinct on (assessment_id) id, assessment_id
               from public.ai_analysis_runs
               where student_id = $1 and status = 'completed' and superseded_at is null and assessment_id <> $2
               order by assessment_id, created_at desc)
             select o.curriculum_node_id as node_id, o.assessment_id, o.verified_by_teacher as verified
             from public.error_observations o join latest l on l.id = o.analysis_run_id
             where o.student_id = $1 and o.curriculum_node_id = any($3::uuid[])`,
            [ids.student, assessmentId, nodeIds],
          )
        ).rows,
      )
    : [];

  const payload = buildAnalysisPersistence({
    validated: validated.errors,
    responseIdByQuestion: new Map(responses.map((row) => [row.question_id, row.id])),
    priorErrors: priorErrors.map((row) => ({
      nodeId: row.node_id,
      assessmentId: row.assessment_id,
      verifiedByTeacher: row.verified,
    })),
  });

  // 6. Atomic persistence through the production RPC (RLS as the teacher).
  await asTeacher(() =>
    db.query("select public.focus_persist_pedagogical_analysis($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)", [
      ids.school,
      ids.student,
      assessmentId,
      MODEL,
      inputHash,
      JSON.stringify(payload.errors),
      JSON.stringify(payload.recommendations),
    ]),
  );
  return { assessmentId, status: validated.status, reason: "", index, modelCalled: true, payload };
}

function modelError(
  context: AnalysisContext,
  error: {
    question?: number;
    nodeCode: string;
    errorType?: string;
    difficulty: string;
    excerpt: string;
    explanation: string;
    action: string;
  },
) {
  return {
    assessmentId: context.assessmentId,
    questionId: context.questionIds[error.question ?? 0],
    nodeCode: error.nodeCode,
    errorType: error.errorType ?? "calcul",
    difficulty: error.difficulty,
    evidenceExcerpt: error.excerpt,
    explanation: error.explanation,
    recommendedAction: error.action,
  };
}

async function persisted(assessmentId: string) {
  return asTeacher(async () => {
    const runs = await db.query<{ status: string; failure_reason: string | null }>(
      "select status, failure_reason from public.ai_analysis_runs where assessment_id = $1",
      [assessmentId],
    );
    const observations = await db.query<{ code: string; excerpt: string; confidence: string; error_type: string }>(
      `select n.code, o.evidence_excerpt as excerpt, o.confidence, o.error_type
       from public.error_observations o join public.curriculum_nodes n on n.id = o.curriculum_node_id
       where o.assessment_id = $1 order by o.created_at`,
      [assessmentId],
    );
    const recommendations = await db.query<{
      id: string; code: string; difficulty: string; explanation: string; action: string; confidence: string; evidence: unknown;
    }>(
      `select r.id, n.code, r.difficulty, r.explanation, r.recommended_action as action, r.confidence, r.evidence
       from public.pedagogical_recommendations r join public.curriculum_nodes n on n.id = r.curriculum_node_id
       where r.assessment_id = $1 and r.dismissed_at is null`,
      [assessmentId],
    );
    const links = await db.query<{ code: string; relation: string }>(
      `select n.code, q.relation from public.question_curriculum_nodes q
       join public.assessment_questions aq on aq.id = q.question_id
       join public.curriculum_nodes n on n.id = q.curriculum_node_id
       where aq.assessment_id = $1 order by q.relation, n.code`,
      [assessmentId],
    );
    return {
      runs: runs.rows,
      observations: observations.rows,
      recommendations: recommendations.rows,
      links: links.rows,
    };
  });
}

// ---------------------------------------------------------------------------
// errors_found: the full chain
// ---------------------------------------------------------------------------

test("distributivity error from the Work catalogue: answer → error → notion → competency → prerequisites → evidence → remediation → confidence", async () => {
  const node = work("MATH.ALG.DISTRIBUTIVITE");
  assert.equal(node.errors[0].description, "Écrire 3(x+2)=3x+2");
  const remediation = node.remediations[0].steps[0];

  const result = await runAnalysis(
    "Calcul littéral",
    [{ prompt: "Développer 3(x+2).", correction: "3(x+2)=3x+6", response: "3(x+2)=3x+2" }],
    (context) => {
      // What the model sees for this notion comes from the Work graph.
      const seen = context.aiInput.curriculum.find((item) => item.code === "MATH.ALG.DISTRIBUTIVITE");
      assert.ok(seen?.inScope);
      assert.deepEqual(seen.competencies, [...node.competency_codes].sort());
      assert.deepEqual(seen.prerequisites, [...node.prerequisite_codes].sort());
      return {
        status: "errors_found",
        insufficientReason: "",
        errors: [
          modelError(context, {
            nodeCode: "MATH.ALG.DISTRIBUTIVITE",
            difficulty: "Le facteur 3 n’est distribué qu’au premier terme.",
            excerpt: "3(x+2)=3x+2",
            explanation: "L’élève multiplie x par 3 mais recopie 2 au lieu de 3×2.",
            action: remediation,
          }),
        ],
      };
    },
  );
  assert.equal(result.status, "errors_found");

  const saved = await persisted(result.assessmentId);
  assert.deepEqual(saved.runs, [{ status: "completed", failure_reason: null }]);
  assert.deepEqual(saved.observations, [
    { code: "MATH.ALG.DISTRIBUTIVITE", excerpt: "3(x+2)=3x+2", confidence: "limitee", error_type: "calcul" },
  ]);
  assert.equal(saved.recommendations.length, 1);
  assert.equal(saved.recommendations[0].action, remediation);
  assert.equal(saved.recommendations[0].confidence, "limitee");
  // An AI diagnosis never tags the teacher's question: assessed notions are
  // teacher-authored. The notion's prerequisites come from the graph.
  assert.deepEqual(saved.links, []);
  assert.deepEqual(result.index.summaryByCode.get("MATH.ALG.DISTRIBUTIVITE")!.prerequisites, [...node.prerequisite_codes].sort());
  // The teacher view resolves competencies from the same graph.
  const summary = result.index.summaryByCode.get("MATH.ALG.DISTRIBUTIVITE")!;
  assert.deepEqual(summary.competencies.map((code) => result.index.nodeByCode.get(code)!.title), ["Calculer"]);
  // The recommendation points at the live UUID of the existing notion.
  const [{ id }] = (
    await db.query<{ id: string }>("select curriculum_node_id as id from public.pedagogical_recommendations where assessment_id = $1", [result.assessmentId])
  ).rows;
  assert.equal(id, LIVE.nodes.find((item) => item.code === "MATH.ALG.DISTRIBUTIVITE")!.id);
});

test("two occurrences in one assessment raise confidence to moderee (fractions, Work error catalogue)", async () => {
  const node = work("MATH.NUM.FRACTIONS.OPERATIONS");
  assert.equal(node.errors[0].description, "Diviser sans inverser la seconde fraction");
  const result = await runAnalysis(
    "Fractions",
    [
      { prompt: "Calculer (3/4)/(2/5).", correction: "15/8", response: "(3/4)/(2/5) = 6/20" },
      { prompt: "Calculer (1/2)/(3/5).", correction: "5/6", response: "(1/2)/(3/5) = 3/10" },
    ],
    (context) => ({
      status: "errors_found",
      insufficientReason: "",
      errors: [0, 1].map((question) =>
        modelError(context, {
          question,
          nodeCode: "MATH.NUM.FRACTIONS.OPERATIONS",
          difficulty: node.errors[0].description,
          excerpt: question === 0 ? "(3/4)/(2/5) = 6/20" : "(1/2)/(3/5) = 3/10",
          explanation: "Les fractions sont multipliées terme à terme au lieu de multiplier par l’inverse.",
          action: node.remediations[0].steps[0],
        }),
      ),
    }),
  );
  const saved = await persisted(result.assessmentId);
  assert.deepEqual(saved.observations.map((row) => row.confidence), ["moderee", "moderee"]);
  assert.equal(saved.recommendations.length, 1);
  assert.equal((saved.recommendations[0].evidence as unknown[]).length, 2);
  assert.equal(saved.recommendations[0].confidence, "moderee");
});

test("a new Work notion (produit nul) works end to end, and a teacher-validated prior makes the signal forte", async () => {
  const node = work("MATH.ALG.PRODUIT_NUL");
  const question = {
    prompt: "Résoudre (2x-6)(x+1)=0.",
    correction: "S={-1;3}",
    response: "Il faut 2x-6=0 et x+1=0 en même temps, donc pas de solution.",
  };
  const answer = (context: AnalysisContext) => ({
    status: "errors_found",
    insufficientReason: "",
    errors: [
      modelError(context, {
        nodeCode: "MATH.ALG.PRODUIT_NUL",
        errorType: "raisonnement",
        difficulty: node.errors[0].description,
        excerpt: "2x-6=0 et x+1=0 en même temps",
        explanation: "L’élève exige que les deux facteurs soient nuls simultanément.",
        action: node.remediations[0].steps[0],
      }),
    ],
  });

  const first = await runAnalysis("Équations 1", [question], answer);
  let saved = await persisted(first.assessmentId);
  assert.equal(saved.recommendations[0].code, "MATH.ALG.PRODUIT_NUL");
  assert.equal(saved.recommendations[0].confidence, "limitee");
  assert.deepEqual(first.index.summaryByCode.get("MATH.ALG.PRODUIT_NUL")!.prerequisites, [...node.prerequisite_codes].sort());
  assert.deepEqual(
    first.index.summaryByCode.get("MATH.ALG.PRODUIT_NUL")!.competencies,
    [...node.competency_codes].sort(),
  );

  // The teacher confirms; the same error on a later assessment is then "forte".
  await asTeacher(() =>
    db.query("select public.focus_review_pedagogical_recommendation($1, 'validate')", [saved.recommendations[0].id]),
  );
  const second = await runAnalysis("Équations 2", [{ ...question, prompt: "Résoudre (x-4)(3x+3)=0.", correction: "S={-1;4}", response: "Il faut 2x-6=0 et x+1=0 en même temps, donc pas de solution." }], answer);
  saved = await persisted(second.assessmentId);
  assert.equal(saved.recommendations[0].confidence, "forte");
});

test("a correct answer gives no_error_observed: no recommendation, and nothing is recorded as mastery", async () => {
  const result = await runAnalysis(
    "Géométrie repérée",
    [{ prompt: "Milieu de A(-2;4) et B(6;0) ?", correction: "(2;2)", response: "I((-2+6)/2 ; (4+0)/2) = (2;2)" }],
    () => ({ status: "no_error_observed", insufficientReason: "", errors: [] }),
  );
  assert.equal(result.status, "no_error_observed");
  const saved = await persisted(result.assessmentId);
  assert.deepEqual(saved.runs, [{ status: "completed", failure_reason: null }]);
  assert.deepEqual(saved.observations, []);
  assert.deepEqual(saved.recommendations, []);
});

// ---------------------------------------------------------------------------
// insufficient_evidence instead of guessing
// ---------------------------------------------------------------------------

async function expectInsufficient(
  label: string,
  questions: QuestionInput[],
  model: (context: AnalysisContext) => unknown,
  reason: RegExp,
  modelCalled = true,
) {
  const result = await runAnalysis(label, questions, model);
  assert.equal(result.status, "insufficient_evidence", label);
  assert.equal(result.modelCalled, modelCalled, label);
  assert.match(result.reason, reason, label);
  const saved = await persisted(result.assessmentId);
  assert.equal(saved.runs.length, 1, label);
  assert.equal(saved.runs[0].status, "no_evidence", label);
  assert.match(saved.runs[0].failure_reason ?? "", reason, label);
  assert.deepEqual(saved.observations, [], label);
  assert.deepEqual(saved.recommendations, [], label);
}

const EVOLUTION_QUESTION = {
  prompt: "Hausse de 25 % puis baisse de 20 % : bilan ?",
  correction: "1,25×0,8=1 ; évolution globale nulle.",
};

test("no answer at all: the model is not called", async () => {
  await expectInsufficient(
    "Sans réponse",
    [{ ...EVOLUTION_QUESTION, response: "" }],
    () => assert.fail("the model must not be called"),
    /Aucune réponse exploitable/,
    false,
  );
});

test("a bare wrong result without any step: the model must answer insufficient_evidence", async () => {
  // Work: "une réponse fausse isolée ne suffit pas à attribuer sa cause".
  await expectInsufficient(
    "Résultat nu",
    [{ ...EVOLUTION_QUESTION, response: "-5 %" }],
    () => ({
      status: "insufficient_evidence",
      insufficientReason: "Résultat seul, sans étape : la cause de l’erreur ne peut pas être établie.",
      errors: [],
    }),
    /sans étape/,
  );
});

test("an invented quotation is refused even if the diagnosis sounds right", async () => {
  await expectInsufficient(
    "Citation inventée",
    [{ prompt: "Comparer P_A(B) et P_B(A).", correction: "0,25 et 0,5", response: "P_A(B) = 5/20 = 0,25 et P_B(A) = 0,25" }],
    (context) => ({
      status: "errors_found",
      insufficientReason: "",
      errors: [
        modelError(context, {
          nodeCode: "MATH.PROBA.CONDITIONNELLE",
          difficulty: "Assimiler P_A(B) et P_B(A)",
          excerpt: "P_A(B) = P_B(A)",
          explanation: "Confusion des conditionnements.",
          action: "Reconstituer les populations.",
        }),
      ],
    }),
    /aucune preuve vérifiable/,
  );
});

test("a competency, a prior-cycle prerequisite, a Work error id or an unknown code is never a diagnosis", async () => {
  const response = "(3/4)/(2/5) = 6/20";
  for (const nodeCode of [
    "MATH.COMP.CALCULER",
    "MATH.PREREQ.CYCLE4.FRACTIONS",
    "MATH.NUM.FRACTIONS.OPERATIONS.ERR.01",
    "MATH.NUM.FRACTIONS.DIVISION",
  ])
    await expectInsufficient(
      `Nœud ${nodeCode}`,
      [{ prompt: "Calculer (3/4)/(2/5).", correction: "15/8", response }],
      (context) => ({
        status: "errors_found",
        insufficientReason: "",
        errors: [
          modelError(context, {
            nodeCode,
            difficulty: "Division de fractions",
            excerpt: response,
            explanation: "Multiplication terme à terme.",
            action: "Revenir à l’inverse.",
          }),
        ],
      }),
      /aucune preuve vérifiable/,
    );
});

test("a malformed model output falls back to insufficient_evidence", async () => {
  await expectInsufficient(
    "Sortie invalide",
    [{ ...EVOLUTION_QUESTION, response: "+20 % puis -20 % donc on revient au prix de départ" }],
    () => ({ status: "probable_error", errors: [] }),
    /sortie d’analyse valide/,
  );
});

test("the database refuses a non-notion or a fabricated excerpt even if client validation were bypassed", async () => {
  const assessmentId = await createAssessment("Contournement");
  const questionId = randomUUID();
  await asTeacher(() =>
    db.query("select public.focus_save_assessment_questions($1, 'c', 'i', $2::jsonb)", [
      assessmentId,
      JSON.stringify([{ id: questionId, prompt: "Développer 3(x+2).", correctionText: "3x+6", rubricText: "", maxPoints: "" }]),
    ]),
  );
  await asTeacher(() =>
    db.query("select public.focus_save_student_responses($1, $2, $3::jsonb)", [
      assessmentId,
      ids.student,
      JSON.stringify([{ questionId, responseText: "3(x+2)=3x+2", awardedPoints: "", teacherAnnotation: "" }]),
    ]),
  );
  const [{ id: responseId }] = (
    await db.query<{ id: string }>("select id from public.student_responses where question_id = $1", [questionId])
  ).rows;
  const nodeId = (code: string) => LIVE.nodes.find((node) => node.code === code)!.id;
  const attempt = (node: string, excerpt: string) =>
    asTeacher(() =>
      db.query("select public.focus_persist_pedagogical_analysis($1, $2, $3, 'm', $4, $5::jsonb, '[]'::jsonb)", [
        ids.school,
        ids.student,
        assessmentId,
        createHash("sha256").update(randomUUID()).digest("hex"),
        JSON.stringify([{ questionId, responseId, nodeId: nodeId(node), errorType: "calcul", evidenceExcerpt: excerpt, explanation: "x", confidence: "limitee" }]),
      ]),
    );
  await assert.rejects(attempt("MATH.COMP.CALCULER", "3x+2"), /invalid curriculum notion/);
  await assert.rejects(attempt("MATH.ALG.DISTRIBUTIVITE", "3x+6"), /invalid evidence reference/);
  const saved = await persisted(assessmentId);
  assert.deepEqual([saved.runs, saved.observations, saved.recommendations], [[], [], []]);
});

test("none of these analyses touched the 44 live curriculum UUIDs", async () => {
  assert.deepEqual(await legacyFingerprint(db), { nodes: 44, fingerprint: LIVE.fingerprint });
});
