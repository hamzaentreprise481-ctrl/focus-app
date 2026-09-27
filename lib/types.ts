// Types du domaine FOCUS, indépendants de la source de données.

export type StatusLevel = "normal" | "a_surveiller" | "attention";

export type SkillLevel = "maitrise" | "en_cours" | "fragile" | "non_maitrise";

export type ConfidenceLevel = "aucune" | "limitee" | "moderee" | "forte";

export interface Skill {
  id: string;
  name: string;
}

export interface ClassInfo {
  id: string;
  name: string;
  level: string;
  subject: string;
  subjectId?: string;
  schoolId?: string;
  teacher: string;
  studentIds: string[];
}

export interface Student {
  id: string;
  name: string;
  classId: string;
}

export interface Evaluation {
  id: string;
  name: string;
  date: string;
  classId: string;
  skillIds: string[];
  /** Séquence jugée charnière dans la progression. */
  important: boolean;
}

export interface RawGrade {
  studentId: string;
  evaluationId: string;
  score: number | null;
  absent: boolean;
  skillLevels?: Partial<Record<string, SkillLevel>>;
}

export interface EvaluationDataset {
  classes: ClassInfo[];
  students: Student[];
  skills: Skill[];
  evaluations: Evaluation[];
  rawGrades: RawGrade[];
}
