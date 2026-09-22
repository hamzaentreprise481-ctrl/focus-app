"use client";

import { useId, useState } from "react";
import Link from "next/link";
import type { EvaluationDataset } from "@/lib/types";
import { SKILL_LEVEL_LABEL } from "@/lib/analysis";
import { skills } from "@/lib/data/skills";
import { studentEvidence } from "@/lib/student-evidence";
import { formatDate, formatScore } from "@/lib/utils";

export function EvidenceTimeline({ studentId, classId, dataset }: {
  studentId: string;
  classId: string;
  dataset: EvaluationDataset;
}) {
  const selectId = useId();
  const [skillId, setSkillId] = useState("");
  const rows = studentEvidence(studentId, classId, dataset)
    .filter((row) => !skillId || row.evaluation.skillIds.includes(skillId));

  return (
    <section aria-labelledby={`${selectId}-title`}>
      <h2 id={`${selectId}-title`} className="text-lg font-semibold">
        Observations au fil des évaluations
      </h2>
      <p className="mt-2 text-sm text-ink-soft">
        Retrouvez les niveaux saisis, du plus récent au plus ancien. Une absence
        ou une donnée manquante ne signifie pas qu’une compétence n’est pas maîtrisée.
      </p>
      <label htmlFor={selectId} className="mb-1 mt-4 block text-sm font-medium">
        Compétence à consulter
      </label>
      <select id={selectId} value={skillId} onChange={(event) => setSkillId(event.target.value)}
        className="h-10 w-full max-w-sm rounded-lg border border-border-strong bg-surface px-3 text-sm">
        <option value="">Toutes les compétences</option>
        {skills.map((skill) => <option key={skill.id} value={skill.id}>{skill.name}</option>)}
      </select>
      <p role="status" className="mt-2 text-xs text-ink-soft">
        {rows.length} évaluation{rows.length > 1 ? "s" : ""} affichée{rows.length > 1 ? "s" : ""}
      </p>
      <ol className="mt-4 divide-y divide-border">
        {rows.map((row) => (
          <li key={row.evaluation.id} className="py-4">
            <div className="flex flex-wrap items-start justify-between gap-2 text-sm">
              <div>
                <Link href={`/app/evaluations/${row.evaluation.id}`} className="font-medium hover:text-brand">
                  {row.evaluation.name}
                </Link>
                <p className="mt-1 text-xs text-ink-soft">{formatDate(row.evaluation.date)}</p>
              </div>
              <span className="text-ink-soft">
                {row.state === "absent" ? "Absent(e)" : row.state === "graded"
                  ? `${formatScore(row.score!)} / 20` : row.state === "skills_only"
                    ? "Compétences uniquement" : "Non renseigné"}
              </span>
            </div>
            {row.state !== "absent" && (
              <ul className="mt-3 flex flex-wrap gap-2 text-xs">
                {skills.filter((skill) => row.evaluation.skillIds.includes(skill.id) && (!skillId || skill.id === skillId))
                  .map((skill) => (
                    <li key={skill.id} className="rounded-md bg-paper px-2.5 py-2">
                      <span className="font-medium">{skill.name}</span> : {row.levels[skill.id]
                        ? SKILL_LEVEL_LABEL[row.levels[skill.id]!] : "Non renseigné"}
                    </li>
                  ))}
                {!row.evaluation.skillIds.length && <li className="text-ink-soft">Aucune compétence associée.</li>}
              </ul>
            )}
          </li>
        ))}
      </ol>
      {!rows.length && <p className="mt-4 rounded-lg bg-paper p-4 text-sm text-ink-soft">
        {skillId ? "Aucune évaluation ne porte encore sur cette compétence." : "Aucune évaluation dans cette classe."}
      </p>}
    </section>
  );
}
