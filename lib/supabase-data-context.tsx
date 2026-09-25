"use client";

import { useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { saveEvaluationAction } from "@/app/(teacher)/app/actions";
import { SchoolDataProvider } from "@/lib/school-data-context";
import type { Evaluation, RawGrade } from "@/lib/types";
import type { SupabaseSchoolData } from "@/lib/supabase-school-data";

export function SupabaseDataProvider({
  children,
  initialData,
  initialError = null,
}: {
  children: React.ReactNode;
  initialData: SupabaseSchoolData;
  initialError?: string | null;
}) {
  const router = useRouter();
  const saveEvaluation = useCallback(
    async (evaluation: Evaluation, grades: RawGrade[]) => {
      const result = await saveEvaluationAction(evaluation, grades);
      if (result.ok) router.refresh();
      return result;
    },
    [router],
  );
  const retryStorage = useCallback(() => router.refresh(), [router]);
  const value = useMemo(
    () => ({
      dataset: initialData.dataset,
      source: "supabase" as const,
      loaded: true,
      storageError: initialError,
      retryStorage,
      editableEvaluationIds: initialData.editableEvaluationIds,
      saveEvaluation,
    }),
    [initialData, initialError, retryStorage, saveEvaluation],
  );

  return <SchoolDataProvider value={value}>{children}</SchoolDataProvider>;
}
