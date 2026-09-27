"use client";

import { analyzeClass } from "@/lib/analysis";
import { DataLoadState } from "@/components/evaluations/data-load-state";
import { useSchoolData } from "@/lib/school-data-context";
import { StudentRoster } from "@/components/students/student-roster";

export default function ElevesPage() {
  const { dataset, loaded, storageError } = useSchoolData();
  const studentAnalyses = dataset.classes.flatMap((c) => analyzeClass(c.id, dataset).studentAnalyses);

  if (!loaded || storageError) return <DataLoadState />;

  return (
    <div className="space-y-6">
      <DataLoadState />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Élèves
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          Les élèves de vos {dataset.classes.length} classe(s), avec leur suivi pédagogique.
        </p>
      </div>
      <StudentRoster analyses={studentAnalyses} skills={dataset.skills} />
    </div>
  );
}

