import type { EvaluationDataset } from "@/lib/types";

export interface SupabaseSchoolData {
  dataset: EvaluationDataset;
  editableEvaluationIds: string[];
  /** From the teacher's own profile row; null when it has no name. */
  teacherName: string | null;
}

export const EMPTY_SUPABASE_SCHOOL_DATA: SupabaseSchoolData = {
  dataset: {
    classes: [],
    students: [],
    skills: [],
    evaluations: [],
    rawGrades: [],
  },
  editableEvaluationIds: [],
  teacherName: null,
};
