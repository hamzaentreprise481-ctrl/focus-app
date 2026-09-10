import type { RawGrade, SkillLevel } from "@/lib/types";
import { evaluationsChronological } from "@/lib/data/evaluations";
import { skills } from "@/lib/data/skills";

// -----------------------------------------------------------------------------
// Données mockées : note globale ET maîtrise par compétence.
//
// Ce sont deux données SÉPARÉES. Le score /20 mesure la performance globale
// à une évaluation ; le niveau de maîtrise par compétence (`skillLevels`)
// mesure la compétence précise, saisie indépendamment par l'enseignant.
// Une compétence testée par une évaluation (`evaluation.skillIds`) mais
// absente de `skillLevels` pour un élève signifie simplement "non
// renseignée" : `lib/analysis.ts` ne la déduit JAMAIS du score, et FOCUS
// affiche alors "Données insuffisantes" plutôt que d'inventer un niveau.
//
// Pour les 10 profils "narratifs" (ceux dont la fiche démontre un cas
// précis : difficulté persistante, progression, absence...), chaque
// compétence est saisie à la main pour garder un contrôle total sur
// l'histoire. Pour les 21 élèves "stables", les niveaux sont produits par
// une petite fonction déterministe ci-dessous — utile pour peupler un jeu
// de données réaliste sans tout taper à la main — MAIS uniquement ici,
// au moment d'écrire les données mockées. Rien de comparable ne doit
// exister côté analyse : `skillLevelForGrade()` dans `lib/analysis.ts` ne
// lit jamais le score pour deviner une compétence.
// -----------------------------------------------------------------------------

interface StudentScoreInput {
  studentId: string;
  /** Notes /20 dans l'ordre chronologique des 5 évaluations. `null` = absent. */
  scores: (number | null)[];
  /** Niveaux de maîtrise saisis, indexés par évaluation puis par compétence. */
  skillLevels?: Record<string, Partial<Record<string, SkillLevel>>>;
}

// --- Profils "nécessitent une attention" -----------------------------------
const attentionProfiles: StudentScoreInput[] = [
  {
    studentId: "lucas-bernard",
    scores: [13, 12, 10.5, 9, 9.5],
    skillLevels: {
      "eval-1": { "calcul-litteral": "en_cours", developpement: "en_cours" },
      "eval-2": { "fonctions-affines": "en_cours", equations: "en_cours" },
      "eval-3": { vecteurs: "fragile", "reperage-plan": "en_cours" },
      "eval-4": { factorisation: "fragile", developpement: "en_cours" },
      "eval-5": {
        vecteurs: "non_maitrise",
        "fonctions-affines": "en_cours",
        equations: "en_cours",
        statistiques: "maitrise",
      },
    },
  },
  {
    studentId: "adam-benali",
    scores: [12, 11.5, null, 11, 10.5],
    skillLevels: {
      "eval-1": { "calcul-litteral": "en_cours", developpement: "en_cours" },
      "eval-2": { "fonctions-affines": "en_cours", equations: "en_cours" },
      // absent à eval-3 : aucune compétence renseignée ce jour-là.
      "eval-4": { factorisation: "en_cours", developpement: "en_cours" },
      "eval-5": {
        vecteurs: "fragile",
        "fonctions-affines": "en_cours",
        equations: "en_cours",
        statistiques: "en_cours",
      },
    },
  },
  {
    studentId: "lea-dubois",
    scores: [15, 13, 11.5, 9.5, 8],
    skillLevels: {
      "eval-1": { "calcul-litteral": "maitrise", developpement: "maitrise" },
      "eval-2": { "fonctions-affines": "en_cours", equations: "en_cours" },
      "eval-3": { vecteurs: "en_cours", "reperage-plan": "en_cours" },
      "eval-4": { factorisation: "fragile", developpement: "fragile" },
      "eval-5": {
        vecteurs: "fragile",
        "fonctions-affines": "fragile",
        equations: "fragile",
        statistiques: "fragile",
      },
    },
  },
];

