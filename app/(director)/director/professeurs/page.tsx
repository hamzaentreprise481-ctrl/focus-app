import { loadDirectorData } from "@/lib/director-data";

export default async function DirectorTeachersPage() {
  const { teachers } = await loadDirectorData();
  return (
    <div className="space-y-7">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-brand">ÉQUIPE PÉDAGOGIQUE</p>
        <h1 className="mt-2 text-3xl font-semibold">Professeurs</h1>
        <p className="mt-3 max-w-3xl text-ink-soft">
          Activité enregistrée dans FOCUS. Une moyenne d’élèves n’est pas transformée en “note du professeur”.
        </p>
      </header>
      <div className="grid gap-4 lg:grid-cols-2">
        {teachers.map((teacher) => (
          <article key={teacher.id} className="rounded-xl border border-border bg-white p-5">
            <h2 className="font-semibold">{teacher.name}</h2>
            <p className="mt-1 text-sm text-ink-soft">{teacher.subjects.join(", ") || "Matière non affectée"}</p>
            <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg bg-paper p-3"><span className="text-ink-soft">Classes</span><strong className="mt-1 block">{teacher.classes.length}</strong></div>
              <div className="rounded-lg bg-paper p-3"><span className="text-ink-soft">Évaluations</span><strong className="mt-1 block">{teacher.assessments}</strong></div>
              <div className="rounded-lg bg-paper p-3"><span className="text-ink-soft">Séances</span><strong className="mt-1 block">{teacher.lessons}</strong></div>
              <div className="rounded-lg bg-paper p-3"><span className="text-ink-soft">Classes affectées</span><strong className="mt-1 block truncate">{teacher.classes.join(", ") || "—"}</strong></div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
