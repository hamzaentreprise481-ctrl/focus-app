import type { Skill } from "@/lib/types";

export const skills: Skill[] = [
  { id: "calcul-litteral", name: "Calcul littéral" },
  { id: "developpement", name: "Développement" },
  { id: "factorisation", name: "Factorisation" },
  { id: "equations", name: "Équations" },
  { id: "fonctions-affines", name: "Fonctions affines" },
  { id: "vecteurs", name: "Vecteurs" },
  { id: "reperage-plan", name: "Repérage dans le plan" },
  { id: "statistiques", name: "Statistiques" },
];

export const skillById = new Map(skills.map((s) => [s.id, s]));
