import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { requireDirector } from "@/lib/auth/server";
import { loadDirectorWorkspace } from "@/lib/director/data";
import {
  EmptyNote,
  LessonsUnavailableNote,
  formatDate,
  Measure,
  PageIntro,
  SectionTitle,
  Stat,
} from "@/components/director/indicators";

export default async function DirectorHomePage() {
  await requireDirector();
  const workspace = await loadDirectorWorkspace();
  const { totals, overall, rows, alerts } = workspace;
  const risky = rows.filter((row) => row.pace.status === "at_risk");
  const watch = rows.filter((row) => row.pace.status === "watch");
  const riskySubjects = [...new Set(risky.map((row) => row.subjectName))];
  const riskyClasses = [...new Set(risky.map((row) => row.className))];
  const dataAlerts = alerts.filter((alert) => alert.family === "data").length;

  return (
    <div className="space-y-10">
      <PageIntro title={workspace.school.name}>
        Vue d’ensemble de l’établissement à partir des données saisies dans
        FOCUS. Le programme déclaré traité, le programme évalué et les
        compétences documentées sont mesurés séparément : aucun de ces
        indicateurs ne dit que les élèves maîtrisent le programme.
      </PageIntro>
      {workspace.otherSchools > 0 && (
        <p role="note" className="rounded-lg bg-brand-soft p-4 text-sm text-brand-ink">
          Votre compte dirige aussi {workspace.otherSchools} autre
          {workspace.otherSchools > 1 ? "s" : ""} établissement
          {workspace.otherSchools > 1 ? "s" : ""}. Cette version affiche le
          premier rattachement uniquement.
        </p>
      )}

      <section aria-labelledby="chiffres" className="space-y-4">
        <h2 id="chiffres" className="sr-only">
          Chiffres clés
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Élèves" value={totals.students} />
          <Stat label="Professeurs" value={totals.teachers} />
          <Stat label="Classes" value={totals.classes} />
          <Stat
            label="Évaluations enregistrées"
            value={totals.assessments}
            hint={`${totals.lessons} séance${totals.lessons > 1 ? "s" : ""} déclarée${totals.lessons > 1 ? "s" : ""}`}
          />
        </div>
      </section>

      <section aria-labelledby="programme-global">
        <SectionTitle title="Avancement du programme" href="/director/programme" linkLabel="Détail par classe" />
        {!workspace.lessonsDeclared && (
          <div className="mb-4">
            <LessonsUnavailableNote />
          </div>
        )}
        <div className="grid gap-5 rounded-xl border border-border bg-white p-5 sm:p-6 lg:grid-cols-3">
          <h3 id="programme-global" className="sr-only">
            Avancement global
          </h3>
          <div className="space-y-2">
            <p className="font-medium">Programme enseigné</p>
            <Measure
              label="Référentiel déclaré traité"
              part={overall.referential.taught}
              total={overall.referential.total}
              unit="compétences (cumul)"
            />
            <p className="text-xs text-muted">
              Restant : {Math.max(0, overall.referential.total - overall.referential.taught)} compétences
              (cumul).
            </p>
          </div>
          <div className="space-y-2">
            <p className="font-medium">Programme évalué</p>
            <Measure
              label="Notions du programme officiel"
              part={overall.official.evaluated}
              total={overall.official.total}
              unit="notions (cumul)"
            />
            <Measure
              label="Référentiel évalué"
              part={overall.referential.evaluated}
              total={overall.referential.total}
              unit="compétences (cumul)"
            />
          </div>
          <div className="space-y-2">
            <p className="font-medium">Compétences documentées</p>
            <Measure
              label="Niveaux saisis"
              part={overall.documented.entered}
              total={overall.documented.expected}
              unit="niveaux"
            />
            <p className="text-xs text-muted">
              Niveaux de compétence saisis par les professeurs, rapportés à
              ceux attendus par les évaluations déjà passées.
            </p>
          </div>
        </div>
        <p className="mt-2 text-xs leading-5 text-muted">
          Cumul sur {rows.length} couple{rows.length > 1 ? "s" : ""} classe ×
          matière : une notion ou une compétence compte une fois par classe et
          par matière (deux classes de Seconde comptent deux fois le programme
          de Seconde). Le détail par classe est dans Programme.
        </p>
      </section>

      <section aria-labelledby="vigilance">
        <SectionTitle title="Points de vigilance" href="/director/alertes" linkLabel="Toutes les alertes" />
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-border bg-white p-5">
            <p className="text-sm text-ink-soft">Risque de retard</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{risky.length}</p>
            <p className="mt-1 text-xs text-muted">
              {risky.length
                ? `Classes : ${riskyClasses.join(", ")} · matières : ${riskySubjects.join(", ")}`
                : "Aucune classe × matière en risque de retard selon les séances déclarées."}
            </p>
          </div>
          <div className="rounded-xl border border-border bg-white p-5">
            <p className="text-sm text-ink-soft">Vigilance</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{watch.length}</p>
            <p className="mt-1 text-xs text-muted">
              Rythme observé entre 80 % et 100 % du rythme nécessaire.
            </p>
          </div>
          <div className="rounded-xl border border-border bg-white p-5">
            <p className="text-sm text-ink-soft">Données manquantes</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{dataAlerts}</p>
            <p className="mt-1 text-xs text-muted">
              Séances non déclarées, résultats non saisis, évaluations non
              reliées au programme.
            </p>
          </div>
        </div>
        {alerts.length > 0 && (
          <ul className="mt-4 divide-y divide-border rounded-xl border border-border bg-white">
            {alerts.slice(0, 4).map((alert, index) => (
              <li key={index}>
                <Link href={alert.href} className="flex items-start gap-3 p-4 hover:bg-paper">
                  <AlertTriangle
                    size={17}
                    aria-hidden="true"
                    className={alert.family === "risk" ? "mt-0.5 shrink-0 text-watch" : "mt-0.5 shrink-0 text-ink-soft"}
                  />
                  <span className="min-w-0 text-sm">
                    <span className="font-medium">{alert.title}</span>
                    <span className="mt-0.5 block text-ink-soft">{alert.detail}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="recentes">
        <SectionTitle title="Évaluations récentes" />
        <h3 id="recentes" className="sr-only">
          Évaluations récentes
        </h3>
        {workspace.recentAssessments.length ? (
          <ul className="divide-y divide-border rounded-xl border border-border bg-white">
            {workspace.recentAssessments.map((assessment) => (
              <li key={assessment.id}>
                <Link
                  href={`/director/classes/${assessment.classId}`}
                  className="flex flex-wrap items-center justify-between gap-3 p-4 hover:bg-paper"
                >
                  <span className="min-w-0">
                    <span className="block font-medium">{assessment.title}</span>
                    <span className="mt-0.5 block text-sm text-ink-soft">
                      {assessment.className} · {assessment.subjectName} · {formatDate(assessment.date)}
                    </span>
                  </span>
                  <span className="flex items-center gap-3 text-sm text-ink-soft">
                    Résultats saisis : {assessment.entered} / {assessment.enrolled}
                    <ArrowRight size={16} aria-hidden="true" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyNote>
            Aucune évaluation passée n’est encore enregistrée par les
            professeurs de l’établissement.
          </EmptyNote>
        )}
      </section>
    </div>
  );
}
