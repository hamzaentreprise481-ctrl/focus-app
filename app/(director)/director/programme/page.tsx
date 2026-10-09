import { requireDirector } from "@/lib/auth/server";
import { loadDirectorWorkspace } from "@/lib/director/data";
import {
  EmptyNote,
  PageIntro,
  ProgrammeRowCard,
} from "@/components/director/indicators";

export default async function DirectorProgrammePage() {
  await requireDirector();
  const workspace = await loadDirectorWorkspace();

  return (
    <div className="space-y-8">
      <PageIntro title="Avancement du programme">
        Trois mesures distinctes par classe et matière. « Enseigné » compte
        les compétences du référentiel de l’établissement reliées à une séance
        déclarée par le professeur. « Évalué » compte les notions du programme
        officiel (ou, à défaut, les compétences) présentes dans une évaluation
        passée. « Documentées » compte les niveaux de compétence saisis. Une
        leçon déclarée traitée ne signifie pas que les élèves maîtrisent la
        notion.
      </PageIntro>
      <section className="rounded-xl border border-border bg-white p-5 text-sm leading-6 text-ink-soft">
        <h2 className="font-semibold text-ink">Risque de retard : méthode de calcul</h2>
        <p className="mt-1">
          Rythme observé = compétences déclarées traitées ÷ semaines écoulées
          depuis la rentrée. Rythme nécessaire = compétences restantes ÷
          semaines restantes jusqu’à la fin de l’année.{" "}
          <strong className="text-ink">Dans les temps</strong> si le rythme
          observé atteint le rythme nécessaire,{" "}
          <strong className="text-ink">vigilance</strong> à partir de 80 %,{" "}
          <strong className="text-ink">risque de retard</strong> en dessous.
          Semaines calendaires (vacances non déduites) ; aucun calcul avant 3
          semaines ; « non renseigné » quand aucune séance n’est déclarée —
          l’absence de données n’est jamais présentée comme un retard.
          {workspace.year
            ? ` Année de référence : ${workspace.year.name}.`
            : " Aucune année scolaire active n’est enregistrée : le rythme ne peut pas être calculé."}
        </p>
      </section>
      {workspace.rows.length ? (
        <div className="space-y-4">
          {workspace.rows.map((row) => (
            <ProgrammeRowCard key={row.key} row={row} />
          ))}
        </div>
      ) : (
        <EmptyNote>
          Aucune classe × matière n’est encore suivie : les affectations des
          professeurs, leurs évaluations et leurs séances alimentent cette page.
        </EmptyNote>
      )}
    </div>
  );
}
