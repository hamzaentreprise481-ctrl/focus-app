import { analyzeClass, analyzeEvaluation, analyzeStudent, CONFIDENCE_LABEL, SKILL_LEVEL_LABEL } from "@/lib/analysis";
import { studentEvidence } from "@/lib/student-evidence";
import type { EvaluationDataset } from "@/lib/types";
import { formatDate, formatScore } from "@/lib/utils";

export type ReportTarget = { kind: "class" | "student" | "evaluation"; id: string };
export interface SchoolReport {
  title: string;
  subtitle: string;
  source: "demo" | "supabase";
  sections: { title: string; paragraphs: string[] }[];
}
const score = (value: number | null) => value === null ? "Aucune note" : `${formatScore(value)} / 20`;

/** Export only the requested resource, using the same snapshot as the screen. */
export function buildSchoolReport(dataset: EvaluationDataset, target: ReportTarget, source: SchoolReport["source"]): SchoolReport {
  if (target.kind === "class") {
    const { classInfo, studentAnalyses, weakestSkills } = analyzeClass(target.id, dataset);
    return {
      title: `Suivi de classe - ${classInfo.name}`,
      subtitle: `${classInfo.subject} · ${studentAnalyses.length} élèves`, source,
      sections: [
        { title: "Situation des élèves", paragraphs: studentAnalyses.map((a) => `${a.name} · ${score(a.average)}\n${a.summary}`) },
        { title: "Compétences à explorer", paragraphs: weakestSkills.length ? weakestSkills.map((s) => `${s.name} : indice ${s.percent}/100 · ${s.sampleSize} élèves documentés. Cet indice n'est pas un taux de réussite.`) : ["Aucune compétence documentée."] },
        { title: "Évaluations de la classe", paragraphs: dataset.evaluations.filter((e) => e.classId === target.id).toSorted((a, b) => b.date.localeCompare(a.date)).map((e) => `${formatDate(e.date)} · ${e.name}`) },
      ],
    };
  }
  if (target.kind === "student") {
    const a = analyzeStudent(target.id, dataset);
    const c = dataset.classes.find((item) => item.id === a.classId);
    return {
      title: `Dossier élève - ${a.name}`, subtitle: `${c?.name ?? ""} · ${c?.subject ?? ""}`, source,
      sections: [
        { title: "Synthèse pédagogique", paragraphs: [a.summary, a.narrative, `Moyenne des notes renseignées : ${score(a.average)}`] },
        { title: "Compétences observées", paragraphs: a.skillMasteries.map((s) => `${s.name} : ${s.testedCount ? SKILL_LEVEL_LABEL[s.lastTwoLevels.at(-1)!] : "Non renseigné"} · ${s.testedCount} observation(s) · ${CONFIDENCE_LABEL[s.confidence]}`) },
        { title: "Observations datées", paragraphs: studentEvidence(target.id, a.classId, dataset).map((row) => {
          const state = row.state === "absent" ? "Absent(e)" : row.state === "missing" ? "Non renseigné" : row.state === "skills_only" ? "Compétences uniquement" : score(row.score);
          const levels = row.state === "absent" ? [] : row.evaluation.skillIds.map((id) => `${dataset.skills.find((s) => s.id === id)?.name ?? id} : ${row.levels[id] ? SKILL_LEVEL_LABEL[row.levels[id]!] : "Non renseigné"}`);
          return `${formatDate(row.evaluation.date)} · ${row.evaluation.name}\n${state}${levels.length ? "\n" + levels.join(" · ") : ""}`;
        }) },
        { title: "Pistes à confirmer par le professeur", paragraphs: a.recommendedActions.length ? a.recommendedActions.map((action) => `${action.label} · durée indicative : ${action.minutes} min`) : ["Poursuivre ou compléter les observations."] },
      ],
    };
  }
  const a = analyzeEvaluation(target.id, dataset);
  const c = dataset.classes.find((item) => item.id === a.evaluation.classId);
  return {
    title: a.evaluation.name, subtitle: `${c?.name ?? ""} · ${formatDate(a.evaluation.date)}`, source,
    sections: [
      { title: "Résultats de l'évaluation", paragraphs: [`Moyenne : ${score(a.average)} · ${a.recordedCount} élèves renseignés · ${a.unrecordedCount} non renseignés.`] },
      { title: "Observations par élève", paragraphs: dataset.students.filter((s) => s.classId === a.evaluation.classId).map((s) => {
        const g = dataset.rawGrades.find((grade) => grade.studentId === s.id && grade.evaluationId === target.id);
        const label = !g ? "Non renseigné" : g.absent ? "Absent(e)" : g.score !== null ? score(g.score) : Object.keys(g.skillLevels ?? {}).length ? "Compétences uniquement" : "Non renseigné";
        const levels = g?.absent ? [] : a.evaluation.skillIds.map((id) => `${dataset.skills.find((skill) => skill.id === id)?.name ?? id} : ${g?.skillLevels?.[id] ? SKILL_LEVEL_LABEL[g.skillLevels[id]!] : "Non renseigné"}`);
        return `${s.name} · ${label}${levels.length ? "\n" + levels.join(" · ") : ""}`;
      }) },
    ],
  };
}
