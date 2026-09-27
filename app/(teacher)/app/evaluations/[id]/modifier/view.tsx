"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useSchoolData } from "@/lib/school-data-context";
import { EvaluationEditor } from "@/components/evaluations/evaluation-editor";
import { DataLoadState } from "@/components/evaluations/data-load-state";

export default function EditEvaluation() {
  const { id } = useParams<{ id: string }>();
  const { dataset, loaded, storageError, editableEvaluationIds } = useSchoolData();
  if (!loaded || storageError) return <DataLoadState />;
  const evaluation = dataset.evaluations.find((e) => e.id === id);
  if (!evaluation || !editableEvaluationIds.includes(id))
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">
Cette évaluation n’est pas modifiable par ce compte
        </h1>
        <p>
          Seules les évaluations dont vous êtes l’auteur peuvent être complétées ou corrigées.
        </p>
        <Link href="/app/evaluations" className="text-brand">
          Retour aux évaluations
        </Link>
      </div>
    );
  return (
    <EvaluationEditor
      key={id}
      initialEvaluation={evaluation}
      initialGrades={dataset.rawGrades.filter((g) => g.evaluationId === id)}
    />
  );
}
