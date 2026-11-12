"use client";

import { DataLoadState } from "@/components/evaluations/data-load-state";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { analyzeClass } from "@/lib/analysis";
import { useSchoolData } from "@/lib/school-data-context";
import { EmptyState } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";

export default function ClassesPage() {
  const { dataset, loaded, storageError } = useSchoolData();

  if (!loaded || storageError) return <DataLoadState />;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Classes"
        description="Ouvrez une classe pour retrouver ses évaluations et le suivi de chaque élève."
      />

      {!dataset.classes.length && (
        <EmptyState
          title="Aucune classe affectée"
          description="Contactez la personne qui vous a invité pour associer votre compte à une classe et une matière."
          action={
            <Button asChild variant="secondary">
              <Link href="/app/parametres">Voir mes affectations</Link>
            </Button>
          }
        />
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {dataset.classes.map((c) => {
          const { counts } = analyzeClass(c.id, dataset);
          return (
            <Link
              key={c.id}
              href={`/app/classes/${c.id}`}
              className="group rounded-[var(--radius-lg)] border border-border bg-surface p-5 transition-colors hover:border-border-strong hover:bg-paper"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[15px] font-semibold text-ink">{c.name}</p>
                  <p className="mt-0.5 text-sm text-ink-soft">{c.subject}</p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted transition-transform group-hover:translate-x-0.5" />
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span className="font-medium text-ink">
                  {counts.total} élèves
                </span>
                {counts.attention > 0 && (
                  <span className="text-brand">
                    {counts.attention} suivis à relire
                  </span>
                )}
                {counts.aSurveiller > 0 && (
                  <span className="text-watch">
                    {counts.aSurveiller} évolutions à contextualiser
                  </span>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
