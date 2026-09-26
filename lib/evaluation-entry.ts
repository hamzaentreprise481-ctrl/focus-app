import type { RawGrade, SkillLevel } from "@/lib/types";

export const SKILL_LEVELS: SkillLevel[] = [
  "maitrise",
  "en_cours",
  "fragile",
  "non_maitrise",
];
export interface EvaluationRow {
  scoreInput: string;
  absent: boolean;
  levels: Partial<Record<string, SkillLevel>>;
}
export const emptyRow = (): EvaluationRow => ({
  scoreInput: "",
  absent: false,
  levels: {},
});

export function validDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}

export function parseScoreInput(raw: string): {
  value: number | null;
  error: string | null;
} {
  const input = raw.trim();
  if (!input) return { value: null, error: null };
  if (!/^\d+(?:[.,]\d+)?$/.test(input))
    return { value: null, error: "Note invalide" };
  const value = Number(input.replace(",", "."));
  return Number.isFinite(value) && value >= 0 && value <= 20
    ? { value, error: null }
    : { value: null, error: "Doit être entre 0 et 20" };
}

/** Blank score means ungraded, not absent. Only explicitly selected skills survive. */
export function gradeFromRow(
  studentId: string,
  evaluationId: string,
  row: EvaluationRow,
  skillIds: string[],
): RawGrade | null {
  if (row.absent) return { studentId, evaluationId, score: null, absent: true };
  const parsed = parseScoreInput(row.scoreInput);
  if (parsed.error) throw new Error(parsed.error);
  const skillLevels = Object.fromEntries(
    skillIds.flatMap((id) => {
      const level = row.levels[id];
      return level && SKILL_LEVELS.includes(level) ? [[id, level]] : [];
    }),
  );
  if (parsed.value === null && !Object.keys(skillLevels).length) return null;
  return {
    studentId,
    evaluationId,
    score: parsed.value,
    absent: false,
    skillLevels,
  };
}
