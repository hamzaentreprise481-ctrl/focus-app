"use client";
import { useSearchParams } from "next/navigation";
import { useSchoolData } from "@/lib/school-data-context";
import { DataLoadState } from "@/components/evaluations/data-load-state";
import { EvaluationEditor } from "@/components/evaluations/evaluation-editor";
export default function NouvelleEvaluationPage() {
  const params = useSearchParams();
  const { loaded, storageError } = useSchoolData();
  if (!loaded || storageError) return <DataLoadState />;
  return <EvaluationEditor initialClassId={params.get("classe") ?? undefined} />;
}
