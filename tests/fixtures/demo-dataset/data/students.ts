import type { Student } from "@/lib/types";

// 31 élèves fictifs — Seconde 3. Aucune donnée réelle d'élève.
export const students: Student[] = [
  { id: "lucas-bernard", name: "Lucas Bernard", classId: "seconde-3" },
  { id: "emma-leroy", name: "Emma Leroy", classId: "seconde-3" },
  { id: "adam-benali", name: "Adam Benali", classId: "seconde-3" },
  { id: "lea-dubois", name: "Léa Dubois", classId: "seconde-3" },
  { id: "rayan-el-amrani", name: "Rayan El Amrani", classId: "seconde-3" },
  { id: "theo-moreau", name: "Théo Moreau", classId: "seconde-3" },
  { id: "zoe-blanchard", name: "Zoé Blanchard", classId: "seconde-3" },
  { id: "hugo-lambert", name: "Hugo Lambert", classId: "seconde-3" },
  { id: "manon-lefevre", name: "Manon Lefèvre", classId: "seconde-3" },
  { id: "noah-perrin", name: "Noah Perrin", classId: "seconde-3" },
  { id: "chloe-girard", name: "Chloé Girard", classId: "seconde-3" },
  { id: "nathan-petit", name: "Nathan Petit", classId: "seconde-3" },
  { id: "sarah-cohen", name: "Sarah Cohen", classId: "seconde-3" },
  { id: "yanis-boumaaza", name: "Yanis Boumaaza", classId: "seconde-3" },
  { id: "camille-fontaine", name: "Camille Fontaine", classId: "seconde-3" },
  { id: "ines-dupont", name: "Inès Dupont", classId: "seconde-3" },
  { id: "maxime-roux", name: "Maxime Roux", classId: "seconde-3" },
  { id: "jade-simon", name: "Jade Simon", classId: "seconde-3" },
  { id: "enzo-faure", name: "Enzo Faure", classId: "seconde-3" },
  { id: "lina-rousseau", name: "Lina Rousseau", classId: "seconde-3" },
  { id: "gabriel-muller", name: "Gabriel Muller", classId: "seconde-3" },
  { id: "anais-renault", name: "Anaïs Renault", classId: "seconde-3" },
  { id: "mathis-colin", name: "Mathis Colin", classId: "seconde-3" },
  { id: "lena-vasseur", name: "Léna Vasseur", classId: "seconde-3" },
  { id: "ethan-marchand", name: "Ethan Marchand", classId: "seconde-3" },
  { id: "salome-guerin", name: "Salomé Guérin", classId: "seconde-3" },
  { id: "tom-barbier", name: "Tom Barbier", classId: "seconde-3" },
  { id: "yasmine-chevalier", name: "Yasmine Chevalier", classId: "seconde-3" },
  { id: "arthur-meunier", name: "Arthur Meunier", classId: "seconde-3" },
  { id: "lou-ann-robin", name: "Lou-Ann Robin", classId: "seconde-3" },
  { id: "baptiste-noel", name: "Baptiste Noël", classId: "seconde-3" },
];

export const studentById = new Map(students.map((s) => [s.id, s]));
