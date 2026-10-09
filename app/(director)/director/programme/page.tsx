import { loadDirectorData } from "@/lib/director-data";

function value(percent: number | null) {
  return percent === null ? "Non mesurable" : percent + "%";
}

export default async function DirectorProgrammePage() {
  const { programme } = await loadDirectorData();
  return (
    <div className="space-y-7">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-brand">PROGRAMME</p>
        <h1 className="mt-2 text-3xl font-semibold">Avancement pédagogique</h1>
        <p className="mt-3 max-w-3xl text-ink-soft">
          La couverture “séances” mesure les compétences explicitement reliées aux séances enregistrées.
          La couverture “évaluées” mesure les compétences reliées aux évaluations. Ce sont deux indicateurs distincts.
        </p>
      </header>
      <div className="space-y-4">
        {programme.map((row) => (
          <article key={row.key} className="rounded-xl border border-border bg-white p-5">
            <div className="flex flex-wrap justify-between gap-4">
              <div>
                <h2 className="font-semibold">{row.className} · {row.subject}</h2>
                <p className="mt-1 text-sm text-ink-soft">{row.teacherNames.join(", ") || "Professeur non affecté"}</p>
              </div>
              <div className="text-right">
                <p className="text-sm text-ink-soft">Couverture déclarée par les séances</p>
                <p className="mt-1 text-2xl font-semibold">{value(row.lessonCoveragePercent)}</p>
              </div>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg bg-paper p-3 text-sm"><span className="text-ink-soft">Catalogue compétences</span><strong className="mt-1 block">{row.totalCompetencies}</strong></div>
              <div className="rounded-lg bg-paper p-3 text-sm"><span className="text-ink-soft">Liées à une séance</span><strong className="mt-1 block">{row.coveredCompetencies}</strong></div>
              <div className="rounded-lg bg-paper p-3 text-sm"><span className="text-ink-soft">Déjà évaluées</span><strong className="mt-1 block">{row.assessedCompetencies} · {value(row.assessmentCoveragePercent)}</strong></div>
            </div>
          </article>
        ))}
        {!programme.length && (
          <div className="rounded-xl border border-border bg-white p-6 text-sm text-ink-soft">
            Aucune affectation matière/classe n’est disponible.
          </div>
        )}
      </div>
      <div className="rounded-xl border border-watch bg-watch-soft p-5 text-sm leading-6 text-watch">
        Limite actuelle : FOCUS ne relie pas encore directement chaque séance aux 99 nœuds du programme officiel importé.
        Le pourcentage ci-dessus porte sur le catalogue de compétences de l’établissement, pas sur une certification automatique
        que “100 % du programme officiel est terminé”.
      </div>
    </div>
  );
}
