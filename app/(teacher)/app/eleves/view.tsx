"use client";

import { analyzeClass } from "@/lib/analysis";
import { useDemoData } from "@/lib/demo-data-context";
import { StudentRoster } from "@/components/students/student-roster";

export default function ElevesPage() {
  const { dataset } = useDemoData();
  const { classInfo, studentAnalyses } = analyzeClass("seconde-3", dataset);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Élèves
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          Tous les élèves de {classInfo.name}, avec leur situation actuelle en
          mathématiques.
        </p>
      </div>
      <StudentRoster analyses={studentAnalyses} />
    </div>
  );
}
