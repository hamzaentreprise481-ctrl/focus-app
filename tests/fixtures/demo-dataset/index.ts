import type { EvaluationDataset } from "@/lib/types";
import { skills } from "./data/skills";
import { evaluations } from "./data/evaluations";
import { seedRawGrades } from "./data/grades";
import { students } from "./data/students";
import { classes } from "./data/class-info";

/** Explicit demo adapter. Never use as a fallback for a failed server request. */
export const defaultDataset: EvaluationDataset = {
  classes, students, skills, evaluations, rawGrades: seedRawGrades,
};
