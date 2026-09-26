"use client";

import { useState } from "react";
import { AssessmentDefinitionEditor } from "@/components/evaluations/assessment-definition-editor";
import { StudentEvidenceEditor } from "@/components/evaluations/student-evidence-editor";

/** Subject and correction (shared), then each student's copy. */
export function AssessmentEvidenceWorkspace({
  assessmentId,
  students,
}: {
  assessmentId: string;
  students: { id: string; name: string }[];
}) {
  const [version, setVersion] = useState(0);
  return (
    <div className="space-y-6">
      <AssessmentDefinitionEditor assessmentId={assessmentId} onSaved={() => setVersion((value) => value + 1)} />
      <StudentEvidenceEditor assessmentId={assessmentId} students={students} definitionVersion={version} />
    </div>
  );
}
