import type {
  ClassInfo,
  ConfidenceLevel,
  Evaluation,
  EvaluationDataset,
  RawGrade,
  SkillLevel,
  StatusLevel,
  Student,
} from "@/lib/types";
// Pure analysis: every lookup uses the caller's authorized dataset.
// No fixture import, browser storage or implicit fallback belongs here.

export type PatternType =
  | "stable"
  | "donnees_insuffisantes"
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
  /** Which observation the suggestion answers (one of `evidence`). */
  because?: string;
}

/** A fact read from the teacher's entries, never an interpretation. */
export interface EvidenceItem {
  label: string;
  detail: string;
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
  /** The observations the pattern rests on (dates, scores, levels). */
  evidence: EvidenceItem[];
  /** How far the pattern can be trusted: sample size and consistency. */
  confidence: ConfidenceLevel;
  /** Evaluations with a recorded score ("Basé sur N évaluations"). */
  scoredCount: number;
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
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
};

const popStdDev = (values: number[]): number => {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
};

const round1 = (n: number) => Math.round(n * 10) / 10;

/** "12,5" — French decimal comma, one decimal at most. */
const fr = (n: number) => String(round1(n)).replace(".", ",");

/** "2026-09-25" → "25/09/2026", without depending on the runtime's locale. */
const dayOf = (date: string) => {
  const [y, m, d] = date.slice(0, 10).split("-");
  return d && m && y ? `${d}/${m}/${y}` : date;
};

const firstNameOf = (fullName: string) => fullName.split(" ")[0];

function sortedEvaluations(dataset: EvaluationDataset): Evaluation[] {
  return [...dataset.evaluations].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );
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
  limitee: "Encore peu de recul",
  moderee: "Signal à confirmer",
  forte: "Signal fiable",
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

function confidenceFor(
  testedCount: number,
  levels: SkillLevel[],
): ConfidenceLevel {
  if (testedCount <= 0) return "aucune";
  if (testedCount === 1) return "limitee";
  if (testedCount === 2) return "moderee";
  const numeric = levels.map((l) => SKILL_LEVEL_SCORE[l]);
  const spread = Math.max(...numeric) - Math.min(...numeric);
  // 3 évaluations ou plus, mais des résultats qui se contredisent encore
  // beaucoup : on ne monte pas à "preuve solide" tant que ce n'est pas cohérent.
  return spread <= 25 ? "forte" : "moderee";
}

// Lookups by key instead of scanning every grade for every (student,
// evaluation, skill): a school year of results stays fast. The index follows
// the dataset's arrays and is rebuilt as soon as one of them changes.
interface DatasetIndex {
  rawGrades: RawGrade[];
  gradeCount: number;
  students: Student[];
  studentCount: number;
  grades: Map<string, RawGrade>;
  studentById: Map<string, Student>;
}
const indexes = new WeakMap<EvaluationDataset, DatasetIndex>();

function indexOf(dataset: EvaluationDataset): DatasetIndex {
  const cached = indexes.get(dataset);
  if (
    cached &&
    cached.rawGrades === dataset.rawGrades &&
    cached.gradeCount === dataset.rawGrades.length &&
    cached.students === dataset.students &&
    cached.studentCount === dataset.students.length
  )
    return cached;
  const grades = new Map<string, RawGrade>();
  // First entry wins, as a linear search would find it.
  for (const grade of dataset.rawGrades) {
    const key = `${grade.studentId}|${grade.evaluationId}`;
    if (!grades.has(key)) grades.set(key, grade);
  }
  const studentById = new Map<string, Student>();
  for (const student of dataset.students)
    if (!studentById.has(student.id)) studentById.set(student.id, student);
  const index = {
    rawGrades: dataset.rawGrades,
    gradeCount: dataset.rawGrades.length,
    students: dataset.students,
    studentCount: dataset.students.length,
    grades,
    studentById,
  };
  indexes.set(dataset, index);
  return index;
}

function gradeFor(
  studentId: string,
  evaluationId: string,
  dataset: EvaluationDataset,
): RawGrade | undefined {
  return indexOf(dataset).grades.get(`${studentId}|${evaluationId}`);
}

