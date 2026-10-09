// Writes a DemoPlan through a narrow writer: the administrator CLI uses the
// Supabase admin client, the tests run the very same sequence on PGlite as
// service_role. It only ever INSERTS, into a new school it creates; it never
// reads or changes another school's rows.

import { randomBytes } from "node:crypto";
import type { DemoPerson, DemoPersonKey, DemoPlan } from "./plan";

export interface DemoWriter {
  insert<T = { id: string }>(table: string, rows: Record<string, unknown>[], returning?: string): Promise<T[]>;
  select<T>(table: string, columns: string, equals: Record<string, string | boolean>, options?: { orderBy?: string; limit?: number }): Promise<T[]>;
  /** Creates a confirmed auth user (no e-mail is sent) and returns its id. */
  createUser(person: DemoPerson, password: string): Promise<string>;
}

export interface DemoLogin {
  space: "Student" | "Direction";
  path: string;
  email: string;
  password: string;
}

export function demoPassword() {
  return randomBytes(18).toString("base64url");
}

export async function seedDemoPortals(writer: DemoWriter, plan: DemoPlan, password: () => string = demoPassword) {
  const existing = await writer.select<{ id: string }>("schools", "id", { name: plan.school });
  if (existing.length) throw new Error(`"${plan.school}" already exists: nothing was written.`);

  // People first: an existing address makes createUser fail before any row.
  const userIds = {} as Record<DemoPersonKey, string>;
  const logins: DemoLogin[] = [];
  for (const person of plan.people) {
    const secret = password();
    userIds[person.key] = await writer.createUser(person, secret);
    if (person.login)
      logins.push(
        person.role === "admin"
          ? { space: "Direction", path: "/connexion-direction", email: person.email, password: secret }
          : { space: "Student", path: "/connexion-eleve", email: person.email, password: secret },
      );
  }

  const [school] = await writer.insert("schools", [{ name: plan.school }]);
  const [year] = await writer.insert("academic_years", [
    { school_id: school.id, name: plan.year.name, starts_at: plan.year.startsAt, ends_at: plan.year.endsAt, active: true },
  ]);
  const [classRow] = await writer.insert("classes", [{ school_id: school.id, academic_year_id: year.id, name: plan.className, level: plan.classLevel }]);
  const [subject] = await writer.insert("subjects", [{ school_id: school.id, name: plan.subject.name, code: plan.subject.code }]);
  const competencies = await writer.insert(
    "competencies",
    plan.competencies.map((name) => ({ school_id: school.id, subject_id: subject.id, name })),
  );

  await writer.insert(
    "school_memberships",
    plan.people.map((person) => ({ school_id: school.id, user_id: userIds[person.key], role: person.role })),
    "user_id",
  );
  await writer.insert(
    "teacher_assignments",
    [{ school_id: school.id, teacher_id: userIds.teacher, class_id: classRow.id, subject_id: subject.id }],
  );
  await writer.insert(
    "student_enrollments",
    (["studentA", "studentB"] as const).map((key) => ({ school_id: school.id, student_id: userIds[key], class_id: classRow.id, academic_year_id: year.id })),
  );

  // Notions of the official programme for the class level, when imported.
  const sources = await writer.select<{ id: string }>("curriculum_sources", "id", { subject_code: plan.subject.code, level_code: "SECONDE_GT" });
  const notions = sources.length
    ? await writer.select<{ id: string }>("curriculum_nodes", "id", { source_id: sources[0].id, node_type: "notion", active: true }, {
        orderBy: "code",
        limit: plan.assessments.length * plan.notionsPerAssessment,
      })
    : [];

  for (const [index, assessment] of plan.assessments.entries()) {
    const [row] = await writer.insert("assessments", [
      { school_id: school.id, class_id: classRow.id, subject_id: subject.id, teacher_id: userIds.teacher, title: assessment.title, date: assessment.date },
    ]);
    await writer.insert(
      "assessment_competencies",
      assessment.competencies.map((competency) => ({ assessment_id: row.id, competency_id: competencies[competency].id })),
      "assessment_id",
    );
    const questions = await writer.insert(
      "assessment_questions",
      assessment.questions.map((question, position) => ({
        assessment_id: row.id,
        position: position + 1,
        prompt: question.prompt,
        correction_text: question.correction,
        rubric: {},
        max_points: question.maxPoints,
      })),
    );
    const tagged = notions.slice(index * plan.notionsPerAssessment, (index + 1) * plan.notionsPerAssessment);
    if (tagged.length)
      await writer.insert(
        "question_curriculum_nodes",
        tagged.map((notion) => ({ question_id: questions[0].id, curriculum_node_id: notion.id, relation: "assesses" })),
        "question_id",
      );
    for (const key of ["studentA", "studentB"] as const) {
      const result = assessment.results[key];
      const [resultRow] = await writer.insert("assessment_results", [
        { assessment_id: row.id, student_id: userIds[key], score: result.score, absent: false, teacher_comment: result.comment },
      ]);
      await writer.insert(
        "competency_results",
        result.levels.map((level) => ({ assessment_result_id: resultRow.id, competency_id: competencies[level.competency].id, mastery_level: level.level })),
      );
      await writer.insert(
        "student_responses",
        result.answers.map((answer, position) => ({
          assessment_id: row.id,
          question_id: questions[position].id,
          student_id: userIds[key],
          response_text: answer.text,
          awarded_points: answer.points,
          teacher_annotation: answer.annotation,
        })),
      );
    }
  }

  for (const lesson of plan.lessons) {
    const [row] = await writer.insert("lessons", [
      { school_id: school.id, class_id: classRow.id, subject_id: subject.id, teacher_id: userIds.teacher, date: lesson.date, summary: lesson.summary },
    ]);
    await writer.insert(
      "lesson_competencies",
      lesson.competencies.map((competency) => ({ lesson_id: row.id, competency_id: competencies[competency].id })),
      "lesson_id",
    );
  }

  return { schoolId: school.id as string, userIds, logins };
}