// --- Profils "à surveiller" -------------------------------------------------
const watchProfiles: StudentScoreInput[] = [
  {
    studentId: "emma-leroy",
    scores: [8, 9, 13, 13.5, 14.5],
    skillLevels: {
      "eval-1": { "calcul-litteral": "fragile", developpement: "fragile" },
      "eval-2": { "fonctions-affines": "fragile", equations: "fragile" },
      "eval-3": { vecteurs: "en_cours", "reperage-plan": "en_cours" },
      "eval-4": { factorisation: "en_cours", developpement: "en_cours" },
      "eval-5": {
        vecteurs: "en_cours",
        "fonctions-affines": "maitrise",
        equations: "en_cours",
        statistiques: "en_cours",
      },
    },
  },
  {
    studentId: "rayan-el-amrani",
    scores: [9, 9.5, 10, 13, 14],
    skillLevels: {
      "eval-1": { "calcul-litteral": "fragile", developpement: "fragile" },
      "eval-2": { "fonctions-affines": "fragile", equations: "fragile" },
      "eval-3": { vecteurs: "fragile", "reperage-plan": "fragile" },
      "eval-4": { factorisation: "en_cours", developpement: "en_cours" },
      "eval-5": {
        vecteurs: "en_cours",
        "fonctions-affines": "en_cours",
        equations: "en_cours",
        statistiques: "en_cours",
      },
    },
  },
  {
    studentId: "theo-moreau",
    scores: [14, 8, 13, 7.5, 12.5],
    skillLevels: {
      "eval-1": { "calcul-litteral": "en_cours", developpement: "en_cours" },
      "eval-2": { "fonctions-affines": "fragile", equations: "fragile" },
      "eval-3": { vecteurs: "en_cours", "reperage-plan": "en_cours" },
      "eval-4": { factorisation: "non_maitrise", developpement: "non_maitrise" },
      "eval-5": {
        vecteurs: "en_cours",
        "fonctions-affines": "en_cours",
        equations: "en_cours",
        statistiques: "en_cours",
      },
    },
  },
  {
    studentId: "zoe-blanchard",
    scores: [7, 13, 8.5, 14, 9],
    skillLevels: {
      "eval-1": { "calcul-litteral": "non_maitrise", developpement: "non_maitrise" },
      "eval-2": { "fonctions-affines": "en_cours", equations: "en_cours" },
      "eval-3": { vecteurs: "fragile", "reperage-plan": "fragile" },
      "eval-4": { factorisation: "en_cours", developpement: "en_cours" },
      "eval-5": {
        vecteurs: "fragile",
        "fonctions-affines": "fragile",
        equations: "fragile",
        statistiques: "fragile",
      },
    },
  },
  {
    studentId: "hugo-lambert",
    scores: [13, 13.5, 5, 13, 13.5],
    skillLevels: {
      "eval-1": { "calcul-litteral": "en_cours", developpement: "en_cours" },
      "eval-2": { "fonctions-affines": "en_cours", equations: "en_cours" },
      "eval-3": { vecteurs: "non_maitrise", "reperage-plan": "non_maitrise" },
      "eval-4": { factorisation: "en_cours", developpement: "en_cours" },
      "eval-5": {
        vecteurs: "en_cours",
        "fonctions-affines": "en_cours",
        equations: "en_cours",
        statistiques: "en_cours",
      },
    },
  },
  {
    studentId: "manon-lefevre",
    scores: [14, 13, 12, 11.5, 11],
    skillLevels: {
      "eval-1": { "calcul-litteral": "en_cours", developpement: "en_cours" },
      "eval-2": { "fonctions-affines": "en_cours", equations: "en_cours" },
      "eval-3": { vecteurs: "en_cours", "reperage-plan": "en_cours" },
      "eval-4": { factorisation: "en_cours", developpement: "en_cours" },
      "eval-5": {
        vecteurs: "en_cours",
        "fonctions-affines": "en_cours",
        equations: "en_cours",
        statistiques: "en_cours",
      },
    },
  },
  {
    studentId: "noah-perrin",
    scores: [12.5, 12, 11, 10.5, 10],
    skillLevels: {
      "eval-1": { "calcul-litteral": "en_cours", developpement: "en_cours" },
      "eval-2": { "fonctions-affines": "en_cours", equations: "en_cours" },
      "eval-3": { vecteurs: "en_cours", "reperage-plan": "en_cours" },
      "eval-4": { factorisation: "fragile", developpement: "fragile" },
      "eval-5": {
        vecteurs: "fragile",
        "fonctions-affines": "fragile",
        equations: "fragile",
        statistiques: "fragile",
      },
    },
  },
];

// --- Profils stables (couverture partielle des compétences, comme un
//     enseignant qui ne détaille pas systématiquement chaque compétence
//     pour chaque élève à chaque évaluation) --------------------------------

type CoveragePattern = "A" | "B" | "C";

// 3 des 5 évaluations ont des compétences renseignées ; les 2 autres n'ont
// que la note globale — d'où, pour certaines compétences, une "Donnée
// insuffisante" ou une preuve seulement "limitée" bien réelle dans l'appli.
const COVERAGE: Record<CoveragePattern, string[]> = {
  A: ["eval-1", "eval-3", "eval-4"],
  B: ["eval-2", "eval-3", "eval-5"],
  C: ["eval-1", "eval-4", "eval-5"],
};

const skillIndex = new Map(skills.map((s, i) => [s.id, i]));

/** Bande de correspondance note → niveau, utilisée UNIQUEMENT pour générer
 *  les données mockées des profils "stables" ci-dessous — jamais à l'exécution. */
