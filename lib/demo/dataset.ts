import type { EvaluationDataset } from "@/lib/types";
import { skills } from "@/lib/data/skills";
import { evaluations } from "@/lib/data/evaluations";
import { seedRawGrades } from "@/lib/data/grades";
import { students } from "@/lib/data/students";
import { classes } from "@/lib/data/class-info";

/** Explicit demo adapter. Never use as a fallback for a failed server request. */
export const defaultDataset: EvaluationDataset = {
  classes, students, skills, evaluations, rawGrades: seedRawGrades,
};
