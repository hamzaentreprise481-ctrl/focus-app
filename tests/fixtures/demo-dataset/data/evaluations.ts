import type { Evaluation } from "@/lib/types";

// 5 évaluations sur l'année, dans l'ordre chronologique.
// "important" marque une séquence charnière du programme : une absence sur
// cette évaluation laisse un vrai trou pédagogique, pas seulement une note en moins.
export const evaluations: Evaluation[] = [
  {
    id: "eval-1",
    name: "Contrôle — Calcul littéral",
    date: "2026-09-12",
    classId: "seconde-3",
    skillIds: ["calcul-litteral", "developpement"],
    important: false,
  },
  {
    id: "eval-2",
    name: "Contrôle — Fonctions",
    date: "2026-10-03",
    classId: "seconde-3",
    skillIds: ["fonctions-affines", "equations"],
    important: false,
  },
  {
    id: "eval-3",
    name: "Contrôle — Vecteurs",
    date: "2026-10-18",
    classId: "seconde-3",
    skillIds: ["vecteurs", "reperage-plan"],
    important: true,
  },
  {
    id: "eval-4",
    name: "Contrôle — Factorisation",
    date: "2026-11-15",
    classId: "seconde-3",
    skillIds: ["factorisation", "developpement"],
    important: false,
  },
  {
    id: "eval-5",
    name: "Bilan trimestriel",
    date: "2026-12-06",
    classId: "seconde-3",
    skillIds: ["vecteurs", "fonctions-affines", "equations", "statistiques"],
    important: false,
  },
];

export const evaluationById = new Map(evaluations.map((e) => [e.id, e]));

// Ordre chronologique garanti (utilisé partout où on affiche une évolution).
export const evaluationsChronological = [...evaluations].sort(
  (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
);
