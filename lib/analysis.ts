import type { ConfidenceLevel, Evaluation, EvaluationDataset, RawGrade, SkillLevel, StatusLevel } from "@/lib/types";
import { skills, skillById } from "@/lib/data/skills";
import { evaluations as seedEvaluations } from "@/lib/data/evaluations";
import { seedRawGrades } from "@/lib/data/grades";
import { students, studentById } from "@/lib/data/students";
import { classes, classById } from "@/lib/data/class-info";

// -----------------------------------------------------------------------------
// Cette logique est volontairement locale et lisible : elle ne cherche pas à
// être une vraie IA, mais à montrer qu'une analyse utile ne se résume pas à
// "note < 10 = élève en difficulté". Elle distingue explicitement :
//   1. une mauvaise note ponctuelle isolée
//   2. une baisse régulière sur plusieurs évaluations
//   3. une difficulté qui semble persister sur une compétence précise
//   4. une progression récente après des difficultés
//   5. des résultats irréguliers, sans tendance nette
//   + un cas d'absence à une séquence pédagogique charnière
//
// Toutes les fonctions ci-dessous acceptent un `EvaluationDataset` explicite
// (évaluations + notes). Par défaut elles utilisent les données mockées
// statiques, mais l'interface "Nouvelle évaluation" peut leur passer un jeu
// de données enrichi des évaluations ajoutées en cours de démonstration
// (voir `lib/demo-data-context.tsx`) — aucune fonction ici ne lit jamais le
// score d'un élève pour DEVINER une compétence : si l'information n'a pas
// été saisie explicitement, elle est simplement absente.
// -----------------------------------------------------------------------------

export const defaultDataset: EvaluationDataset = {
  evaluations: seedEvaluations,
  rawGrades: seedRawGrades,
};

export type PatternType =
  | "stable"
  | "absence_sequence_importante"
  | "difficulte_persistante"
  | "baisse_reguliere"
  | "leger_flechissement"
  | "progression_recente"
  | "note_ponctuelle"
  | "resultats_irreguliers";

export interface SkillMastery {
  skillId: string;
  name: string;
  /** null si aucune évaluation n'a de niveau renseigné pour cette compétence. */
  percent: number | null;
  testedCount: number;
  confidence: ConfidenceLevel;
  trend: "hausse" | "stable" | "baisse" | null;
  trendDelta: number; // écart (dernier test - premier test), en points de niveau
  lastTwoLevels: SkillLevel[];
}

export interface RecommendedAction {
  label: string;
  minutes: number;
}

export interface StudentAnalysis {
  studentId: string;
  name: string;
  classId: string;
  status: StatusLevel;
  pattern: PatternType;
  average: number | null;
  evolution: number | null;
  evolutionWindow: number;
  summary: string;
  narrative: string;
  recommendedActions: RecommendedAction[];
  skillMasteries: SkillMastery[];
  weakestSkill: (SkillMastery & { percent: number }) | null;
  timeline: { evaluation: Evaluation; score: number | null; absent: boolean }[];
}

// --- petites fonctions statistiques -----------------------------------------

const mean = (values: number[]): number =>
  values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;

const median = (values: number[]): number => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

const popStdDev = (values: number[]): number => {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
};

const round1 = (n: number) => Math.round(n * 10) / 10;

const firstNameOf = (fullName: string) => fullName.split(" ")[0];

