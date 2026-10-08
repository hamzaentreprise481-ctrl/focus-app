import type { EvaluationDataset, SkillLevel, StatusLevel } from "./types";
import type { StudentAnalysis } from "./analysis";

export type ObservationState = "absent" | "missing" | "skills_only" | "graded";

/** Explicit records only: a missing grade or skill is never inferred. */
export function studentEvidence(
  studentId: string,
  classId: string,
  dataset: EvaluationDataset,
) {
  const grades = new Map(
    dataset.rawGrades
      .filter((grade) => grade.studentId === studentId)
      .map((grade) => [grade.evaluationId, grade]),
  );
  return dataset.evaluations
    .filter((evaluation) => evaluation.classId === classId)
    .toSorted((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id))
    .map((evaluation) => {
      const grade = grades.get(evaluation.id);
      const levels: Partial<Record<string, SkillLevel>> = {};
      if (grade && !grade.absent) {
        for (const skillId of evaluation.skillIds) {
          const level = grade.skillLevels?.[skillId];
          if (level) levels[skillId] = level;
        }
      }
      const state: ObservationState = grade?.absent
        ? "absent"
        : grade?.score != null
          ? "graded"
          : Object.keys(levels).length > 0
            ? "skills_only"
            : "missing";
      return {
        evaluation,
        state,
        score: state === "graded" ? grade!.score : null,
        levels,
      };
    });
}

export type SkillLevelFilter = SkillLevel | "all" | "missing";

export function latestSkillLevel(analysis: StudentAnalysis, skillId: string) {
  return analysis.skillMasteries
    .find((skill) => skill.skillId === skillId)?.lastTwoLevels.at(-1) ?? null;
}

export function filterStudentRoster(
  analyses: StudentAnalysis[],
  options: {
    query: string;
    status: StatusLevel | "all";
    skillId: string;
    level: SkillLevelFilter;
  },
) {
  const normalize = (value: string) => value.trim().normalize("NFD")
    .replace(/\p{Diacritic}/gu, "").toLowerCase();
  const query = normalize(options.query);
  return analyses
    .filter((analysis) => options.status === "all" || analysis.status === options.status)
    .filter((analysis) => normalize(analysis.name).includes(query))
    .filter((analysis) => {
      if (!options.skillId || options.level === "all") return true;
      const level = latestSkillLevel(analysis, options.skillId);
      return options.level === "missing" ? level === null : level === options.level;
    })
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));
}
