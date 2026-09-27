"use client";
import { ExportPdfButton } from "@/components/reports/export-pdf-button";

import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import { formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { analyzeClass } from "@/lib/analysis";
import { DataLoadState } from "@/components/evaluations/data-load-state";
import { useSchoolData } from "@/lib/school-data-context";
import { StudentRoster } from "@/components/students/student-roster";

export default function ClassRosterPage() {
  const { slug } = useParams<{ slug: string }>();
  const { dataset, loaded, storageError } = useSchoolData();

  if (!loaded || storageError) return <DataLoadState />;
  if (!dataset.classes.some((c) => c.id === slug)) notFound();

  const { classInfo, studentAnalyses, weakestSkills } = analyzeClass(
    slug,
    dataset,
  );


  return (
    <div className="space-y-6">
      <DataLoadState />
      <div>
        <p className="text-sm text-ink-soft">{classInfo.subject}</p>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          {classInfo.name}
        </h1>
      </div>
      <ExportPdfButton target={{ kind: "class", id: slug }} />
      <nav
        aria-label="Dans cette classe"
        className="flex flex-wrap items-center gap-4 text-sm"
      >
        <a href="#eleves" className="text-brand">
          Élèves
        </a>
        <a href="#evaluations" className="text-brand">
          Évaluations
        </a>
        <a href="#competences" className="text-brand">
          Compétences
        </a>
        <Button asChild variant="secondary">
          <Link href={`/app/evaluations/nouvelle?classe=${encodeURIComponent(slug)}`}>Ajouter une évaluation</Link>
        </Button>
      </nav>
      <section id="eleves" className="scroll-mt-5">
        <h2 className="mb-4 text-lg font-semibold">Élèves</h2>
        <StudentRoster analyses={studentAnalyses} skills={dataset.skills} />
      </section>
      <section
        id="evaluations"
        className="scroll-mt-5 border-t border-border pt-6"
      >
        <h2 className="text-lg font-semibold">Évaluations de la classe</h2>
        <ul className="mt-4 divide-y divide-border">
          {dataset.evaluations
            .filter((e) => e.classId === slug)
            .sort((a, b) => b.date.localeCompare(a.date))
            .map((e) => (
              <li key={e.id}>
                <Link
                  href={`/app/evaluations/${e.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
                >
                  <span className="font-medium">{e.name}</span>
                  <span className="text-ink-soft">{formatDate(e.date)} →</span>
                </Link>
              </li>
            ))}
        </ul>
      </section>
      <section
        id="competences"
        className="scroll-mt-5 border-t border-border pt-6"
      >
        <h2 className="text-lg font-semibold">Compétences à explorer</h2>
        <p className="mt-2 text-sm text-ink-soft">
          Synthèse des niveaux explicitement renseignés. Ces indices ne sont pas
          des taux de réussite mesurés.
        </p>
        <ul className="mt-4 divide-y divide-border">
          {weakestSkills.map((s) => (
            <li
              key={s.skillId}
              className="flex flex-wrap justify-between gap-3 py-3 text-sm"
            >
              <span>{s.name}</span>
              <span className="text-ink-soft">
                Indice {s.percent}/100 · {s.sampleSize} élèves documentés
              </span>
            </li>
          ))}
        </ul>
        {!weakestSkills.length && (
          <p className="mt-3 text-sm text-ink-soft">
            Renseignez des compétences lors d’une évaluation pour les retrouver
            ici.
          </p>
        )}
      </section>
    </div>
  );
}

