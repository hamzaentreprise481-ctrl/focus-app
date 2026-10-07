"use client";

import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import { analyzeClass } from "@/lib/analysis";
import { formatDate } from "@/lib/utils";
import { useSchoolData } from "@/lib/school-data-context";
import { DataLoadState } from "@/components/evaluations/data-load-state";
import { ExportPdfButton } from "@/components/reports/export-pdf-button";
import { Button } from "@/components/ui/button";
import {
  Breadcrumbs,
  PageHeader,
  SectionNav,
} from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/feedback";
import { StudentRoster } from "@/components/students/student-roster";
import {
  ClassRecentEvaluations,
  ClassSkillSignals,
  ClassStudentGroups,
} from "@/components/classes/class-overview";

export default function ClassRosterPage() {
  const { slug } = useParams<{ slug: string }>();
  const { dataset, loaded, storageError } = useSchoolData();
  if (!loaded || storageError) return <DataLoadState />;
  if (!dataset.classes.some((c) => c.id === slug)) notFound();

  const overview = analyzeClass(slug, dataset);
  const { classInfo, studentAnalyses } = overview;
  const evaluations = dataset.evaluations
    .filter((e) => e.classId === slug)
    .sort((a, b) => b.date.localeCompare(a.date));
  const latest = evaluations[0];

  return (
    <div className="space-y-8">
      <DataLoadState />
      <div>
        <Breadcrumbs
          items={[
            { label: "Accueil", href: "/app" },
            { label: "Classes", href: "/app/classes" },
            { label: classInfo.name },
          ]}
        />
        <PageHeader
          title={classInfo.name}
          description={`${classInfo.subject}${classInfo.level ? ` · ${classInfo.level}` : ""} · ${classInfo.studentIds.length} élèves · ${evaluations.length} évaluations${latest ? ` · dernière le ${formatDate(latest.date)}` : ""}`}
          actions={
            <>
              <ExportPdfButton target={{ kind: "class", id: slug }} />
              <Button asChild>
                <Link
                  href={`/app/evaluations/nouvelle?classe=${encodeURIComponent(slug)}`}
                >
                  Ajouter une évaluation
                </Link>
              </Button>
            </>
          }
        />
      </div>
      <SectionNav
        label="Dans cette classe"
        items={[
          { label: "Évaluations", href: "#evaluations" },
          { label: "Points à consulter", href: "#attention-classe" },
          { label: "Élèves", href: "#eleves" },
          { label: "Compétences", href: "#competences" },
        ]}
      />
      <div id="evaluations" className="scroll-mt-6">
        <ClassRecentEvaluations overview={overview} dataset={dataset} />
      </div>
      <div id="attention-classe" className="scroll-mt-6">
        {!classInfo.studentIds.length ? (
          <EmptyState
            title="Aucun élève inscrit dans cette classe"
            description="Les inscriptions sont gérées par l’établissement. Les élèves apparaîtront ici dès leur inscription."
          />
        ) : !evaluations.length ? (
          <EmptyState
            title="Le suivi commence avec une évaluation"
            description="Ajoutez le sujet, les copies ou les résultats observés pour commencer à lire l’évolution de la classe."
          />
        ) : (
          <ClassStudentGroups overview={overview} />
        )}
      </div>
      <section
        id="eleves"
        className="scroll-mt-6"
        aria-labelledby="roster-title"
      >
        <h2 id="roster-title" className="mb-4 text-lg font-semibold">
          Tous les élèves
        </h2>
        <StudentRoster analyses={studentAnalyses} skills={dataset.skills} />
      </section>
      <div id="competences" className="scroll-mt-6 border-t border-border pt-6">
        <ClassSkillSignals overview={overview} dataset={dataset} />
      </div>
    </div>
  );
}
