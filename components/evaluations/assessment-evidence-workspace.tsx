"use client";

import { useState } from "react";
import { AssessmentDefinitionEditor } from "@/components/evaluations/assessment-definition-editor";
import { StudentEvidenceEditor } from "@/components/evaluations/student-evidence-editor";

/** Subject and correction (shared), then each student's copy. */
export function AssessmentEvidenceWorkspace({
  assessmentId,
  students,
  initialStudentId,
}: {
  assessmentId: string;
  students: { id: string; name: string }[];
  initialStudentId?: string;
}) {
  const [version, setVersion] = useState(0);
  return (
    <div className="space-y-6">
      <div id="sujet" className="scroll-mt-6">
        <AssessmentDefinitionEditor assessmentId={assessmentId} onSaved={() => setVersion((value) => value + 1)} />
      </div>
      <StudentEvidenceEditor
        assessmentId={assessmentId}
        students={students}
        definitionVersion={version}
        initialStudentId={initialStudentId}
      />
    </div>
  );
}
