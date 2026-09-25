"use client";
import { useSearchParams } from "next/navigation";
import { useSchoolData } from "@/lib/school-data-context";
import { DemoDataState } from "@/components/evaluations/demo-data-state";
import { EvaluationEditor } from "@/components/evaluations/evaluation-editor";
export default function NouvelleEvaluationPage() {
  const params = useSearchParams();
  const { loaded, storageError } = useSchoolData();
  if (!loaded || storageError) return <DemoDataState />;
  return <EvaluationEditor initialClassId={params.get("classe") ?? undefined} />;
}
