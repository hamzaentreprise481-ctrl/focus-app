import { loadStudentProgress, type MasteryLevel } from "@/lib/student-data";

const LABELS: Record<MasteryLevel, string> = {
  mastered: "Maîtrisée",
  developing: "En cours",
  fragile: "Fragile",
  not_mastered: "À retravailler",
};

const CLASSES: Record<MasteryLevel, string> = {
  mastered: "bg-normal-soft text-normal",
  developing: "bg-brand-soft text-brand-ink",
  fragile: "bg-watch-soft text-watch",
  not_mastered: "bg-attention-soft text-attention",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value + "T12:00:00"));
}

export default async function StudentProgressPage() {
  const progress = await loadStudentProgress();
  const mastered = progress.filter((item) => item.level === "mastered").length;
  const toWork = progress.filter(
    (item) => item.level === "fragile" || item.level === "not_mastered",
  ).length;

  return (
    <div className="space-y-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-brand">
          Suivi
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Ma progression
        </h1>
        <p className="mt-3 max-w-2xl text-ink-soft">
          Ces niveaux proviennent des compétences déjà renseignées dans vos
          évaluations. Ils ne sont pas remplacés par une supposition de l’IA.
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-white p-5">
          <p className="text-sm text-ink-soft">Compétences suivies</p>
          <p className="mt-2 text-3xl font-semibold">{progress.length}</p>
        </div>
        <div className="rounded-xl border border-border bg-white p-5">
          <p className="text-sm text-ink-soft">Maîtrisées</p>
          <p className="mt-2 text-3xl font-semibold">{mastered}</p>
        </div>
        <div className="rounded-xl border border-border bg-white p-5">
          <p className="text-sm text-ink-soft">À consolider</p>
          <p className="mt-2 text-3xl font-semibold">{toWork}</p>
        </div>
      </section>

      <section className="divide-y divide-border rounded-xl border border-border bg-white">
        {progress.length ? (
          progress.map((item) => (
            <div
              key={item.competencyId}
              className="flex flex-wrap items-center justify-between gap-4 p-5"
            >
              <div>
                <p className="font-medium">{item.name}</p>
                <p className="mt-1 text-sm text-ink-soft">
                  {item.subject} · {item.assessmentTitle} ·{" "}
                  {formatDate(item.assessmentDate)}
                </p>
              </div>
              <span
                className={
                  "rounded-full px-3 py-1 text-xs font-semibold " +
                  CLASSES[item.level]
                }
              >
                {LABELS[item.level]}
              </span>
            </div>
          ))
        ) : (
          <div className="p-7 text-sm text-ink-soft">
            Aucune compétence n’a encore été renseignée dans vos résultats.
          </div>
        )}
      </section>
    </div>
  );
}
