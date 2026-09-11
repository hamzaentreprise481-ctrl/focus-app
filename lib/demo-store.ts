import type { Evaluation, RawGrade } from "@/lib/types";
import { validEvaluation, SKILL_LEVELS } from "@/lib/evaluation-entry";
import { classById } from "@/lib/data/class-info";
import { studentById } from "@/lib/data/students";
import { skillById } from "@/lib/data/skills";

const storageKey = (teacherId: string) => `focus-demo-overlay-v2:${teacherId}`;

/** Les données ajoutées pendant la démo (par-dessus le jeu de données mocké de base). */
export interface DemoOverlay {
  evaluations: Evaluation[];
  rawGrades: RawGrade[];
}

const EMPTY_OVERLAY: DemoOverlay = { evaluations: [], rawGrades: [] };

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

export function loadOverlay(teacherId: string): DemoOverlay {
  if (!isBrowser()) return EMPTY_OVERLAY;
  try {
    const raw = window.localStorage.getItem(storageKey(teacherId));
    if (!raw) return EMPTY_OVERLAY;
    return validateOverlay(JSON.parse(raw));
  } catch {
    throw new Error(
      "Les essais enregistrés sur cet appareil sont illisibles ou inaccessibles. Ils ont été conservés. Réessayez après avoir vérifié le stockage du navigateur.",
    );
  }
}

export function persistOverlay(overlay: DemoOverlay, teacherId: string): void {
  if (!isBrowser())
    throw new Error("Le stockage de cet appareil est indisponible.");
  validateOverlay(overlay);
  try {
    window.localStorage.setItem(storageKey(teacherId), JSON.stringify(overlay));
  } catch {
    throw new Error(
      "Enregistrement impossible sur cet appareil. Votre saisie reste affichée : libérez de l’espace ou autorisez le stockage, puis réessayez.",
    );
  }
}

export function validateOverlay(value: unknown): DemoOverlay {
  const invalid = () => {
    throw new Error("Données de démonstration invalides.");
  };
  if (!value || typeof value !== "object") return invalid();
  const data = value as DemoOverlay;
  if (!Array.isArray(data.evaluations) || !Array.isArray(data.rawGrades))
    return invalid();
  const ids = new Set<string>();
  for (const e of data.evaluations) {
    if (
      !validEvaluation(e) ||
      !classById.has(e.classId) ||
      ids.has(e.id) ||
      e.skillIds.some((id) => !skillById.has(id))
    )
      return invalid();
    ids.add(e.id);
  }
  const seen = new Set<string>();
  const rawGrades = data.rawGrades.map((g) => {
    if (!g || typeof g !== "object") return invalid();
    const e = data.evaluations.find((item) => item.id === g.evaluationId);
    if (
      !e ||
      studentById.get(g.studentId)?.classId !== e.classId ||
      typeof g.absent !== "boolean" ||
      !(
        g.score === null ||
        (typeof g.score === "number" &&
          Number.isFinite(g.score) &&
          g.score >= 0 &&
          g.score <= 20)
      ) ||
      (g.absent && g.score !== null)
    )
      return invalid();
    const key = `${g.evaluationId}:${g.studentId}`;
    if (seen.has(key)) return invalid();
    seen.add(key);
    if (
      g.skillLevels !== undefined &&
      (!g.skillLevels ||
        typeof g.skillLevels !== "object" ||
        Array.isArray(g.skillLevels))
    )
      return invalid();
    // Older demo forms retained deselected skills and blank select values.
    const skillLevels = Object.fromEntries(
      Object.entries(g.skillLevels ?? {}).filter(
        ([id, level]) => e.skillIds.includes(id) && String(level) !== "",
      ),
    );
    if (
      Object.values(skillLevels).some(
        (level) => level === undefined || !SKILL_LEVELS.includes(level),
      )
    )
      return invalid();
    return { ...g, skillLevels: g.absent ? undefined : skillLevels };
  });
  return { evaluations: data.evaluations, rawGrades };
}
