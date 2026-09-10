"use client";

import { notFound, useParams } from "next/navigation";
import { analyzeClass } from "@/lib/analysis";
import { classById } from "@/lib/data/class-info";
import { useDemoData } from "@/lib/demo-data-context";
import { StudentRoster } from "@/components/students/student-roster";

export default function ClassRosterPage() {
  const { slug } = useParams<{ slug: string }>();
  const { dataset } = useDemoData();

  if (!classById.has(slug)) notFound();

  const { classInfo, studentAnalyses } = analyzeClass(slug, dataset);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-ink-soft">{classInfo.subject}</p>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{classInfo.name}</h1>
      </div>
      <StudentRoster analyses={studentAnalyses} />
    </div>
  );
}
