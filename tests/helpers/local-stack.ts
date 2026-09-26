// A complete local FOCUS backend for end-to-end tests and manual QA:
// the real schema (every migration) in PGlite, a Supabase Auth/PostgREST
// stand-in on loopback, and a scripted stand-in for the model API.
//
// The model stand-in is NOT a language model: it returns scripted outputs so
// that the production pipeline (prompt, request, strict schema, validation,
// persistence, confidence, review) can be exercised deterministically. Any
// result produced with it must be reported as simulated.
//
// All seeded people and results are fictitious (tests/fixtures/demo-dataset).

import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { PGlite } from "@electric-sql/pglite";
import { classes, currentTeacher } from "../fixtures/demo-dataset/data/class-info";
import { evaluations } from "../fixtures/demo-dataset/data/evaluations";
import { seedRawGrades } from "../fixtures/demo-dataset/data/grades";
import { skills } from "../fixtures/demo-dataset/data/skills";
import { students } from "../fixtures/demo-dataset/data/students";
import { createMigratedDatabase } from "./pg";
import { startLocalSupabase, type LocalAccount, type LocalSupabase } from "./local-supabase";

/** Deterministic UUID (v4 layout) for a fixture identifier. */
export function fixtureUuid(label: string) {
  const hex = createHash("md5").update(`focus-local:${label}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export const LOCAL_TEACHER = {
  email: "claire.martin@example.test",
  password: "local-teacher-password",
  id: fixtureUuid("teacher:claire"),
  firstName: "Claire",
  lastName: "Martin",
};
export const OTHER_TEACHER = {
  email: "paul.henry@example.test",
  password: "other-teacher-password",
  id: fixtureUuid("teacher:paul"),
};
export const NON_TEACHER = {
  email: "parent@example.test",
  password: "parent-password",
  id: fixtureUuid("parent"),
};

const LEVEL_TO_DB = { maitrise: "mastered", en_cours: "developing", fragile: "fragile", non_maitrise: "not_mastered" } as const;

export interface LocalIds {
  school: string;
  year: string;
  classId: string;
  otherClassId: string;
  subject: string;
  studentIds: Map<string, string>;
  assessmentIds: Map<string, string>;
  competencyIds: Map<string, string>;
  otherStudentIds: string[];
}

export async function seedLocalSchool(db: PGlite): Promise<LocalIds> {
  const exec = (sql: string, params: unknown[] = []) => db.query(sql, params);
  const school = fixtureUuid("school");
  const year = fixtureUuid("year");
  const classId = fixtureUuid(`class:${classes[0].id}`);
  const otherClassId = fixtureUuid("class:seconde-5");
  const subject = fixtureUuid("subject:math");

  const users: Array<{ id: string; email: string | null; app: object; meta: object }> = [
    { id: LOCAL_TEACHER.id, email: LOCAL_TEACHER.email, app: { role: "teacher" }, meta: { first_name: LOCAL_TEACHER.firstName, last_name: LOCAL_TEACHER.lastName } },
    { id: OTHER_TEACHER.id, email: OTHER_TEACHER.email, app: { role: "teacher" }, meta: { first_name: "Paul", last_name: "Henry" } },
    { id: NON_TEACHER.id, email: NON_TEACHER.email, app: { role: "parent" }, meta: {} },
  ];
  const studentIds = new Map(students.map((student) => [student.id, fixtureUuid(`student:${student.id}`)]));
  for (const student of students) {
    const [first, ...rest] = student.name.split(" ");
    users.push({ id: studentIds.get(student.id)!, email: null, app: {}, meta: { first_name: first, last_name: rest.join(" ") } });
  }
  const otherStudentIds = ["Iris Vidal", "Oscar Lemoine"].map((name) => fixtureUuid(`student:other:${name}`));
  ["Iris Vidal", "Oscar Lemoine"].forEach((name, index) => {
    const [first, last] = name.split(" ");
    users.push({ id: otherStudentIds[index], email: null, app: {}, meta: { first_name: first, last_name: last } });
  });
  for (const user of users)
    await exec(
      "insert into auth.users(id, email, raw_app_meta_data, raw_user_meta_data) values ($1, $2, $3, $4)",
      [user.id, user.email, JSON.stringify(user.app), JSON.stringify(user.meta)],
    );

  await exec("insert into public.schools(id, name) values ($1, 'Lycée Jean Moulin (fictif)')", [school]);
  await exec(
    "insert into public.academic_years(id, school_id, name, starts_at, ends_at, active) values ($1, $2, '2026-2027', '2026-09-01', '2027-07-04', true)",
    [year, school],
  );
  await exec("insert into public.classes(id, school_id, academic_year_id, name, level) values ($1, $2, $3, $4, $5)", [
    classId, school, year, classes[0].name, classes[0].level,
  ]);
  await exec("insert into public.classes(id, school_id, academic_year_id, name, level) values ($1, $2, $3, 'Seconde 5', 'Seconde')", [
    otherClassId, school, year,
  ]);
  await exec("insert into public.subjects(id, school_id, name, code) values ($1, $2, 'Mathématiques', 'MATH')", [subject, school]);

  const member = (user: string, role: string) =>
    exec("insert into public.school_memberships(school_id, user_id, role) values ($1, $2, $3)", [school, user, role]);
  await member(LOCAL_TEACHER.id, "teacher");
  await member(OTHER_TEACHER.id, "teacher");
  await exec("insert into public.teacher_assignments(school_id, teacher_id, class_id, subject_id) values ($1, $2, $3, $4)", [
    school, LOCAL_TEACHER.id, classId, subject,
  ]);
  await exec("insert into public.teacher_assignments(school_id, teacher_id, class_id, subject_id) values ($1, $2, $3, $4)", [
    school, OTHER_TEACHER.id, otherClassId, subject,
  ]);
  for (const id of studentIds.values()) {
    await member(id, "student");
    await exec("insert into public.student_enrollments(school_id, student_id, class_id, academic_year_id) values ($1, $2, $3, $4)", [
      school, id, classId, year,
    ]);
  }
  for (const id of otherStudentIds) {
    await member(id, "student");
    await exec("insert into public.student_enrollments(school_id, student_id, class_id, academic_year_id) values ($1, $2, $3, $4)", [
      school, id, otherClassId, year,
    ]);
  }

  const competencyIds = new Map(skills.map((skill) => [skill.id, fixtureUuid(`competency:${skill.id}`)]));
  for (const skill of skills)
    await exec("insert into public.competencies(id, school_id, subject_id, name) values ($1, $2, $3, $4)", [
      competencyIds.get(skill.id), school, subject, skill.name,
    ]);

  const assessmentIds = new Map(evaluations.map((evaluation) => [evaluation.id, fixtureUuid(`assessment:${evaluation.id}`)]));
  for (const evaluation of evaluations) {
    const id = assessmentIds.get(evaluation.id)!;
    await exec(
      "insert into public.assessments(id, school_id, class_id, subject_id, teacher_id, title, date) values ($1, $2, $3, $4, $5, $6, $7)",
      [id, school, classId, subject, LOCAL_TEACHER.id, evaluation.name, evaluation.date],
    );
    for (const skill of evaluation.skillIds)
      await exec("insert into public.assessment_competencies(assessment_id, competency_id) values ($1, $2)", [id, competencyIds.get(skill)]);
  }
  for (const grade of seedRawGrades) {
    const { rows } = await db.query<{ id: string }>(
      "insert into public.assessment_results(assessment_id, student_id, score, absent) values ($1, $2, $3, $4) returning id",
      [assessmentIds.get(grade.evaluationId), studentIds.get(grade.studentId), grade.score, grade.absent],
    );
    for (const [skill, level] of Object.entries(grade.skillLevels ?? {}))
      if (level)
        await exec("insert into public.competency_results(assessment_result_id, competency_id, mastery_level) values ($1, $2, $3)", [
          rows[0].id, competencyIds.get(skill), LEVEL_TO_DB[level],
        ]);
  }
  // The other teacher has one assessment in their own class.
  await exec(
    "insert into public.assessments(school_id, class_id, subject_id, teacher_id, title, date) values ($1, $2, $3, $4, 'Contrôle Seconde 5', '2026-10-01')",
    [school, otherClassId, subject, OTHER_TEACHER.id],
  );

  void currentTeacher;
  return { school, year, classId, otherClassId, subject, studentIds, assessmentIds, competencyIds, otherStudentIds };
}

// --- Scripted model stand-in ------------------------------------------------

export interface ScriptedError {
  /** Literal text looked up in the student's response. */
  excerpt: string;
  nodeCode: string;
  errorType: "concept" | "calcul" | "raisonnement" | "representation" | "communication" | "methode" | "prerequis";
  difficulty: string;
  explanation: string;
  recommendedAction: string;
  catalogueErrorCode?: string;
}

export const DEFAULT_SCRIPT: ScriptedError[] = [
  {
    excerpt: "2x + 3",
    nodeCode: "MATH.ALG.DISTRIBUTIVITE",
    errorType: "calcul",
    difficulty: "Distribuer le facteur à chaque terme de la parenthèse",
    explanation: "Le facteur 2 n’est appliqué qu’au premier terme de la parenthèse.",
    recommendedAction: "Faire écrire l’étape intermédiaire 2 × x + 2 × 3 sur trois exemples.",
    catalogueErrorCode: "MATH.ALG.DISTRIBUTIVITE.ERR.01",
  },
  {
    excerpt: "2/5 + 1/3 = 3/8",
    nodeCode: "MATH.NUM.FRACTIONS.OPERATIONS",
    errorType: "concept",
    difficulty: "Additionner des fractions de dénominateurs différents",
    explanation: "Les numérateurs et les dénominateurs sont additionnés séparément.",
    recommendedAction: "Revenir au dénominateur commun avec une représentation en parts.",
  },
];

export interface ModelStandIn {
  url: string;
  server: Server;
  calls: unknown[];
  close(): Promise<void>;
}

type AiInput = { questions: Array<{ assessmentId: string; questionId: string; responseText: string }> };

export function scriptedAnalysis(input: AiInput, script: ScriptedError[]) {
  const answered = input.questions.filter((question) => question.responseText.trim());
  if (!answered.length)
    return { status: "insufficient_evidence", insufficientReason: "Aucune réponse n’est fournie.", errors: [] };
  const errors = answered.flatMap((question) =>
    script
      .filter((entry) => question.responseText.includes(entry.excerpt))
      .map((entry) => ({
        assessmentId: question.assessmentId,
        questionId: question.questionId,
        nodeCode: entry.nodeCode,
        errorType: entry.errorType,
        difficulty: entry.difficulty,
        evidenceExcerpt: entry.excerpt,
        explanation: entry.explanation,
        recommendedAction: entry.recommendedAction,
        catalogueErrorCode: entry.catalogueErrorCode ?? "",
      })),
  );
  return errors.length
    ? { status: "errors_found", insufficientReason: "", errors }
    : { status: "no_error_observed", insufficientReason: "", errors: [] };
}

export async function startModelStandIn(port: number, script: ScriptedError[] = DEFAULT_SCRIPT): Promise<ModelStandIn> {
  const calls: unknown[] = [];
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    res.setHeader("Content-Type", "application/json");
    if (req.method === "GET" && req.url?.startsWith("/v1/models/")) return res.end(JSON.stringify({ id: req.url.slice(11) }));
    if (req.method !== "POST" || req.url !== "/v1/responses") {
      res.statusCode = 404;
      return res.end("{}");
    }
    const body = JSON.parse(raw);
    calls.push(body);
    const input = JSON.parse(body.input[1].content[0].text) as AiInput;
    const output = scriptedAnalysis(input, script);
    res.end(JSON.stringify({ output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(output) }] }] }));
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${port}/v1`,
    server,
    calls,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

// --- Stack --------------------------------------------------------------------

export interface LocalStack {
  db: PGlite;
  supabase: LocalSupabase;
  model: ModelStandIn;
  ids: LocalIds;
  /** Environment for `next start` so the app talks only to this stack. */
  env: Record<string, string>;
  close(): Promise<void>;
}

export async function startLocalStack(options: {
  supabasePort: number;
  modelPort: number;
  script?: ScriptedError[];
  /** Last migration to apply, to reproduce a database that is behind the code. */
  upTo?: string;
  /** PostgREST max-rows of the stand-in (default 1000, as on Supabase). */
  maxRows?: number;
}): Promise<LocalStack> {
  const db = await createMigratedDatabase({ upTo: options.upTo });
  const ids = await seedLocalSchool(db);
  const accounts: LocalAccount[] = [
    { email: LOCAL_TEACHER.email, password: LOCAL_TEACHER.password, userId: LOCAL_TEACHER.id },
    { email: OTHER_TEACHER.email, password: OTHER_TEACHER.password, userId: OTHER_TEACHER.id },
    { email: NON_TEACHER.email, password: NON_TEACHER.password, userId: NON_TEACHER.id },
  ];
  const supabase = await startLocalSupabase(db, { port: options.supabasePort, accounts, maxRows: options.maxRows });
  const model = await startModelStandIn(options.modelPort, options.script);
  return {
    db,
    supabase,
    model,
    ids,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: supabase.url,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: supabase.publishableKey,
      OPENAI_API_KEY: "local-stand-in-key",
      OPENAI_BASE_URL: model.url,
      FOCUS_AI_MODEL: "scripted-stand-in",
      VERCEL: "",
    },
    async close() {
      await Promise.all([supabase.close(), model.close()]);
      await db.close();
    },
  };
}
