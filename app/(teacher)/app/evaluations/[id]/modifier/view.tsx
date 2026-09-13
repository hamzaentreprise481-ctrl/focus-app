"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useDemoData } from "@/lib/demo-data-context";
import { EvaluationEditor } from "@/components/evaluations/evaluation-editor";
import { DemoDataState } from "@/components/evaluations/demo-data-state";

export default function EditEvaluation() {
  const { id } = useParams<{ id: string }>();
  const { dataset, loaded, storageError, addedEvaluationIds } = useDemoData();
  if (!loaded || storageError) return <DemoDataState />;
  const evaluation = dataset.evaluations.find((e) => e.id === id);
  if (!evaluation || !addedEvaluationIds.includes(id))
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">
          Cet essai n’est pas modifiable ici
        </h1>
        <p>
          Vous pouvez compléter les évaluations que vous avez créées sur cet
          appareil.
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
