import { LessonForm } from "@/components/teacher/lesson-form";
import { createAuthClient, requireTeacher } from "@/lib/auth/server";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(value + "T12:00:00"));
}

export default async function TeacherLessonsPage() {
  const teacher = await requireTeacher();
  const supabase = await createAuthClient();
  if (!supabase) throw new Error("Supabase n’est pas configuré.");

  const assignmentResponse = await supabase
    .from("teacher_assignments")
    .select("id,class_id,subject_id")
    .eq("teacher_id", teacher.id);
  if (assignmentResponse.error)
    throw new Error("Impossible de charger les affectations.");

  const assignmentRows = (assignmentResponse.data ?? []) as Array<{
    id: string;
    class_id: string;
    subject_id: string;
  }>;

  const classIds = [...new Set(assignmentRows.map((row) => row.class_id))];
  const subjectIds = [...new Set(assignmentRows.map((row) => row.subject_id))];

  const [classesResponse, subjectsResponse, competenciesResponse, lessonsResponse] =
    await Promise.all([
      classIds.length
        ? supabase.from("classes").select("id,name").in("id", classIds)
        : Promise.resolve({ data: [], error: null }),
      subjectIds.length
        ? supabase.from("subjects").select("id,name").in("id", subjectIds)
        : Promise.resolve({ data: [], error: null }),
      subjectIds.length
        ? supabase
            .from("competencies")
            .select("id,subject_id,name")
            .in("subject_id", subjectIds)
            .order("name")
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from("lessons")
        .select("id,class_id,subject_id,date,summary")
        .eq("teacher_id", teacher.id)
        .order("date", { ascending: false })
        .limit(50),
    ]);

  for (const response of [
    classesResponse,
    subjectsResponse,
    competenciesResponse,
    lessonsResponse,
  ]) {
    if (response.error) throw new Error("Impossible de charger les séances.");
  }

  const classById = new Map(
    ((classesResponse.data ?? []) as Array<{ id: string; name: string }>).map(
      (row) => [row.id, row.name],
    ),
  );
  const subjectById = new Map(
    ((subjectsResponse.data ?? []) as Array<{ id: string; name: string }>).map(
      (row) => [row.id, row.name],
    ),
  );

  const assignments = assignmentRows.map((row) => ({
    id: row.id,
    className: classById.get(row.class_id) ?? "Classe",
    subjectName: subjectById.get(row.subject_id) ?? "Matière",
    subjectId: row.subject_id,
  }));

  const competencies = (
    (competenciesResponse.data ?? []) as Array<{
      id: string;
      subject_id: string;
      name: string;
    }>
  ).map((row) => ({
    id: row.id,
    subjectId: row.subject_id,
    name: row.name,
  }));

  const lessons = (lessonsResponse.data ?? []) as Array<{
    id: string;
    class_id: string;
    subject_id: string;
    date: string;
    summary: string;
  }>;

  return (
    <div className="space-y-9">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-brand">
          SUIVI DU PROGRAMME
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Séances
        </h1>
        <p className="mt-3 max-w-3xl text-ink-soft">
          Renseignez ce qui a réellement été travaillé. La direction voit ensuite
          l’avancement déclaré, sans que FOCUS invente une progression.
        </p>
      </header>

      <section className="rounded-xl border border-border bg-white p-6">
        <h2 className="text-lg font-semibold">Ajouter une séance</h2>
        <div className="mt-5">
          {assignments.length ? (
            <LessonForm assignments={assignments} competencies={competencies} />
          ) : (
            <p className="text-sm text-ink-soft">
              Aucune classe/matière ne vous est affectée.
            </p>
          )}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold">Séances récentes</h2>
        <div className="mt-4 divide-y divide-border rounded-xl border border-border bg-white">
          {lessons.length ? (
            lessons.map((lesson) => (
              <article key={lesson.id} className="p-5">
                <div className="flex flex-wrap justify-between gap-3">
                  <div>
                    <h3 className="font-medium">
                      {classById.get(lesson.class_id) ?? "Classe"} ·{" "}
                      {subjectById.get(lesson.subject_id) ?? "Matière"}
                    </h3>
                    <p className="mt-1 text-sm text-ink-soft">
                      {formatDate(lesson.date)}
                    </p>
                  </div>
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6">
                  {lesson.summary}
                </p>
              </article>
            ))
          ) : (
            <div className="p-6 text-sm text-ink-soft">
              Aucune séance n’a encore été renseignée.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