function levelFromAdjustedScore(adjusted: number): SkillLevel {
  if (adjusted >= 15) return "maitrise";
  if (adjusted >= 11) return "en_cours";
  if (adjusted >= 8) return "fragile";
  return "non_maitrise";
}

/** Écart déterministe par (élève, compétence) : évite qu'une seule note
 *  du jour ne produise le même niveau pour toutes les compétences testées
 *  à la même évaluation (fausse précision). */
function skillOffset(studentIndex: number, skillId: string): number {
  const si = skillIndex.get(skillId) ?? 0;
  return (((studentIndex * 7 + si * 11) % 7) - 3) * 0.8; // environ -2.4 à +2.4 points
}

function buildStableSkillLevels(
  studentIndex: number,
  scores: (number | null)[],
  pattern: CoveragePattern
): Record<string, Partial<Record<string, SkillLevel>>> {
  const logged = new Set(COVERAGE[pattern]);
  const result: Record<string, Partial<Record<string, SkillLevel>>> = {};
  evaluationsChronological.forEach((evaluation, index) => {
    if (!logged.has(evaluation.id)) return;
    const score = scores[index];
    if (score == null) return;
    const levels: Partial<Record<string, SkillLevel>> = {};
    evaluation.skillIds.forEach((skillId) => {
      levels[skillId] = levelFromAdjustedScore(score + skillOffset(studentIndex, skillId));
    });
    result[evaluation.id] = levels;
  });
  return result;
}

const stableRoster: { studentId: string; scores: (number | null)[]; pattern: CoveragePattern }[] = [
  { studentId: "chloe-girard", scores: [15, 15.5, 14.5, 15, 14.5], pattern: "A" },
  { studentId: "nathan-petit", scores: [11, 10.5, 11.5, 11, 10.5], pattern: "B" },
  { studentId: "sarah-cohen", scores: [16, 16.5, 15.5, 17, 16], pattern: "C" },
  { studentId: "yanis-boumaaza", scores: [9, 9.5, 8.5, 9, 9.5], pattern: "A" },
  { studentId: "camille-fontaine", scores: [13, 13.5, 12.5, 13, 13.5], pattern: "B" },
  { studentId: "ines-dupont", scores: [14, 13.5, 14.5, 14, 14.5], pattern: "C" },
  { studentId: "maxime-roux", scores: [10, 10.5, 9.5, 10, 10.5], pattern: "A" },
  { studentId: "jade-simon", scores: [12, 12.5, 11.5, 12, 12.5], pattern: "B" },
  { studentId: "enzo-faure", scores: [8.5, 9, 8, 8.5, 9], pattern: "C" },
  { studentId: "lina-rousseau", scores: [15, 14.5, 15.5, 15, 14.5], pattern: "A" },
  { studentId: "gabriel-muller", scores: [11.5, 12, 11, 11.5, 12], pattern: "B" },
  { studentId: "anais-renault", scores: [17, 16.5, 17.5, 17, 16.5], pattern: "C" },
  { studentId: "mathis-colin", scores: [9.5, 10, 9, 9.5, 10], pattern: "A" },
  { studentId: "lena-vasseur", scores: [13.5, 13, 14, 13.5, 14], pattern: "B" },
  { studentId: "ethan-marchand", scores: [10.5, 11, 10, 10.5, 11], pattern: "C" },
  { studentId: "salome-guerin", scores: [14.5, 14, 15, 14.5, 15], pattern: "A" },
  { studentId: "tom-barbier", scores: [12.5, 12, 13, 12.5, 13], pattern: "B" },
  { studentId: "yasmine-chevalier", scores: [16, 15.5, 16.5, 16, 15.5], pattern: "C" },
  { studentId: "arthur-meunier", scores: [9, 9.5, 8.5, 9, 9.5], pattern: "A" },
  { studentId: "lou-ann-robin", scores: [11, 11.5, 10.5, 11, 11.5], pattern: "B" },
  { studentId: "baptiste-noel", scores: [13, 12.5, 13.5, 13, 12.5], pattern: "C" },
];

const stableProfiles: StudentScoreInput[] = stableRoster.map((entry, index) => ({
  studentId: entry.studentId,
  scores: entry.scores,
  skillLevels: buildStableSkillLevels(index, entry.scores, entry.pattern),
}));

const allProfiles = [...attentionProfiles, ...watchProfiles, ...stableProfiles];

export const seedRawGrades: RawGrade[] = allProfiles.flatMap((profile) =>
  evaluationsChronological.map((evaluation, index) => {
    const score = profile.scores[index];
    return {
      studentId: profile.studentId,
      evaluationId: evaluation.id,
      score,
      absent: score === null,
      skillLevels: profile.skillLevels?.[evaluation.id],
    } satisfies RawGrade;
  })
);

// Alias conservé pour la compatibilité des imports existants.
export const rawGrades = seedRawGrades;
