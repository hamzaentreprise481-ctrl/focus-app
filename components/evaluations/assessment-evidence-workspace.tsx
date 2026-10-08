"use client";

import { useState } from "react";
import { AssessmentDefinitionEditor } from "@/components/evaluations/assessment-definition-editor";
import { AssessmentReviewPanel } from "@/components/evaluations/assessment-review-panel";
import { StudentEvidenceEditor } from "@/components/evaluations/student-evidence-editor";
import { ScanStackImport } from "@/components/evaluations/scan-stack-import";
import { SectionNav } from "@/components/ui/page-header";

/** Subject and correction (shared), then each student's copy, then the hypotheses to decide. */
export function AssessmentEvidenceWorkspace({
  assessmentId,
  classId,
  students,
  initialStudentId,
}: {
  assessmentId: string;
  classId?: string;
  students: { id: string; name: string }[];
  initialStudentId?: string;
}) {
  const [version, setVersion] = useState(0);
  const [reviewVersion, setReviewVersion] = useState(0);
  const [scanVersion, setScanVersion] = useState(0);
  const [decisionVersion, setDecisionVersion] = useState(0);
  const [analysisAvailable, setAnalysisAvailable] = useState<boolean | null>(
    null,
  );
  return (
    <div className="space-y-6">
      <SectionNav
        label="Étapes de cette évaluation"
        items={[
          { label: "1. Sujet et corrigé", href: "#sujet" },
          { label: "2. Import PDF", href: "#scan-import" },
          { label: "3. Copies et analyse", href: "#copies" },
          ...(analysisAvailable
            ? [{ label: "4. Décisions professeur", href: "#hypotheses" }]
            : []),
          { label: "Résultats saisis", href: "#resultats" },
        ]}
      />
      <div id="sujet" className="scroll-mt-6">
        <AssessmentDefinitionEditor
          assessmentId={assessmentId}
          onSaved={() => setVersion((value) => value + 1)}
        />
      </div>
      <ScanStackImport
        assessmentId={assessmentId}
        students={students}
        onImported={() => {
          setScanVersion((value) => value + 1);
          setReviewVersion((value) => value + 1);
        }}
      />
      <StudentEvidenceEditor
        assessmentId={assessmentId}
        students={students}
        definitionVersion={version + scanVersion}
        decisionVersion={decisionVersion}
        initialStudentId={initialStudentId}
        onAnalysed={() => setReviewVersion((value) => value + 1)}
        onEvidenceSaved={() => setReviewVersion((value) => value + 1)}
        onAvailability={setAnalysisAvailable}
      />
      {analysisAvailable && (
        <AssessmentReviewPanel
          assessmentId={assessmentId}
          classId={classId}
          students={students}
          version={version + reviewVersion}
          onDecided={() => setDecisionVersion((value) => value + 1)}
        />
      )}
    </div>
  );
}