function studentOf(studentId: string, dataset: EvaluationDataset) {
  return indexOf(dataset).studentById.get(studentId);
}

/**
 * Lit le niveau de maîtrise EXPLICITEMENT saisi pour une compétence donnée.
 * Ne déduit jamais rien de la note globale : si rien n'a été saisi, renvoie
 * `null`, et l'appelant doit alors traiter la donnée comme manquante.
 */
function skillLevelForGrade(
  grade: RawGrade | undefined,
  evaluation: Evaluation,
  skillId: string,
): SkillLevel | null {
  if (!grade || grade.absent) return null;
  if (!evaluation.skillIds.includes(skillId)) return null;
  return grade.skillLevels?.[skillId] ?? null;
}

// --- maîtrise des compétences, élève par élève ------------------------------

export function computeSkillMasteries(
  studentId: string,
  dataset: EvaluationDataset,
): SkillMastery[] {
  const classId = studentOf(studentId, dataset)?.classId;
  const evalsChrono = sortedEvaluations(dataset).filter(
    (e) => e.classId === classId,
  );
  return dataset.skills.map((skill) => {
    const tests: { level: SkillLevel; weight: number }[] = [];
    evalsChrono.forEach((evaluation, index) => {
      const grade = gradeFor(studentId, evaluation.id, dataset);
      const level = skillLevelForGrade(grade, evaluation, skill.id);
      if (level) tests.push({ level, weight: index + 1 });
    });

    const testedCount = tests.length;
    const percent = testedCount
      ? Math.round(
          tests.reduce(
            (sum, t) => sum + SKILL_LEVEL_SCORE[t.level] * t.weight,
            0,
          ) / tests.reduce((sum, t) => sum + t.weight, 0),
        )
      : null;

    let trend: SkillMastery["trend"] = testedCount >= 2 ? "stable" : null;
    const trendDelta =
      testedCount >= 2
        ? SKILL_LEVEL_SCORE[tests[tests.length - 1].level] -
          SKILL_LEVEL_SCORE[tests[0].level]
        : 0;
    if (trendDelta >= 15) trend = "hausse";
    else if (trendDelta <= -15) trend = "baisse";

    return {
      skillId: skill.id,
      name: skill.name,
      percent,
      testedCount,
      confidence: confidenceFor(
        testedCount,
        tests.map((t) => t.level),
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
}): {
  summary: string;
  narrative: string;
  recommendedActions: RecommendedAction[];
} {
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

  const evoText =
    evolution !== null
      ? `${evolution > 0 ? "+" : ""}${round1(evolution)}`
      : "–";
  const confidenceNote =
    weakSkillConfidence === "forte"
      ? " (signal fiable : résultats cohérents sur plusieurs évaluations)"
      : weakSkillConfidence === "moderee"
        ? " (signal encore à confirmer)"
        : "";

  switch (pattern) {
    case "donnees_insuffisantes":
      return {
        summary: "Pas assez de résultats pour décrire une évolution.",
        narrative: `Les observations disponibles pour ${firstName} ne permettent pas encore de décrire une évolution des notes. Consultez les compétences renseignées et complétez les observations avant de conclure.`,
        recommendedActions: [],
      };
    case "absence_sequence_importante":
      return {
        summary: `Absent(e) à une séquence importante${absentEvaluationName ? ` (${absentEvaluationName})` : ""} — rattrapage à envisager.`,
        narrative: `${firstName} n'a pas pu participer à « ${absentEvaluationName} », une séquence charnière du programme. Cette absence peut laisser un vrai trou dans la progression sur les notions concernées : les données sont encore limitées sur ce point. Un point de rattrapage semble utile avant de poursuivre sur la suite du programme.`,
        recommendedActions: [
          {
            label: `Proposer un temps de rattrapage sur « ${absentEvaluationName} »`,
            minutes: 20,
          },
          {
            label: "Vérifier la compréhension des notions manquées",
            minutes: 10,
          },
          { label: "Point individuel rapide en fin de cours", minutes: 5 },
        ],
      };
    case "difficulte_persistante":
      return {
        summary: `Signal de difficulté sur ${weakSkillName} (${weakSkillTestedCount ?? 2} évaluations) — à confirmer.`,
        narrative: `Les résultats disponibles suggèrent une difficulté qui persiste sur « ${weakSkillName} », observée sur les ${weakSkillTestedCount ?? 2} dernières évaluations portant sur cette compétence${confidenceNote}. Le reste des résultats de ${firstName} reste, en comparaison, plus solide — ce qui oriente vers une difficulté ciblée plutôt qu'une baisse générale. Ce signal reste à confirmer avec l'élève ; une reprise des bases sur cette notion pourrait toutefois être utile avant de poursuivre sur des exercices plus complexes.`,
        recommendedActions: [
          { label: `Revoir les bases de « ${weakSkillName} »`, minutes: 10 },
          {
            label: `Proposer 3 exercices de niveau progressif sur « ${weakSkillName} »`,
            minutes: 15,
          },
          {
            label: `Comparer avec la prochaine évaluation portant sur « ${weakSkillName} »`,
            minutes: 5,
          },
        ],
      };
    case "baisse_reguliere":
      return {
        summary: `Baisse assez régulière depuis plusieurs évaluations (évolution : ${evoText} pts) — à confirmer.`,
        narrative: `Les résultats disponibles montrent une baisse assez régulière depuis ${evolutionWindow} évaluations pour ${firstName} (évolution d'environ ${evoText} points). Cela peut traduire une difficulté qui s'installe, un contexte particulier, ou un besoin de remobilisation — un échange avec l'élève permettrait d'en cerner l'origine avant que l'écart ne se creuse.`,
        recommendedActions: [
          {
            label: "Échanger avec l'élève sur ses difficultés récentes",
            minutes: 10,
          },
          {
            label: "Proposer des exercices de consolidation ciblés",
            minutes: 15,
          },
          { label: "Suivre l'évolution à la prochaine évaluation", minutes: 5 },
        ],
      };
    case "leger_flechissement":
      return {
        summary: `Léger fléchissement à surveiller (évolution : ${evoText} pts).`,
        narrative: `Un léger fléchissement apparaît dans les résultats de ${firstName} sur les dernières évaluations (évolution d'environ ${evoText} points). Rien d'alarmant à ce stade : c'est un signal à surveiller, pas encore une tendance confirmée.`,
        recommendedActions: [
          { label: "Garder un œil sur la prochaine évaluation", minutes: 5 },
          {
            label: "Proposer un exercice de consolidation en autonomie",
            minutes: 10,
          },
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
          {
            label:
              "Consolider les acquis récents avec un exercice de renforcement",
            minutes: 10,
          },
          {
            label: "Observer si la progression se confirme à la prochaine évaluation",
            minutes: 5,
          },
        ],
      };
    case "note_ponctuelle":
      return {
        summary: `Note isolée en retrait${outlierEvaluationName ? ` (${outlierEvaluationName})` : ""} — résultats stables sinon.`,
        narrative: `${firstName} a obtenu un résultat nettement plus faible que d'habitude à « ${outlierEvaluationName} », ce qui tranche avec des résultats stables par ailleurs. Cela ressemble davantage à un incident isolé qu'à une difficulté installée, mais un point rapide avec l'élève permettrait de le confirmer.`,
        recommendedActions: [
          {
            label: "Vérifier avec l'élève le contexte de cette évaluation",
            minutes: 5,
          },
          { label: "Confirmer l'acquis avec un exercice rapide", minutes: 10 },
        ],
      };
    case "resultats_irreguliers":
      return {
        summary:
          "Résultats irréguliers, sans tendance nette — signal à observer.",
        narrative: `Les résultats de ${firstName} varient sensiblement d'une évaluation à l'autre, sans tendance nette à la hausse ou à la baisse. Cela peut traduire une méthode de travail encore irrégulière ou des facteurs ponctuels (fatigue, organisation) — un échange pourrait aider à identifier ce qui favorise ses meilleurs résultats.`,
        recommendedActions: [
          {
            label: "Identifier avec l'élève ce qui favorise ses réussites",
            minutes: 10,
          },
          { label: "Renforcer une méthode de travail régulière", minutes: 15 },
        ],
      };
    case "stable":
    default:
      return {
        summary: "Progression normale.",
        narrative: `Les résultats disponibles pour ${firstName} ne montrent pas de tendance particulière dans les évaluations renseignées. Cette lecture reste limitée aux observations disponibles.`,
        recommendedActions: [],
      };
  }
}

// --- classification d'un élève ----------------------------------------------

export function analyzeStudent(
  studentId: string,
  dataset: EvaluationDataset,
): StudentAnalysis {
  const student = studentOf(studentId, dataset);
  if (!student) throw new Error(`Élève introuvable : ${studentId}`);

  const evalsChrono = sortedEvaluations(dataset).filter(
    (e) => e.classId === student.classId,
  );
  const timeline = evalsChrono.map((evaluation) => {
    const grade = gradeFor(studentId, evaluation.id, dataset);
    return {
      evaluation,
      score: grade?.score ?? null,
      absent: grade?.absent ?? false,
    };
  });

  const present = timeline.filter(
    (t): t is { evaluation: Evaluation; score: number; absent: false } =>
      !t.absent && t.score != null,
  );
  const n = present.length;
  const average = n ? mean(present.map((p) => p.score)) : null;

  const skillMasteries = computeSkillMasteries(studentId, dataset);
  const testedSkills = skillMasteries.filter(
    (s): s is SkillMastery & { percent: number } =>
      s.testedCount > 0 && s.percent !== null,
  );
  const avgSkillPercent = testedSkills.length
    ? mean(testedSkills.map((s) => s.percent))
    : 0;

  // 1. absence à une séquence importante
  const importantAbsence = timeline.find(
    (t) => t.absent && t.evaluation.important,
  );

  // 2. tendance : baisse régulière vs léger fléchissement
  const diffs = present.slice(1).map((p, i) => p.score - present[i].score);
  // "Baisse régulière" = une tendance vraiment continue, pas un simple zig-zag
  // dont la moyenne penche vers le bas : on exige qu'aucune évaluation ne
  // remonte (à une tolérance d'arrondi près).
  const monotoneish =
    n >= 3 && diffs.length > 0 && diffs.every((d) => d <= 0.05);
  const windowStart = Math.max(0, n - 3);
  const evolutionWindow = n >= 2 ? n - windowStart : 0;
  const evolution =
    n >= 2 ? present[n - 1].score - present[windowStart].score : null;
  const markedDecline = monotoneish && evolution !== null && evolution <= -1.8;
  const mildDecline =
    monotoneish && !markedDecline && evolution !== null && evolution <= -0.8;

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
  const signs = diffs
    .map((d) => (d > 0.05 ? 1 : d < -0.05 ? -1 : 0))
    .filter((s) => s !== 0);
  const signChanges = signs.slice(1).filter((s, i) => s !== signs[i]).length;
  const irregular =
    n >= 3 &&
    stdDev >= 1.8 &&
    signChanges >= 2 &&
    !monotoneish &&
    !recentProgression;

  // 6. difficulté qui semble persister sur une compétence précise (écart
  //    significatif par rapport à la moyenne des compétences du même élève —
  //    jamais un simple seuil absolu — et au moins 2 observations explicites).
  const persistentCandidates = testedSkills
    .filter(
      (s) =>
        s.testedCount >= 2 &&
        s.percent - avgSkillPercent <= -20 &&
        s.lastTwoLevels.length === 2 &&
        s.lastTwoLevels.every((l) => l === "fragile" || l === "non_maitrise"),
    )
    .sort(
      (a, b) => a.percent - avgSkillPercent - (b.percent - avgSkillPercent),
    );
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
  } else if (n < 2) {
    pattern = "donnees_insuffisantes";
    status = "normal";
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
    evolutionWindow,
    weakSkillName: persistentSkill?.name,
    weakSkillTestedCount: persistentSkill?.testedCount,
    weakSkillConfidence: persistentSkill?.confidence,
    improvedSkillName: improvedSkill?.name,
    absentEvaluationName: importantAbsence?.evaluation.name,
    outlierEvaluationName:
      outlierIndex >= 0 ? present[outlierIndex].evaluation.name : undefined,
  });

  const weakestSkill = testedSkills.length
    ? [...testedSkills].sort((a, b) => a.percent - b.percent)[0]
    : null;

  // --- observations behind the pattern, and how far they can be trusted ---
  // Read-only: the classification above is unchanged by what follows.
  const observationsOf = (skillId: string) =>
    evalsChrono.flatMap((evaluation) => {
      const level = skillLevelForGrade(gradeFor(studentId, evaluation.id, dataset), evaluation, skillId);
      return level ? [{ evaluation, level }] : [];
    });
  const levelTrail = (skillId: string, last?: number) =>
    observationsOf(skillId)
      .slice(last ? -last : 0)
      .map((o) => `${SKILL_LEVEL_LABEL[o.level]} (« ${o.evaluation.name} », ${dayOf(o.evaluation.date)})`)
      .join(" · ");
  const absences = timeline.filter((t) => t.absent).length;
  const evidence: EvidenceItem[] = [
    {
      label: "Notes renseignées",
      detail: n
        ? `${present.map((p) => fr(p.score)).join(" → ")} (${n} évaluation${n > 1 ? "s" : ""} notée${n > 1 ? "s" : ""}${absences ? `, ${absences} absence${absences > 1 ? "s" : ""}` : ""})`
        : `Aucune note renseignée${absences ? ` (${absences} absence${absences > 1 ? "s" : ""})` : ""}.`,
    },
  ];
  const actionBecause: string[] = [];
  switch (pattern) {
    case "absence_sequence_importante":
      evidence.push({
        label: "Absence",
        detail: `« ${importantAbsence!.evaluation.name} » (${dayOf(importantAbsence!.evaluation.date)}), séquence marquée importante.`,
      });
      actionBecause.push("Absence");
      break;
    case "difficulte_persistante":
      evidence.push({ label: persistentSkill!.name, detail: levelTrail(persistentSkill!.skillId, 2) });
      evidence.push({
        label: "Comparaison",
        detail: `Indice ${persistentSkill!.percent}/100 sur « ${persistentSkill!.name} », contre ${Math.round(avgSkillPercent)}/100 en moyenne sur ses compétences renseignées.`,
      });
      actionBecause.push(persistentSkill!.name);
      break;
    case "baisse_reguliere":
    case "leger_flechissement":
      evidence.push({
        label: "Évolution",
        detail: `${fr(evolution!)} point${Math.abs(evolution!) >= 2 ? "s" : ""} sur les ${evolutionWindow} dernières évaluations notées ; aucune note ne remonte d’une évaluation à l’autre.`,
      });
      actionBecause.push("Évolution");
      break;
    case "progression_recente":
      evidence.push({
        label: "Évolution",
        detail: `Deux dernières notes : ${fr(last2[0].score)} puis ${fr(last2[1].score)}, contre une médiane de ${fr(medianEarlier)} auparavant.`,
      });
      if (improvedSkill)
        evidence.push({ label: improvedSkill.name, detail: levelTrail(improvedSkill.skillId) });
      actionBecause.push("Évolution");
      break;
    case "note_ponctuelle": {
      const outlier = present[outlierIndex];
      const others = present.filter((_, i) => i !== outlierIndex).map((p) => p.score);
      evidence.push({
        label: "Résultat isolé",
        detail: `« ${outlier.evaluation.name} » (${dayOf(outlier.evaluation.date)}) : ${fr(outlier.score)}/20, contre ${fr(mean(others))}/20 en moyenne sur ses autres évaluations.`,
      });
      actionBecause.push("Résultat isolé");
      break;
    }
    case "resultats_irreguliers":
      evidence.push({
        label: "Variabilité",
        detail: `Écart type de ${fr(stdDev)} points ; les notes changent de sens ${signChanges} fois.`,
      });
      actionBecause.push("Variabilité");
      break;
  }

  // Sample size and consistency, never the pattern's severity:
  // - without enough results there is no signal at all;
  // - a persistent difficulty inherits the reliability of its explicit
  //   competency observations;
  // - an important absence is a fact whose consequence is not yet observed;
  // - a recent change, a slight dip, a single result or results without a
  //   trend cannot be more than "to confirm";
  // - otherwise 1–2 scored evaluations = limited, 3–4 = moderate,
  //   5+ = strong; a steady decline is consistent by construction, while
  //   "no particular trend" over widely spread results stays "to confirm".
  const bySample: ConfidenceLevel = n >= 5 ? "forte" : n >= 3 ? "moderee" : n >= 1 ? "limitee" : "aucune";
  const RANK: ConfidenceLevel[] = ["aucune", "limitee", "moderee", "forte"];
  const atMost = (level: ConfidenceLevel, cap: ConfidenceLevel) =>
    RANK[Math.min(RANK.indexOf(level), RANK.indexOf(cap))];
  let confidence: ConfidenceLevel;
  if (pattern === "donnees_insuffisantes") confidence = "aucune";
  else if (pattern === "difficulte_persistante") confidence = persistentSkill!.confidence;
  else if (pattern === "absence_sequence_importante") confidence = "limitee";
  else if (
    pattern === "progression_recente" ||
    pattern === "note_ponctuelle" ||
    pattern === "resultats_irreguliers" ||
    pattern === "leger_flechissement" ||
    (pattern === "stable" && stdDev >= 1.8)
  )
    confidence = atMost(bySample, "moderee");
  else confidence = bySample;

  const tracedActions = recommendedActions.map((action) =>
    actionBecause[0] ? { ...action, because: actionBecause[0] } : action,
  );

  return {
    studentId,
    name: student.name,
    classId: student.classId,
    status,
    pattern,
    average: average !== null ? round1(average) : null,
    evolution: evolution !== null ? round1(evolution) : null,
    evolutionWindow,
    summary,
    narrative,
    recommendedActions: tracedActions,
    evidence,
    confidence,
    scoredCount: n,
    skillMasteries,
    weakestSkill,
    timeline,
  };
}

// --- agrégats classe ---------------------------------------------------------

export interface ClassOverview {
  classInfo: ClassInfo;
  studentAnalyses: StudentAnalysis[];
  counts: {
    total: number;
    normal: number;
    aSurveiller: number;
    attention: number;
  };
  weakestSkills: {
    skillId: string;
    name: string;
    percent: number;
    sampleSize: number;
  }[];
  /** Students grouped by what the teacher might do next (no ranking). */
  groups: {
    toExamine: StudentAnalysis[];
    toFollow: StudentAnalysis[];
    improving: StudentAnalysis[];
    insufficient: StudentAnalysis[];
  };
  /** Per competency, from explicit observations only. */
  skillSignals: SkillSignal[];
}

export interface SkillSignal {
  skillId: string;
  name: string;
  /** Class evaluations where at least one level was entered for it. */
  evaluationCount: number;
  /** Students with at least one explicit observation. */
  documented: number;
  /** Last observed level fragile or not mastered. */
  fragileNow: number;
  /** Last two observed levels both fragile or not mastered. */
  persistent: number;
  /** Levels rising between first and last observation. */
  improving: number;
  confidence: ConfidenceLevel;
}

export function analyzeClass(
  classId: string,
  dataset: EvaluationDataset,
): ClassOverview {
  const classInfo = dataset.classes.find((c) => c.id === classId);
  if (!classInfo) throw new Error(`Classe introuvable : ${classId}`);

  const studentAnalyses = classInfo.studentIds.map((id) =>
    analyzeStudent(id, dataset),
  );
  const counts = {
    total: studentAnalyses.length,
    normal: studentAnalyses.filter((a) => a.status === "normal").length,
    aSurveiller: studentAnalyses.filter((a) => a.status === "a_surveiller")
      .length,
    attention: studentAnalyses.filter((a) => a.status === "attention").length,
  };

  const weakestSkills = dataset.skills
    .map((skill) => {
      const percents = studentAnalyses
        .map((a) => a.skillMasteries.find((sm) => sm.skillId === skill.id))
        .filter(
          (sm): sm is SkillMastery & { percent: number } =>
            !!sm && sm.testedCount > 0 && sm.percent !== null,
        )
        .map((sm) => sm.percent);
      const percent = percents.length ? Math.round(mean(percents)) : null;
      return {
        skillId: skill.id,
        name: skill.name,
        percent,
        sampleSize: percents.length,
      };
    })
    .filter(
      (
        s,
      ): s is {
        skillId: string;
        name: string;
        percent: number;
        sampleSize: number;
      } => s.percent !== null,
    )
    .sort((a, b) => a.percent - b.percent)
    .slice(0, 4);

  const byName = (a: StudentAnalysis, b: StudentAnalysis) =>
    PATTERN_PRIORITY[a.pattern] - PATTERN_PRIORITY[b.pattern] || a.name.localeCompare(b.name, "fr");
  const improvingIds = new Set(
    studentAnalyses
      .filter(
        (a) =>
          a.pattern === "progression_recente" ||
          (a.status === "normal" &&
            a.skillMasteries.some((m) => m.trend === "hausse" && m.testedCount >= 2)),
      )
      .map((a) => a.studentId),
  );
  const groups = {
    toExamine: studentAnalyses.filter((a) => a.status === "attention").sort(byName),
    toFollow: studentAnalyses
      .filter((a) => a.status === "a_surveiller" && a.pattern !== "progression_recente")
      .sort(byName),
    improving: studentAnalyses.filter((a) => improvingIds.has(a.studentId)).sort(byName),
    insufficient: studentAnalyses.filter((a) => a.pattern === "donnees_insuffisantes").sort(byName),
  };

  const classEvaluations = dataset.evaluations.filter((e) => e.classId === classId);
  const skillSignals: SkillSignal[] = dataset.skills
    .map((skill) => {
      const masteries = studentAnalyses
        .map((a) => a.skillMasteries.find((m) => m.skillId === skill.id))
        .filter((m): m is SkillMastery => !!m && m.testedCount > 0);
      const weak = (level?: SkillLevel) => level === "fragile" || level === "non_maitrise";
      const evaluationCount = classEvaluations.filter(
        (evaluation) =>
          evaluation.skillIds.includes(skill.id) &&
          classInfo.studentIds.some((studentId) =>
            skillLevelForGrade(gradeFor(studentId, evaluation.id, dataset), evaluation, skill.id),
          ),
      ).length;
      const documented = masteries.length;
      // Class-level reliability: how many evaluations documented the
      // competency, and whether most of the class was observed.
      const confidence: ConfidenceLevel =
        evaluationCount === 0
          ? "aucune"
          : evaluationCount === 1
            ? "limitee"
            : evaluationCount >= 3 && documented * 2 >= classInfo.studentIds.length
              ? "forte"
              : "moderee";
      return {
        skillId: skill.id,
        name: skill.name,
        evaluationCount,
        documented,
        fragileNow: masteries.filter((m) => weak(m.lastTwoLevels.at(-1))).length,
        persistent: masteries.filter((m) => m.lastTwoLevels.length === 2 && m.lastTwoLevels.every(weak)).length,
        improving: masteries.filter((m) => m.trend === "hausse").length,
        confidence,
      };
    })
    .filter((signal) => signal.documented > 0)
    .sort(
      (a, b) =>
        b.persistent - a.persistent ||
        b.fragileNow / b.documented - a.fragileNow / a.documented ||
        a.name.localeCompare(b.name, "fr"),
    );

  return { classInfo, studentAnalyses, counts, weakestSkills, groups, skillSignals };
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
  donnees_insuffisantes: 100,
};

export function getAttentionFeed(
  classId: string,
  limit = 5,
  dataset: EvaluationDataset,
): StudentAnalysis[] {
  const { studentAnalyses } = analyzeClass(classId, dataset);
  const statusRank: Record<StatusLevel, number> = {
    attention: 0,
    a_surveiller: 1,
    normal: 2,
  };
  return [...studentAnalyses]
    .filter((a) => a.status !== "normal")
    .sort(
      (a, b) =>
        statusRank[a.status] - statusRank[b.status] ||
        PATTERN_PRIORITY[a.pattern] - PATTERN_PRIORITY[b.pattern],
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
  recordedCount: number;
  unrecordedCount: number;
  absentStudents: { studentId: string; name: string }[];
  distribution: { label: string; count: number }[];
  strugglingStudents: StrugglingStudent[];
  skillBreakdown: {
    skillId: string;
    name: string;
    weakPercent: number | null;
    sampleSize: number;
  }[];
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
  dataset: EvaluationDataset,
): EvaluationAnalysis {
  const evaluation = dataset.evaluations.find((e) => e.id === evaluationId);
  if (!evaluation) throw new Error(`Évaluation introuvable : ${evaluationId}`);

  const gradesForEval = dataset.rawGrades.filter(
    (g) =>
      g.evaluationId === evaluationId &&
      studentOf(g.studentId, dataset)?.classId === evaluation.classId,
  );
  const priorIds = new Set(
    dataset.evaluations
      .filter(
        (e) => e.classId === evaluation.classId && e.date < evaluation.date,
      )
      .map((e) => e.id),
  );
  const present = gradesForEval.filter(
    (g) => !g.absent && g.score != null,
  ) as (RawGrade & { score: number })[];
  const average = present.length
    ? round1(mean(present.map((g) => g.score)))
    : null;

  const distribution = DISTRIBUTION_BUCKETS.map(([min, max, label]) => ({
    label,
    count: present.filter((g) => g.score >= min && g.score < max).length,
  }));

  const absentStudents = gradesForEval
    .filter((g) => g.absent)
    .map((g) => ({
      studentId: g.studentId,
      name: studentOf(g.studentId, dataset)?.name ?? g.studentId,
    }));

  // Élèves en difficulté SUR CETTE évaluation : comparés à leur propre
  // moyenne habituelle (pas à un seuil universel du type "note < 10"), et/ou
  // à un nombre significatif de compétences fragiles ce jour-là.
  const strugglingStudents: StrugglingStudent[] = present
    .map((g) => {
      const otherScores = dataset.rawGrades
        .filter(
          (og) =>
            og.studentId === g.studentId &&
            priorIds.has(og.evaluationId) &&
            !og.absent &&
            og.score != null,
        )
        .map((og) => og.score as number);
      const baseline = otherScores.length ? mean(otherScores) : null;
      const gap = baseline !== null ? baseline - g.score : null;

      const weakSkillCount = evaluation.skillIds.filter((skillId) => {
        const level = skillLevelForGrade(g, evaluation, skillId);
        return level === "fragile" || level === "non_maitrise";
      }).length;

      let reason: string | null = null;
      if (gap !== null && gap >= 2.5) {
        reason = `en retrait de ${round1(gap)} pts par rapport à sa moyenne des évaluations antérieures`;
      } else if (weakSkillCount >= 2) {
        reason = `${weakSkillCount} compétences en difficulté sur cette évaluation`;
      } else if (gap !== null && gap >= 1.5 && weakSkillCount >= 1) {
        reason =
          "résultat en retrait, avec au moins une compétence fragile identifiée";
      }

      if (!reason) return null;
      return {
        studentId: g.studentId,
        name: studentOf(g.studentId, dataset)?.name ?? g.studentId,
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
    const weakCount = levels.filter(
      (l) => l === "fragile" || l === "non_maitrise",
    ).length;
    const weakPercent = levels.length
      ? Math.round((weakCount / levels.length) * 100)
      : null;
    return {
      skillId,
      name: dataset.skills.find((s) => s.id === skillId)?.name ?? skillId,
      weakPercent,
      sampleSize: levels.length,
    };
  });
  skillBreakdown.sort((a, b) => (b.weakPercent ?? -1) - (a.weakPercent ?? -1));

  return {
    evaluation,
    average,
    presentCount: gradesForEval.filter((g) => !g.absent).length,
    recordedCount: gradesForEval.length,
    unrecordedCount: Math.max(
      0,
      (dataset.classes.find((c) => c.id === evaluation.classId)?.studentIds.length ?? 0) -
        gradesForEval.length,
    ),
    absentStudents,
    distribution,
    strugglingStudents,
    skillBreakdown,
  };
}

export function allStudentsCount(dataset: EvaluationDataset): number {
  return dataset.students.length;
}
