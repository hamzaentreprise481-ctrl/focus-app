import { analyzeClass, analyzeEvaluation, analyzeStudent, CONFIDENCE_LABEL, SKILL_LEVEL_LABEL } from "@/lib/analysis";
import { studentEvidence } from "@/lib/student-evidence";
import type { PedagogicalConfidence, PedagogicalSnapshot } from "@/lib/pedagogy/types";
import type { EvaluationDataset } from "@/lib/types";
import { formatDate, formatScore } from "@/lib/utils";

export type ReportTarget = { kind: "class" | "student" | "evaluation"; id: string };
export interface SchoolReport {
  title: string;
  subtitle: string;
  sections: { title: string; paragraphs: string[] }[];
}
const score = (value: number | null) => value === null ? "Aucune note" : `${formatScore(value)} / 20`;

/** The student's copy analyses, as loaded for the export (or why they are missing). */
export type ReportPedagogy = { ok: true; snapshot: PedagogicalSnapshot } | { ok: false; error: string };

const PDF_CONFIDENCE: Record<PedagogicalConfidence, string> = {
  limitee: "confiance limitée (une seule observation)",
  moderee: "confiance modérée (observation répétée)",
  forte: "confiance forte (répétée et déjà confirmée)",
};

/**
 * Only observations the teacher confirmed are reported. Undecided AI
 * hypotheses are counted, never presented as findings; dismissed and
 * superseded ones are left out.
 */
function confirmedObservations(pedagogy: ReportPedagogy) {
  if (!pedagogy.ok) return [`Suivi des copies non inclus : ${pedagogy.error}`];
  const confirmed = pedagogy.snapshot.active.filter((item) => item.status === "validated");
  const pending = pedagogy.snapshot.active.filter((item) => item.status === "pending").length;
  const paragraphs = confirmed.length
    ? confirmed.map((item) =>
        [
          `${formatDate(item.assessmentDate)} · ${item.assessmentTitle}`,
          `Notion : ${item.curriculumNodeTitle} · ${PDF_CONFIDENCE[item.confidence]}`,
          item.difficulty,
          ...item.evidence.map((evidence) => `Preuve (${evidence.questionLabel}) : « ${evidence.excerpt} »`),
          `Piste : ${item.recommendedAction}`,
          item.teacherNote ? `Note du professeur : ${item.teacherNote}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      )
    : ["Aucune observation confirmée pour le moment."];
  if (pending)
    paragraphs.push(`${pending} hypothèse(s) de l'analyse automatique attendent la décision du professeur et ne figurent pas dans ce document.`);
  return paragraphs;
}

/** Export only the requested resource, using the same snapshot as the screen. */
export function buildSchoolReport(dataset: EvaluationDataset, target: ReportTarget, pedagogy?: ReportPedagogy): SchoolReport {
  if (target.kind === "class") {
    const { classInfo, studentAnalyses, weakestSkills } = analyzeClass(target.id, dataset);
    return {
      title: `Suivi de classe - ${classInfo.name}`,
      subtitle: `${classInfo.subject} · ${studentAnalyses.length} élèves`,
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
      title: `Dossier élève - ${a.name}`, subtitle: `${c?.name ?? ""} · ${c?.subject ?? ""}`,
      sections: [
        { title: "Synthèse pédagogique", paragraphs: [a.summary, a.narrative, `Moyenne des notes renseignées : ${score(a.average)}`] },
        { title: "Compétences observées", paragraphs: a.skillMasteries.map((s) => `${s.name} : ${s.testedCount ? SKILL_LEVEL_LABEL[s.lastTwoLevels.at(-1)!] : "Non renseigné"} · ${s.testedCount} observation(s) · ${CONFIDENCE_LABEL[s.confidence]}`) },
        { title: "Observations datées", paragraphs: studentEvidence(target.id, a.classId, dataset).map((row) => {
          const state = row.state === "absent" ? "Absent(e)" : row.state === "missing" ? "Non renseigné" : row.state === "skills_only" ? "Compétences uniquement" : score(row.score);
          const levels = row.state === "absent" ? [] : row.evaluation.skillIds.map((id) => `${dataset.skills.find((s) => s.id === id)?.name ?? id} : ${row.levels[id] ? SKILL_LEVEL_LABEL[row.levels[id]!] : "Non renseigné"}`);
          return `${formatDate(row.evaluation.date)} · ${row.evaluation.name}\n${state}${levels.length ? "\n" + levels.join(" · ") : ""}`;
        }) },
        ...(pedagogy ? [{ title: "Observations sur copies confirmées par le professeur", paragraphs: confirmedObservations(pedagogy) }] : []),
        { title: "Pistes à confirmer par le professeur", paragraphs: a.recommendedActions.length ? a.recommendedActions.map((action) => `${action.label} · durée indicative : ${action.minutes} min`) : ["Poursuivre ou compléter les observations."] },
      ],
    };
  }
  const a = analyzeEvaluation(target.id, dataset);
  const c = dataset.classes.find((item) => item.id === a.evaluation.classId);
  return {
    title: a.evaluation.name, subtitle: `${c?.name ?? ""} · ${formatDate(a.evaluation.date)}`,
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
