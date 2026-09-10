import type { Evaluation, RawGrade } from "@/lib/types";

const STORAGE_KEY = "focus-demo-overlay-v1";

/** Les données ajoutées pendant la démo (par-dessus le jeu de données mocké de base). */
export interface DemoOverlay {
  evaluations: Evaluation[];
  rawGrades: RawGrade[];
}

const EMPTY_OVERLAY: DemoOverlay = { evaluations: [], rawGrades: [] };

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

export function loadOverlay(): DemoOverlay {
  if (!isBrowser()) return EMPTY_OVERLAY;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_OVERLAY;
    const parsed = JSON.parse(raw) as Partial<DemoOverlay>;
    return {
      evaluations: Array.isArray(parsed.evaluations) ? parsed.evaluations : [],
      rawGrades: Array.isArray(parsed.rawGrades) ? parsed.rawGrades : [],
    };
  } catch {
    // Stockage corrompu ou indisponible : on repart d'une démo vierge plutôt
    // que de faire planter l'application.
    return EMPTY_OVERLAY;
  }
}

export function persistOverlay(overlay: DemoOverlay): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(overlay));
  } catch {
    // Quota dépassé, navigation privée... la démo continue simplement sans
    // persistance plutôt que de bloquer l'enseignant.
  }
}
