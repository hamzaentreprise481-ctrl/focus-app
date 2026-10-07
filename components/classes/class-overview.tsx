"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  CONFIDENCE_LABEL,
  type ClassOverview,
  type StudentAnalysis,
} from "@/lib/analysis";
import type { EvaluationDataset } from "@/lib/types";
import { formatDate } from "@/lib/utils";

const plural = (n: number, one: string, many: string) =>
  `${n} ${n > 1 ? many : one}`;

const GROUPS: {
  key: keyof ClassOverview["groups"];
  title: string;
  hint: string;
  empty: string;
}[] = [
  {
    key: "toExamine",
    title: "À examiner",
    hint: "Un signal précis à vérifier avec l’élève.",
    empty: "Aucun signal à examiner dans les données actuelles.",
  },
  {
    key: "toFollow",
    title: "À suivre",
    hint: "Un changement à confirmer à la prochaine évaluation.",
    empty: "Rien de particulier à suivre pour l’instant.",
  },
  {
    key: "improving",
    title: "En progrès",
    hint: "Une amélioration récente, à valoriser et à confirmer.",
    empty: "Aucune progression nette encore visible.",
  },
  {
    key: "insufficient",
    title: "Recul insuffisant",
    hint: "Moins de deux évaluations notées : pas encore de lecture.",
    empty: "Chaque élève a au moins deux évaluations notées.",
  },
];

/** Why a student is listed: the rising competencies when the pattern
 *  itself (e.g. "stable") does not say it. */
function reasonFor(
  group: keyof ClassOverview["groups"],
  analysis: StudentAnalysis,
) {
  if (group !== "improving" || analysis.pattern === "progression_recente")
    return analysis.summary;
  const rising = analysis.skillMasteries.filter(
    (m) => m.trend === "hausse" && m.testedCount >= 2,
  );
  return `Niveau en hausse entre la première et la dernière observation : ${rising.map((m) => `« ${m.name} »`).join(", ")}.`;
}

function StudentLine({
  analysis,
  reason,
}: {
  analysis: StudentAnalysis;
  reason: string;
}) {
  return (
    <li>
      <Link
        href={`/app/eleves/${analysis.studentId}`}
        className="block rounded-md px-2 py-1.5 hover:bg-paper focus-visible:bg-paper"
      >
        <span className="font-medium text-ink">{analysis.name}</span>
        <span className="block text-xs leading-relaxed text-ink-soft">
          {reason}
        </span>
      </Link>
    </li>
  );
}

