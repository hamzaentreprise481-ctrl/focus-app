import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { requireDirector } from "@/lib/auth/server";
import {
  loadClassCompetencyDistribution,
  loadDirectorWorkspace,
  type MasteryLevel,
} from "@/lib/director/data";
import {
  EmptyNote,
  formatDate,
  PageIntro,
  ProgrammeRowCard,
  SectionTitle,
} from "@/components/director/indicators";

const LEVELS: Array<{ key: MasteryLevel; label: string }> = [
  { key: "mastered", label: "Maîtrisé" },
  { key: "developing", label: "En cours" },
  { key: "fragile", label: "Fragile" },
  { key: "not_mastered", label: "Non maîtrisé" },
];

export default async function DirectorClassPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireDirector();
  const { id } = await params;
  const workspace = await loadDirectorWorkspace();
  // Only a class of the director's own school is ever looked up.
  const classRow = workspace.classes.find((row) => row.id === id);
  if (!classRow) notFound();
  const distribution = (await loadClassCompetencyDistribution(classRow.id)) ?? [];
  const assessments = workspace.pastAssessments.filter((row) => row.classId === classRow.id).slice(0, 10);

  return (
    <div className="space-y-10">
      <div>
        <Link href="/director/classes" className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-brand">
          <ArrowLeft size={16} aria-hidden="true" />
          Classes
        </Link>
        <PageIntro title={classRow.name}>
          {classRow.level ?? "Niveau non renseigné"} · {classRow.enrolled} élève
          {classRow.enrolled > 1 ? "s" : ""} ·{" "}
          {classRow.teacherNames.join(", ") || "aucun enseignant affecté"}
        </PageIntro>
      </div>

      <section aria-labelledby="matieres">
        <SectionTitle title="Avancement par matière" />
        <h2 id="matieres" className="sr-only">Avancement par matière</h2>
        {classRow.rows.length ? (
          <div className="space-y-4">
            {classRow.rows.map((row) => (
              <ProgrammeRowCard key={row.key} row={row} showClass={false} />
            ))}
          </div>
        ) : (
          <EmptyNote>Aucune matière n’est encore suivie dans FOCUS pour cette classe.</EmptyNote>
        )}
      </section>

      <section aria-labelledby="competences">
        <SectionTitle title="Compétences évaluées" />
        <h2 id="competences" className="sr-only">Compétences évaluées</h2>
        {distribution.length ? (
          <div
            className="overflow-auto rounded-xl border border-border bg-white"
            tabIndex={0}
            role="region"
            aria-label="Niveaux saisis par compétence"
          >
            <table className="w-full min-w-[560px] text-sm">
              <caption className="sr-only">
                Nombre de niveaux saisis par compétence dans cette classe (toutes évaluations)
              </caption>
              <thead className="bg-paper text-left text-ink-soft">
                <tr>
                  <th scope="col" className="p-3 font-medium">Compétence</th>
                  {LEVELS.map((level) => (
                    <th key={level.key} scope="col" className="p-3 text-right font-medium">{level.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {distribution.map((row) => (
                  <tr key={row.competencyId}>
                    <th scope="row" className="p-3 text-left font-normal">
                      {row.name}
                      <span className="block text-xs text-muted">{row.subjectName}</span>
                    </th>
                    {LEVELS.map((level) => (
                      <td key={level.key} className="p-3 text-right tabular-nums">{row.counts[level.key]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyNote>
            Aucun niveau de compétence n’est encore saisi pour cette classe. Un
            niveau n’est jamais déduit de la note : il doit être saisi par le
            professeur.
          </EmptyNote>
        )}
        <p className="mt-2 text-xs text-muted">
          Nombre d’observations saisies, toutes évaluations confondues : ce
          n’est ni une moyenne ni un nombre d’élèves.
        </p>
      </section>

      <section aria-labelledby="evaluations">
        <SectionTitle title="Évaluations récentes" />
        <h2 id="evaluations" className="sr-only">Évaluations récentes</h2>
        {assessments.length ? (
          <ul className="divide-y divide-border rounded-xl border border-border bg-white">
            {assessments.map((assessment) => (
              <li key={assessment.id} className="flex flex-wrap justify-between gap-3 p-4 text-sm">
                <span>
                  <span className="block font-medium">{assessment.title}</span>
                  <span className="text-ink-soft">{assessment.subjectName} · {formatDate(assessment.date)}</span>
                </span>
                <span className="text-ink-soft">Résultats saisis : {assessment.entered} / {assessment.enrolled}</span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyNote>Aucune évaluation récente pour cette classe.</EmptyNote>
        )}
      </section>

      <section aria-labelledby="vigilance">
        <SectionTitle title="Points de vigilance" />
        <h2 id="vigilance" className="sr-only">Points de vigilance</h2>
        {classRow.alerts.length ? (
          <ul className="divide-y divide-border rounded-xl border border-border bg-white">
            {classRow.alerts.map((alert, index) => (
              <li key={index} className="flex items-start gap-3 p-4 text-sm">
                <AlertTriangle size={17} aria-hidden="true" className={alert.family === "risk" ? "mt-0.5 shrink-0 text-watch" : "mt-0.5 shrink-0 text-ink-soft"} />
                <span>
                  <span className="font-medium">{alert.title}</span>
                  <span className="mt-0.5 block text-ink-soft">{alert.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyNote>Aucun point de vigilance pour cette classe.</EmptyNote>
        )}
      </section>
    </div>
  );
}
