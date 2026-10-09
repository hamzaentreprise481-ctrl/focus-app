import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { loadDirectorData } from "@/lib/director-data";

function score(value: number | null) {
  return value === null ? "—" : value.toFixed(1) + "/20";
}

export default async function DirectorDashboardPage() {
  const data = await loadDirectorData();

  return (
    <div className="space-y-9">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-brand">ÉTABLISSEMENT</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Bonjour {data.directorName}.
        </h1>
        <p className="mt-3 max-w-3xl text-ink-soft">
          Une vue de pilotage, pas un classement automatique des professeurs. Les
          résultats élèves, l’activité pédagogique et la couverture du programme
          sont présentés séparément.
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {[
          ["Élèves", data.totals.students],
          ["Professeurs", data.totals.teachers],
          ["Classes", data.totals.classes],
          ["Évaluations", data.totals.assessments],
          ["Séances renseignées", data.totals.lessons],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-xl border border-border bg-white p-5">
            <p className="text-sm text-ink-soft">{label}</p>
            <p className="mt-2 text-3xl font-semibold">{value}</p>
          </div>
        ))}
      </section>

      <section>
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Classes</h2>
            <p className="mt-1 text-sm text-ink-soft">Résultats observés et activité enregistrée.</p>
          </div>
          <Link href="/director/classes" className="text-sm font-semibold text-brand">Toutes les classes →</Link>
        </div>
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          {data.classes.slice(0, 4).map((row) => (
            <article key={row.id} className="rounded-xl border border-border bg-white p-5">
              <div className="flex justify-between gap-4">
                <div>
                  <h3 className="font-semibold">{row.name}</h3>
                  <p className="mt-1 text-sm text-ink-soft">{row.level ?? "Niveau non renseigné"} · {row.students} élèves</p>
                </div>
                <span className="text-lg font-semibold">{score(row.average)}</span>
              </div>
              <p className="mt-4 text-sm text-ink-soft">
                {row.assessments} évaluations · {row.lessons} séances · {row.gradedResults} résultats notés
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Avancement du programme</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-ink-soft">
              FOCUS peut suivre les compétences reliées aux séances et aux évaluations.
              Ce n’est pas encore une preuve de couverture exhaustive du programme officiel :
              les professeurs doivent renseigner leurs séances et les compétences travaillées.
            </p>
          </div>
          <Link href="/director/programme" className="inline-flex items-center gap-2 text-sm font-semibold text-brand">
            Voir le détail <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
      </section>
    </div>
  );
}
