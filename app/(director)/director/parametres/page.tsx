import { requireDirector } from "@/lib/auth/server";
import { loadDirectorWorkspace } from "@/lib/director/data";
import { MIN_ELAPSED_WEEKS, WATCH_RATIO } from "@/lib/director/metrics";
import { formatDate, PageIntro } from "@/components/director/indicators";

export default async function DirectorSettingsPage() {
  const director = await requireDirector();
  const workspace = await loadDirectorWorkspace();

  return (
    <div className="space-y-8">
      <PageIntro title="Paramètres">
        Informations de l’établissement et règles de calcul utilisées par
        FOCUS Direction. Cet espace est en lecture seule : les comptes, les
        classes et les affectations sont gérés par l’administrateur FOCUS.
      </PageIntro>
      <dl className="grid gap-4 rounded-xl border border-border bg-white p-5 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-ink-soft">Établissement</dt>
          <dd className="mt-0.5 font-medium">{workspace.school.name}</dd>
        </div>
        <div>
          <dt className="text-ink-soft">Compte de direction</dt>
          <dd className="mt-0.5 font-medium">{workspace.directorName}</dd>
          <dd className="text-ink-soft">{director.email}</dd>
        </div>
        <div>
          <dt className="text-ink-soft">Année scolaire de référence</dt>
          <dd className="mt-0.5 font-medium">
            {workspace.year
              ? `${workspace.year.name} · du ${formatDate(workspace.year.startsAt)} au ${formatDate(workspace.year.endsAt)}`
              : "Aucune année scolaire active"}
          </dd>
        </div>
        <div>
          <dt className="text-ink-soft">Date de calcul</dt>
          <dd className="mt-0.5 font-medium">{formatDate(workspace.today)}</dd>
        </div>
      </dl>
      <section className="rounded-xl border border-border bg-white p-5 text-sm leading-6 text-ink-soft">
        <h2 className="font-semibold text-ink">Règles de calcul</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Programme enseigné : compétences du référentiel de la matière reliées à au moins une séance déclarée par un professeur.</li>
          <li>Programme évalué : notions du programme officiel importé dans FOCUS (selon le niveau de la classe) présentes dans une évaluation passée ; à défaut, compétences du référentiel évaluées.</li>
          <li>Compétences documentées : niveaux saisis par les professeurs, rapportés aux niveaux attendus par les évaluations passées (élèves non absents × compétences de l’évaluation).</li>
          <li>Rythme : dans les temps si le rythme observé atteint le rythme nécessaire ; vigilance à partir de {Math.round(WATCH_RATIO * 100)} % ; risque de retard en dessous. Aucun calcul avant {MIN_ELAPSED_WEEKS} semaines ni sans séance déclarée.</li>
          <li>Les alertes de données signalent : séances non déclarées, résultats non saisis 7 jours après l’évaluation, évaluations non reliées au programme, classes sans enseignant, absence d’évaluation après 6 semaines.</li>
          <li>Aucun indicateur ne compare les enseignants entre eux ni n’utilise les notes des élèves pour les juger.</li>
        </ul>
      </section>
    </div>
  );
}
