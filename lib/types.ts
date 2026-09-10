// Types du domaine FOCUS — V0 (données mockées, mathématiques uniquement)

export type StatusLevel = "normal" | "a_surveiller" | "attention";

export type SkillLevel = "maitrise" | "en_cours" | "fragile" | "non_maitrise";

/**
 * Niveau de preuve disponible pour une compétence donnée d'un élève.
 * Sert à ne jamais présenter une conclusion comme certaine quand elle
 * repose sur une seule observation.
 */
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
  date: string; // ISO
  classId: string;
  skillIds: string[];
  /** Séquence jugée charnière dans la progression (utilisée pour détecter les absences à fort impact). */
  important: boolean;
}

/**
 * Une note brute d'élève pour une évaluation, avant analyse.
 *
 * IMPORTANT : `skillLevels` est la SEULE source de vérité pour la maîtrise
 * par compétence. Une compétence testée par l'évaluation (`evaluation.skillIds`)
 * mais absente de `skillLevels` signifie "non renseignée" — elle ne doit
 * JAMAIS être déduite de `score`. Deux compétences testées le même jour
 * peuvent avoir des niveaux de maîtrise différents, même si la note globale
 * est unique : le score et la maîtrise par compétence sont deux données
 * distinctes, saisies séparément par l'enseignant.
 */
export interface RawGrade {
  studentId: string;
  evaluationId: string;
  score: number | null; // null si absent
  absent: boolean;
  skillLevels?: Partial<Record<string, SkillLevel>>;
}

/** L'ensemble des données (évaluations + notes) sur lesquelles portent les analyses. */
export interface EvaluationDataset {
  evaluations: Evaluation[];
  rawGrades: RawGrade[];
}