function sortedEvaluations(dataset: EvaluationDataset): Evaluation[] {
  return [...dataset.evaluations].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

// --- niveaux de compétence <-> score numérique ------------------------------

const SKILL_LEVEL_SCORE: Record<SkillLevel, number> = {
  maitrise: 92,
  en_cours: 70,
  fragile: 45,
  non_maitrise: 22,
};

export const SKILL_LEVEL_LABEL: Record<SkillLevel, string> = {
  maitrise: "Maîtrisé",
  en_cours: "En cours",
  fragile: "Fragile",
  non_maitrise: "Non maîtrisé",
};

export const CONFIDENCE_LABEL: Record<ConfidenceLevel, string> = {
  aucune: "Données insuffisantes",
  limitee: "Preuve limitée",
  moderee: "Preuve modérée",
  forte: "Preuve solide",
};

/** Suggestion de niveau à partir de la note, proposée à l'enseignant dans le
 *  formulaire de saisie — jamais utilisée côté analyse. L'enseignant reste
 *  libre de la corriger avant d'enregistrer. */
export function suggestSkillLevelFromScore(score: number): SkillLevel {
  if (score >= 15) return "maitrise";
  if (score >= 11) return "en_cours";
  if (score >= 8) return "fragile";
  return "non_maitrise";
}

function confidenceFor(testedCount: number, levels: SkillLevel[]): ConfidenceLevel {
  if (testedCount <= 0) return "aucune";
  if (testedCount === 1) return "limitee";
  if (testedCount === 2) return "moderee";
  const numeric = levels.map((l) => SKILL_LEVEL_SCORE[l]);
  const spread = Math.max(...numeric) - Math.min(...numeric);
  // 3 évaluations ou plus, mais des résultats qui se contredisent encore
  // beaucoup : on ne monte pas à "preuve solide" tant que ce n'est pas cohérent.
  return spread <= 25 ? "forte" : "moderee";
}

function gradeFor(studentId: string, evaluationId: string, dataset: EvaluationDataset): RawGrade | undefined {
  return dataset.rawGrades.find((g) => g.studentId === studentId && g.evaluationId === evaluationId);
}

/**
 * Lit le niveau de maîtrise EXPLICITEMENT saisi pour une compétence donnée.
 * Ne déduit jamais rien de la note globale : si rien n'a été saisi, renvoie
 * `null`, et l'appelant doit alors traiter la donnée comme manquante.
 */
function skillLevelForGrade(
  grade: RawGrade | undefined,
  evaluation: Evaluation,
  skillId: string
): SkillLevel | null {
  if (!grade || grade.absent || grade.score == null) return null;
  if (!evaluation.skillIds.includes(skillId)) return null;
  return grade.skillLevels?.[skillId] ?? null;
}

// --- maîtrise des compétences, élève par élève ------------------------------

export function computeSkillMasteries(studentId: string, dataset: EvaluationDataset = defaultDataset): SkillMastery[] {
  const evalsChrono = sortedEvaluations(dataset);
  return skills.map((skill) => {
    const tests: { level: SkillLevel; weight: number }[] = [];
    evalsChrono.forEach((evaluation, index) => {
      const grade = gradeFor(studentId, evaluation.id, dataset);
      const level = skillLevelForGrade(grade, evaluation, skill.id);
      if (level) tests.push({ level, weight: index + 1 });
    });

    const testedCount = tests.length;
    const percent = testedCount
      ? Math.round(
          tests.reduce((sum, t) => sum + SKILL_LEVEL_SCORE[t.level] * t.weight, 0) /
            tests.reduce((sum, t) => sum + t.weight, 0)
        )
      : null;

    let trend: SkillMastery["trend"] = testedCount >= 2 ? "stable" : null;
    const trendDelta =
      testedCount >= 2 ? SKILL_LEVEL_SCORE[tests[tests.length - 1].level] - SKILL_LEVEL_SCORE[tests[0].level] : 0;
    if (trendDelta >= 15) trend = "hausse";
    else if (trendDelta <= -15) trend = "baisse";

    return {
      skillId: skill.id,
      name: skill.name,
      percent,
      testedCount,
      confidence: confidenceFor(
        testedCount,
        tests.map((t) => t.level)
      ),
      trend,
      trendDelta,
      lastTwoLevels: tests.slice(-2).map((t) => t.level),
    };
  });
}

// --- narration + actions recommandées, par type de profil ------------------
//
// Le langage évite systématiquement les formulations catégoriques ("FOCUS
// sait que...", "cet élève est mauvais en...", "décroche"). Il présente des
// signaux à confirmer par l'enseignant, jamais des conclusions définitives.

function buildNarrative(params: {
  pattern: PatternType;
  firstName: string;
  average: number | null;
  evolution: number | null;
  evolutionWindow: number;
  weakSkillName?: string;
  weakSkillTestedCount?: number;
  weakSkillConfidence?: ConfidenceLevel;
  improvedSkillName?: string;
  absentEvaluationName?: string;
  outlierEvaluationName?: string;
}): { summary: string; narrative: string; recommendedActions: RecommendedAction[] } {
  const {
    pattern,
    firstName,
    evolution,
    evolutionWindow,
    weakSkillName,
    weakSkillTestedCount,
    weakSkillConfidence,
    improvedSkillName,
    absentEvaluationName,
    outlierEvaluationName,
  } = params;

  const evoText = evolution !== null ? `${evolution > 0 ? "+" : ""}${round1(evolution)}` : "–";
  const confidenceNote =
    weakSkillConfidence === "forte"
      ? " (preuve solide : résultats cohérents sur plusieurs évaluations)"
      : weakSkillConfidence === "moderee"
        ? " (preuve modérée pour l'instant, à confirmer)"
        : "";

  switch (pattern) {
    case "absence_sequence_importante":
      return {
        summary: `Absent(e) à une séquence importante${absentEvaluationName ? ` (${absentEvaluationName})` : ""} — rattrapage à envisager.`,
        narrative: `${firstName} n'a pas pu participer à « ${absentEvaluationName} », une séquence charnière du programme. Cette absence peut laisser un vrai trou dans la progression sur les notions concernées : les données sont encore limitées sur ce point. Un point de rattrapage semble utile avant de poursuivre sur la suite du programme.`,
        recommendedActions: [
          { label: `Proposer un temps de rattrapage sur « ${absentEvaluationName} »`, minutes: 20 },
          { label: "Vérifier la compréhension des notions manquées", minutes: 10 },
          { label: "Point individuel rapide en fin de cours", minutes: 5 },
        ],
      };
    case "difficulte_persistante":
      return {
        summary: `Signal de difficulté sur ${weakSkillName} (${weakSkillTestedCount ?? 2} évaluations) — à confirmer.`,
        narrative: `Les résultats disponibles suggèrent une difficulté qui persiste sur « ${weakSkillName} », observée sur les ${weakSkillTestedCount ?? 2} dernières évaluations portant sur cette compétence${confidenceNote}. Le reste des résultats de ${firstName} reste, en comparaison, plus solide — ce qui oriente vers une difficulté ciblée plutôt qu'une baisse générale. Ce signal reste à confirmer avec l'élève ; une reprise des bases sur cette notion pourrait toutefois être utile avant de poursuivre sur des exercices plus complexes.`,
        recommendedActions: [
          { label: `Revoir les bases de « ${weakSkillName} »`, minutes: 10 },
          { label: "Faire 3 exercices de niveau progressif", minutes: 15 },
          { label: "Vérification rapide lors du prochain cours", minutes: 5 },
        ],
      };
    case "baisse_reguliere":
      return {
        summary: `Baisse assez régulière depuis plusieurs évaluations (évolution : ${evoText} pts) — à confirmer.`,
        narrative: `Les résultats disponibles montrent une baisse assez régulière depuis ${evolutionWindow} évaluations pour ${firstName} (évolution d'environ ${evoText} points). Cela peut traduire une difficulté qui s'installe, un contexte particulier, ou un besoin de remobilisation — un échange avec l'élève permettrait d'en cerner l'origine avant que l'écart ne se creuse.`,
        recommendedActions: [
          { label: "Échanger avec l'élève sur ses difficultés récentes", minutes: 10 },
          { label: "Proposer des exercices de consolidation ciblés", minutes: 15 },
          { label: "Suivre l'évolution à la prochaine évaluation", minutes: 5 },
        ],
      };
    case "leger_flechissement":
      return {
        summary: `Léger fléchissement à surveiller (évolution : ${evoText} pts).`,
        narrative: `Un léger fléchissement apparaît dans les résultats de ${firstName} sur les dernières évaluations (évolution d'environ ${evoText} points). Rien d'alarmant à ce stade : c'est un signal à surveiller, pas encore une tendance confirmée.`,
        recommendedActions: [
          { label: "Garder un œil sur la prochaine évaluation", minutes: 5 },
          { label: "Proposer un exercice de consolidation en autonomie", minutes: 10 },
        ],
      };
    case "progression_recente":
      return {
        summary: improvedSkillName
          ? `${improvedSkillName} : progression récente après plusieurs difficultés.`
          : "Progression récente après plusieurs difficultés.",
        narrative: `Les résultats disponibles suggèrent une nette progression de ${firstName} depuis les deux dernières évaluations, après une période plus difficile${improvedSkillName ? ` — c'est particulièrement visible sur « ${improvedSkillName} »` : ""}. Ce résultat mérite d'être valorisé auprès de l'élève ; encore récent, il gagnerait à être confirmé sur la prochaine évaluation.`,
        recommendedActions: [
          { label: "Valoriser les progrès auprès de l'élève", minutes: 5 },
          { label: "Consolider les acquis récents avec un exercice de renforcement", minutes: 10 },
        ],
      };
    case "note_ponctuelle":
      return {
        summary: `Note isolée en retrait${outlierEvaluationName ? ` (${outlierEvaluationName})` : ""} — résultats stables sinon.`,
        narrative: `${firstName} a obtenu un résultat nettement plus faible que d'habitude à « ${outlierEvaluationName} », ce qui tranche avec des résultats stables par ailleurs. Cela ressemble davantage à un incident isolé qu'à une difficulté installée, mais un point rapide avec l'élève permettrait de le confirmer.`,
        recommendedActions: [
          { label: "Vérifier avec l'élève le contexte de cette évaluation", minutes: 5 },
          { label: "Confirmer l'acquis avec un exercice rapide", minutes: 10 },
        ],
      };
    case "resultats_irreguliers":
      return {
        summary: "Résultats irréguliers, sans tendance nette — signal à observer.",
        narrative: `Les résultats de ${firstName} varient sensiblement d'une évaluation à l'autre, sans tendance nette à la hausse ou à la baisse. Cela peut traduire une méthode de travail encore irrégulière ou des facteurs ponctuels (fatigue, organisation) — un échange pourrait aider à identifier ce qui favorise ses meilleurs résultats.`,
        recommendedActions: [
          { label: "Identifier avec l'élève ce qui favorise ses réussites", minutes: 10 },
          { label: "Renforcer une méthode de travail régulière", minutes: 15 },
        ],
      };
    case "stable":
    default:
      return {
        summary: "Progression normale.",
        narrative: `Les résultats disponibles pour ${firstName} sont réguliers depuis le début de l'année, sans signal particulier à ce stade.`,
        recommendedActions: [],
      };
  }
}

// --- classification d'un élève ----------------------------------------------

export function analyzeStudent(studentId: string, dataset: EvaluationDataset = defaultDataset): StudentAnalysis {
  const student = studentById.get(studentId);
  if (!student) throw new Error(`Élève introuvable : ${studentId}`);

  const evalsChrono = sortedEvaluations(dataset);
  const timeline = evalsChrono.map((evaluation) => {
    const grade = gradeFor(studentId, evaluation.id, dataset);
    return { evaluation, score: grade?.score ?? null, absent: grade?.absent ?? false };
  });

  const present = timeline.filter(
    (t): t is { evaluation: Evaluation; score: number; absent: false } => !t.absent && t.score != null
  );
  const n = present.length;
  const average = n ? mean(present.map((p) => p.score)) : null;

  const skillMasteries = computeSkillMasteries(studentId, dataset);
  const testedSkills = skillMasteries.filter(
    (s): s is SkillMastery & { percent: number } => s.testedCount > 0 && s.percent !== null
  );
  const avgSkillPercent = testedSkills.length ? mean(testedSkills.map((s) => s.percent)) : 0;

  // 1. absence à une séquence importante
  const importantAbsence = timeline.find((t) => t.absent && t.evaluation.important);

  // 2. tendance : baisse régulière vs léger fléchissement
  const diffs = present.slice(1).map((p, i) => p.score - present[i].score);
  // "Baisse régulière" = une tendance vraiment continue, pas un simple zig-zag
  // dont la moyenne penche vers le bas : on exige qu'aucune évaluation ne
  // remonte (à une tolérance d'arrondi près).
  const monotoneish = n >= 3 && diffs.length > 0 && diffs.every((d) => d <= 0.05);
  const windowStart = Math.max(0, n - 3);
  const evolutionWindow = n - windowStart - 1;
  const evolution = n >= 2 ? present[n - 1].score - present[windowStart].score : null;
  const markedDecline = monotoneish && evolution !== null && evolution <= -1.8;
  const mildDecline = monotoneish && !markedDecline && evolution !== null && evolution <= -0.8;

  // 3. progression récente
  const last2 = present.slice(-2);
  const earlier = present.slice(0, -2);
  const medianEarlier = median(earlier.map((p) => p.score));
  const recentProgression =
    last2.length === 2 &&
    earlier.length >= 1 &&
    last2[1].score > last2[0].score &&
    mean(last2.map((p) => p.score)) - medianEarlier >= 1.5;

  // 4. note ponctuelle isolée
  let outlierIndex = -1;
  const values = present.map((p) => p.score);
  values.forEach((_, i) => {
    const rest = values.filter((_, j) => j !== i);
    if (!rest.length) return;
    const gap = mean(rest) - values[i];
    if (gap >= 3 && popStdDev(rest) <= 1.5) outlierIndex = i;
  });
  const isSingleBad = outlierIndex >= 0 && !monotoneish;

  // 5. résultats irréguliers
  const stdDev = popStdDev(values);
  const signs = diffs.map((d) => (d > 0.05 ? 1 : d < -0.05 ? -1 : 0)).filter((s) => s !== 0);
  const signChanges = signs.slice(1).filter((s, i) => s !== signs[i]).length;
  const irregular = n >= 3 && stdDev >= 1.8 && signChanges >= 2 && !monotoneish && !recentProgression;

  // 6. difficulté qui semble persister sur une compétence précise (écart
  //    significatif par rapport à la moyenne des compétences du même élève —
  //    jamais un simple seuil absolu — et au moins 2 observations explicites).
  const persistentCandidates = testedSkills
    .filter(
      (s) =>
        s.testedCount >= 2 &&
        s.percent - avgSkillPercent <= -20 &&
        s.lastTwoLevels.length === 2 &&
        s.lastTwoLevels.every((l) => l === "fragile" || l === "non_maitrise")
    )
    .sort((a, b) => a.percent - avgSkillPercent - (b.percent - avgSkillPercent));
  const persistentSkill = persistentCandidates[0];

  // --- décision finale, par ordre de priorité pédagogique ---
  let pattern: PatternType;
  let status: StatusLevel;
  if (importantAbsence) {
    pattern = "absence_sequence_importante";
    status = "attention";
  } else if (persistentSkill) {
    pattern = "difficulte_persistante";
    status = "attention";
  } else if (markedDecline) {
    pattern = "baisse_reguliere";
    status = "attention";
  } else if (mildDecline) {
    pattern = "leger_flechissement";
    status = "a_surveiller";
  } else if (recentProgression) {
    pattern = "progression_recente";
    status = "a_surveiller";
  } else if (isSingleBad) {
    pattern = "note_ponctuelle";
    status = "a_surveiller";
  } else if (irregular) {
    pattern = "resultats_irreguliers";
    status = "a_surveiller";
  } else {
    pattern = "stable";
    status = "normal";
  }

  const improvedSkill = [...testedSkills]
    .filter((s) => s.trend === "hausse")
    .sort((a, b) => b.trendDelta - a.trendDelta)[0];

  const { summary, narrative, recommendedActions } = buildNarrative({
    pattern,
    firstName: firstNameOf(student.name),
    average,
    evolution,
    evolutionWindow: evolutionWindow || 2,
    weakSkillName: persistentSkill?.name,
    weakSkillTestedCount: persistentSkill?.testedCount,
    weakSkillConfidence: persistentSkill?.confidence,
    improvedSkillName: improvedSkill?.name,
    absentEvaluationName: importantAbsence?.evaluation.name,
    outlierEvaluationName: outlierIndex >= 0 ? present[outlierIndex].evaluation.name : undefined,
  });

  const weakestSkill = testedSkills.length ? [...testedSkills].sort((a, b) => a.percent - b.percent)[0] : null;

  return {
    studentId,
    name: student.name,
    classId: student.classId,
    status,
    pattern,
    average: average !== null ? round1(average) : null,
    evolution: evolution !== null ? round1(evolution) : null,
    evolutionWindow: evolutionWindow || 2,
    summary,
    narrative,
    recommendedActions,
    skillMasteries,
    weakestSkill,
    timeline,
  };
}

// --- agrégats classe ---------------------------------------------------------

export interface ClassOverview {
  classInfo: (typeof classes)[number];
  studentAnalyses: StudentAnalysis[];
  counts: { total: number; normal: number; aSurveiller: number; attention: number };
  weakestSkills: { skillId: string; name: string; percent: number; sampleSize: number }[];
}

export function analyzeClass(classId: string, dataset: EvaluationDataset = defaultDataset): ClassOverview {
  const classInfo = classById.get(classId);
  if (!classInfo) throw new Error(`Classe introuvable : ${classId}`);

  const studentAnalyses = classInfo.studentIds.map((id) => analyzeStudent(id, dataset));
  const counts = {
    total: studentAnalyses.length,
    normal: studentAnalyses.filter((a) => a.status === "normal").length,
    aSurveiller: studentAnalyses.filter((a) => a.status === "a_surveiller").length,
    attention: studentAnalyses.filter((a) => a.status === "attention").length,
  };

  const weakestSkills = skills
    .map((skill) => {
      const percents = studentAnalyses
        .map((a) => a.skillMasteries.find((sm) => sm.skillId === skill.id))
        .filter((sm): sm is SkillMastery & { percent: number } => !!sm && sm.testedCount > 0 && sm.percent !== null)
        .map((sm) => sm.percent);
      const percent = percents.length ? Math.round(mean(percents)) : null;
      return { skillId: skill.id, name: skill.name, percent, sampleSize: percents.length };
    })
    .filter((s): s is { skillId: string; name: string; percent: number; sampleSize: number } => s.percent !== null)
    .sort((a, b) => a.percent - b.percent)
    .slice(0, 4);

  return { classInfo, studentAnalyses, counts, weakestSkills };
}

const PATTERN_PRIORITY: Record<PatternType, number> = {
  absence_sequence_importante: 0,
  difficulte_persistante: 1,
  baisse_reguliere: 2,
  progression_recente: 3,
  leger_flechissement: 4,
  note_ponctuelle: 5,
  resultats_irreguliers: 6,
  stable: 99,
};

export function getAttentionFeed(
  classId: string,
  limit = 5,
  dataset: EvaluationDataset = defaultDataset
): StudentAnalysis[] {
  const { studentAnalyses } = analyzeClass(classId, dataset);
  const statusRank: Record<StatusLevel, number> = { attention: 0, a_surveiller: 1, normal: 2 };
  return [...studentAnalyses]
    .filter((a) => a.status !== "normal")
    .sort(
      (a, b) =>
        statusRank[a.status] - statusRank[b.status] || PATTERN_PRIORITY[a.pattern] - PATTERN_PRIORITY[b.pattern]
    )
    .slice(0, limit);
}

// --- analyse d'une évaluation ------------------------------------------------

export interface StrugglingStudent {
  studentId: string;
  name: string;
  score: number;
  reason: string;
}

export interface EvaluationAnalysis {
  evaluation: Evaluation;
  average: number | null;
  presentCount: number;
  absentStudents: { studentId: string; name: string }[];
  distribution: { label: string; count: number }[];
  strugglingStudents: StrugglingStudent[];
  skillBreakdown: { skillId: string; name: string; weakPercent: number | null; sampleSize: number }[];
}

const DISTRIBUTION_BUCKETS: [number, number, string][] = [
  [0, 8, "0 – 8"],
  [8, 10, "8 – 10"],
  [10, 12, "10 – 12"],
  [12, 14, "12 – 14"],
  [14, 16, "14 – 16"],
  [16, 20.01, "16 – 20"],
];

export function analyzeEvaluation(
  evaluationId: string,
  dataset: EvaluationDataset = defaultDataset
): EvaluationAnalysis {
  const evaluation = dataset.evaluations.find((e) => e.id === evaluationId);
  if (!evaluation) throw new Error(`Évaluation introuvable : ${evaluationId}`);

  const gradesForEval = dataset.rawGrades.filter((g) => g.evaluationId === evaluationId);
  const present = gradesForEval.filter((g) => !g.absent && g.score != null) as (RawGrade & { score: number })[];
  const average = present.length ? round1(mean(present.map((g) => g.score))) : null;

  const distribution = DISTRIBUTION_BUCKETS.map(([min, max, label]) => ({
    label,
    count: present.filter((g) => g.score >= min && g.score < max).length,
  }));

  const absentStudents = gradesForEval
    .filter((g) => g.absent)
    .map((g) => ({ studentId: g.studentId, name: studentById.get(g.studentId)?.name ?? g.studentId }));

  // Élèves en difficulté SUR CETTE évaluation : comparés à leur propre
  // moyenne habituelle (pas à un seuil universel du type "note < 10"), et/ou
  // à un nombre significatif de compétences fragiles ce jour-là.
  const strugglingStudents: StrugglingStudent[] = present
    .map((g) => {
      const otherScores = dataset.rawGrades
        .filter((og) => og.studentId === g.studentId && og.evaluationId !== evaluationId && !og.absent && og.score != null)
        .map((og) => og.score as number);
      const baseline = otherScores.length ? mean(otherScores) : null;
      const gap = baseline !== null ? baseline - g.score : null;

      const weakSkillCount = evaluation.skillIds.filter((skillId) => {
        const level = skillLevelForGrade(g, evaluation, skillId);
        return level === "fragile" || level === "non_maitrise";
      }).length;

      let reason: string | null = null;
      if (gap !== null && gap >= 2.5) {
        reason = `en retrait de ${round1(gap)} pts par rapport à sa moyenne habituelle`;
      } else if (weakSkillCount >= 2) {
        reason = `${weakSkillCount} compétences en difficulté sur cette évaluation`;
      } else if (gap !== null && gap >= 1.5 && weakSkillCount >= 1) {
        reason = "résultat en retrait, avec au moins une compétence fragile identifiée";
      }

      if (!reason) return null;
      return {
        studentId: g.studentId,
        name: studentById.get(g.studentId)?.name ?? g.studentId,
        score: g.score,
        reason,
      } satisfies StrugglingStudent;
    })
    .filter((s): s is StrugglingStudent => s !== null)
    .sort((a, b) => a.score - b.score);

  const skillBreakdown = evaluation.skillIds.map((skillId) => {
    const levels = gradesForEval
      .map((g) => skillLevelForGrade(g, evaluation, skillId))
      .filter((l): l is SkillLevel => !!l);
    const weakCount = levels.filter((l) => l === "fragile" || l === "non_maitrise").length;
    const weakPercent = levels.length ? Math.round((weakCount / levels.length) * 100) : null;
    return { skillId, name: skillById.get(skillId)?.name ?? skillId, weakPercent, sampleSize: levels.length };
  });
  skillBreakdown.sort((a, b) => (b.weakPercent ?? -1) - (a.weakPercent ?? -1));

  return {
    evaluation,
    average,
    presentCount: present.length,
    absentStudents,
    distribution,
    strugglingStudents,
    skillBreakdown,
  };
}

export function allStudentsCount(): number {
  return students.length;
}
