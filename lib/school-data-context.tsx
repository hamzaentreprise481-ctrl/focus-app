"use client";
import { createContext, useContext } from "react";
import type { Evaluation, EvaluationDataset, RawGrade } from "@/lib/types";

export type SaveResult = { ok: true } | { ok: false; error: string };
export interface SchoolData {
  dataset: EvaluationDataset;
  source: "demo" | "supabase";
  loaded: boolean;
  storageError: string | null;
  retryStorage: () => void;
  editableEvaluationIds: string[];
  saveEvaluation: (evaluation: Evaluation, grades: RawGrade[]) => Promise<SaveResult>;
}
const Context = createContext<SchoolData | null>(null);
export const SchoolDataProvider = Context.Provider;
export function useSchoolData(): SchoolData {
  const data = useContext(Context);
  if (!data) throw new Error("SchoolDataProvider manquant");
  return data;
}