export function ClassStudentGroups({ overview }: { overview: ClassOverview }) {
  const [expanded, setExpanded] = useState<string[]>([]);
  return (
    <section aria-labelledby="groups-title">
      <h2 id="groups-title" className="text-lg font-semibold">
        Où porter son attention
      </h2>
      <p className="mt-1 text-sm text-ink-soft">
        Regroupements issus de règles explicites sur les notes et les
        compétences renseignées, sans classement des élèves. À confirmer avec
        votre connaissance de la classe.
      </p>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {GROUPS.map(({ key, title, hint, empty }) => {
          const list = overview.groups[key];
          const isExpanded = expanded.includes(key);
          const shown = isExpanded ? list : list.slice(0, 5);
          return (
            <div
              key={key}
              className="rounded-xl border border-border bg-surface p-4"
              data-group={key}
            >
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="font-semibold">{title}</h3>
                <span className="text-sm text-ink-soft">
                  {plural(list.length, "élève", "élèves")}
                </span>
              </div>
              <p className="mt-1 text-xs text-ink-soft">{hint}</p>
              {shown.length ? (
                <ul
                  id={`class-group-${key}`}
                  className="mt-3 -mx-2 space-y-0.5 text-sm"
                >
                  {shown.map((analysis) => (
                    <StudentLine
                      key={analysis.studentId}
                      analysis={analysis}
                      reason={reasonFor(key, analysis)}
                    />
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-ink-soft">{empty}</p>
              )}
              {list.length > 5 && (
                <Button
                  variant="ghost"
                  className="mt-2"
                  aria-expanded={isExpanded}
                  aria-controls={`class-group-${key}`}
                  onClick={() =>
                    setExpanded((previous) =>
                      isExpanded
                        ? previous.filter((item) => item !== key)
                        : [...previous, key],
                    )
                  }
                >
                  {isExpanded
                    ? "Réduire la liste"
                    : `Voir les ${list.length} élèves`}
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function ClassSkillSignals({
  overview,
  dataset,
}: {
  overview: ClassOverview;
  dataset: EvaluationDataset;
}) {
  const nameOf = new Map(
    overview.studentAnalyses.map((a) => [a.studentId, a.name]),
  );
  const signals = overview.skillSignals
    .filter((signal) => signal.fragileNow > 0)
    .slice(0, 6);
  const documentedSkills = overview.skillSignals.length;
  const classSkills = new Set(
    dataset.evaluations
      .filter((e) => e.classId === overview.classInfo.id)
      .flatMap((e) => e.skillIds),
  );
  return (
    <section aria-labelledby="skills-signal-title">
      <h2 id="skills-signal-title" className="text-lg font-semibold">
        Points à travailler dans la classe
      </h2>
      <p className="mt-1 text-sm text-ink-soft">
        Uniquement à partir des niveaux de compétence saisis, jamais déduits des
        notes. Un niveau manquant n’est pas un niveau faible.
      </p>
      {!documentedSkills ? (
        <p className="mt-4 rounded-xl border border-border bg-surface p-4 text-sm text-ink-soft">
          {classSkills.size
            ? "Des compétences sont associées aux évaluations, mais aucun niveau n’a encore été saisi. Renseignez-les dans une évaluation pour faire apparaître les points à travailler."
            : "Associez des compétences à vos évaluations et renseignez les niveaux observés pour faire apparaître les points à travailler."}
        </p>
      ) : !signals.length ? (
        <p className="mt-4 rounded-xl border border-border bg-surface p-4 text-sm text-ink-soft">
          Aucun niveau fragile ou non maîtrisé dans les dernières observations
          saisies (
          {plural(
            documentedSkills,
            "compétence documentée",
            "compétences documentées",
          )}
          ).
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-border rounded-xl border border-border bg-surface">
          {signals.map((signal) => {
            const names = signal.concernedStudentIds.map(
              (id) => nameOf.get(id) ?? "Élève",
            );
            return (
              <li
                key={signal.skillId}
                className="p-4 text-sm"
                data-skill={signal.name}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-semibold">{signal.name}</h3>
                  <span className="text-xs text-ink-soft">
                    {CONFIDENCE_LABEL[signal.confidence]} ·{" "}
                    {plural(
                      signal.evaluationCount,
                      "évaluation",
                      "évaluations",
                    )}
                  </span>
                </div>
                <p className="mt-1 text-ink-soft">
                  {signal.fragileNow} sur{" "}
                  {plural(
                    signal.documented,
                    "élève documenté",
                    "élèves documentés",
                  )}{" "}
                  au dernier niveau fragile ou non maîtrisé
                  {signal.persistent
                    ? `, dont ${signal.persistent} sur deux observations consécutives`
                    : ""}
                  .
                  {signal.improving
                    ? ` ${plural(signal.improving, "élève progresse", "élèves progressent")} sur cette compétence.`
                    : ""}
                </p>
                <p className="mt-2 text-xs text-ink-soft">
                  <span className="font-medium text-ink">
                    Élèves concernés :{" "}
                  </span>
                  {names.slice(0, 8).join(", ")}
                  {names.length > 8 ? `, et ${names.length - 8} autres` : ""}
                </p>
                <p className="mt-2 text-xs text-ink-soft">
                  {signal.persistent >= 2
                    ? "Piste : un temps de reprise en petit groupe sur cette notion, puis une vérification à la prochaine évaluation qui la mobilise."
                    : "Piste : vérifier la notion avec les élèves concernés, puis comparer à la prochaine évaluation qui la mobilise."}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function ClassRecentEvaluations({
  overview,
  dataset,
}: {
  overview: ClassOverview;
  dataset: EvaluationDataset;
}) {
  const classId = overview.classInfo.id;
  const total = overview.classInfo.studentIds.length;
  const inClass = new Set(overview.classInfo.studentIds);
  const evaluations = dataset.evaluations
    .filter((e) => e.classId === classId)
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) || a.name.localeCompare(b.name, "fr"),
    );
  return (
    <section aria-labelledby="class-evaluations-title">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="class-evaluations-title" className="text-lg font-semibold">
          Évaluations de la classe
        </h2>
        <Link
          href={`/app/evaluations/nouvelle?classe=${encodeURIComponent(classId)}`}
          className="text-sm font-medium text-brand"
        >
          Ajouter une évaluation →
        </Link>
      </div>
      {evaluations.length ? (
        <ul className="mt-4 divide-y divide-border rounded-xl border border-border bg-surface">
          {evaluations.map((evaluation) => {
            const grades = dataset.rawGrades.filter(
              (g) =>
                g.evaluationId === evaluation.id && inClass.has(g.studentId),
            );
            const absent = grades.filter((g) => g.absent).length;
            const withLevels = grades.filter(
              (g) =>
                !g.absent && Object.values(g.skillLevels ?? {}).some(Boolean),
            ).length;
            const missing = Math.max(0, total - grades.length);
            return (
              <li key={evaluation.id}>
                <Link
                  href={`/app/evaluations/${evaluation.id}`}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 p-4 text-sm hover:bg-paper"
                >
                  <span>
                    <span className="font-medium">{evaluation.name}</span>
                    <span className="block text-xs text-ink-soft">
                      {grades.length - absent} saisies sur {total}
                      {absent
                        ? ` · ${plural(absent, "absence", "absences")}`
                        : ""}
                      {missing
                        ? ` · ${plural(missing, "élève sans saisie", "élèves sans saisie")}`
                        : ""}
                      {evaluation.skillIds.length
                        ? ` · compétences renseignées pour ${withLevels} élève${withLevels > 1 ? "s" : ""}`
                        : " · aucune compétence associée"}
                    </span>
                  </span>
                  <span className="text-ink-soft">
                    {formatDate(evaluation.date)} →
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-4 rounded-xl border border-border bg-surface p-4 text-sm text-ink-soft">
          Aucune évaluation pour cette classe. Ajoutez-en une pour commencer le
          suivi : notes, absences et compétences observées.
        </p>
      )}
    </section>
  );
}
