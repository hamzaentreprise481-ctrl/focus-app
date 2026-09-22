"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { Search, TrendingDown, TrendingUp, Minus } from "lucide-react";
import { CONFIDENCE_LABEL, SKILL_LEVEL_LABEL, type StudentAnalysis } from "@/lib/analysis";
import type { StatusLevel } from "@/lib/types";
import { StatusBadge } from "@/components/ui/status-badge";
import { skills } from "@/lib/data/skills";
import { filterStudentRoster, latestSkillLevel, type SkillLevelFilter } from "@/lib/student-evidence";
import { Input } from "@/components/ui/input";
import { cn, formatScore, initials } from "@/lib/utils";

const FILTERS: { value: StatusLevel | "all"; label: string }[] = [
  { value: "all", label: "Tous" },
  { value: "normal", label: "Sans signal particulier" },
  { value: "a_surveiller", label: "À surveiller" },
  { value: "attention", label: "À examiner" },
];

function EvolutionCell({ evolution }: { evolution: number | null }) {
  if (evolution === null) return <span className="text-muted">—</span>;
  if (evolution > 0.3)
    return (
      <span className="inline-flex items-center gap-1 text-normal">
        <TrendingUp className="h-3.5 w-3.5" />+{formatScore(evolution)}
      </span>
    );
  if (evolution < -0.3)
    return (
      <span className="inline-flex items-center gap-1 text-attention">
        <TrendingDown className="h-3.5 w-3.5" />
        {formatScore(evolution)}
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-muted">
      <Minus className="h-3.5 w-3.5" />
      stable
    </span>
  );
}

export function StudentRoster({ analyses }: { analyses: StudentAnalysis[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StatusLevel | "all">("all");

  const selectId = useId();
  const [skillId, setSkillId] = useState("");
  const [level, setLevel] = useState<SkillLevelFilter>("all");
  const filtered = useMemo(() => filterStudentRoster(analyses, {
    query, status: filter, skillId, level,
  }), [analyses, query, filter, skillId, level]);
  const activeSkill = skills.find((skill) => skill.id === skillId);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher un élève"
            aria-label="Rechercher un élève"
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              aria-pressed={filter === f.value}
              className={cn(
                "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                filter === f.value
                  ? "border-brand bg-brand-soft text-brand-ink"
                  : "border-border-strong text-ink-soft hover:bg-paper",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span role="status" className="ml-auto text-sm text-muted">
          {filtered.length} élève{filtered.length > 1 ? "s" : ""}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-auto">
          <label htmlFor={`${selectId}-skill`} className="mb-1 block text-sm font-medium">Compétence</label>
          <select id={`${selectId}-skill`} value={skillId}
            onChange={(event) => { setSkillId(event.target.value); setLevel("all"); }}
            className="h-10 w-full rounded-lg border border-border-strong bg-surface px-3 text-sm">
            <option value="">Vue d’ensemble</option>
            {skills.map((skill) => <option key={skill.id} value={skill.id}>{skill.name}</option>)}
          </select>
        </div>
        <div className="w-full sm:w-auto">
          <label htmlFor={`${selectId}-level`} className="mb-1 block text-sm font-medium">Dernier niveau observé</label>
          <select id={`${selectId}-level`} value={level} disabled={!skillId}
            onChange={(event) => setLevel(event.target.value as SkillLevelFilter)}
            className="h-10 w-full rounded-lg border border-border-strong bg-surface px-3 text-sm disabled:opacity-50">
            <option value="all">Tous les niveaux</option>
            {Object.entries(SKILL_LEVEL_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            <option value="missing">Non renseigné</option>
          </select>
        </div>
        {(query || filter !== "all" || skillId) && <button type="button"
          onClick={() => { setQuery(""); setFilter("all"); setSkillId(""); setLevel("all"); }}
          className="h-10 px-2 text-sm text-brand underline underline-offset-4">Réinitialiser les filtres</button>}
      </div>
      {activeSkill && <p className="mt-2 text-xs text-ink-soft">
        Dernière observation renseignée pour {activeSkill.name}, indépendamment de la note.
        « Non renseigné » signifie qu’aucun niveau n’a été saisi pour cette compétence.
      </p>}

      <ul className="mt-4 divide-y divide-border border-y border-border md:hidden">
        {filtered.map((a) => (
          <li key={a.studentId}>
            <Link href={`/app/eleves/${a.studentId}`} className="block py-4">
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{a.name}</span>
                <EvolutionCell evolution={a.evolution} />
              </span>
              <span className="mt-2 block text-sm text-ink-soft">
                {activeSkill ? `${activeSkill.name} : ${latestSkillLevel(a, skillId)
                  ? SKILL_LEVEL_LABEL[latestSkillLevel(a, skillId)!] : "Non renseigné"}` : a.summary}
              </span>
              <span className="mt-2 block text-xs text-brand">
                Ouvrir la fiche →
              </span>
            </Link>
          </li>
        ))}
        {!filtered.length && (
          <li className="py-6 text-sm text-ink-soft">
            Aucun élève ne correspond à cette recherche.
          </li>
        )}
      </ul>
      <div
        role="region"
        aria-label="Liste des élèves, défilement horizontal et vertical"
        tabIndex={0}
        className="mt-4 hidden md:block table-scroll rounded-[var(--radius-lg)] border border-border bg-surface"
      >
        <table className="w-full min-w-[780px] text-left text-sm">
          <thead className="sticky top-0 z-10 bg-surface">
            <tr className="border-b border-border text-[11px] uppercase tracking-[0.06em] text-muted">
              <th scope="col" className="px-5 py-3 font-medium">
                Nom
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Évolution
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                {activeSkill ? activeSkill.name : "Point à travailler"}
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Fiabilité du signal
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Dernière note ou absence
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Statut
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((a) => {
              const displayedSkill = activeSkill
                ? a.skillMasteries.find((skill) => skill.skillId === skillId)
                : a.weakestSkill;
              const observedLevel = activeSkill ? latestSkillLevel(a, skillId) : null;
              const last = [...a.timeline]
                .reverse()
                .find((t) => t.absent || t.score !== null);
              return (
                <tr
                  key={a.studentId}
                  className="border-b border-border last:border-0 hover:bg-paper"
                >
                  <th scope="row" className="px-5 py-2.5 text-left font-normal">
                    <Link
                      href={`/app/eleves/${a.studentId}`}
                      className="flex items-center gap-3"
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-paper text-xs font-semibold text-ink-soft">
                        {initials(a.name)}
                      </span>
                      <span className="font-medium text-ink hover:text-brand">
                        {a.name}
                      </span>
                    </Link>
                  </th>
                  <td className="px-4 py-2.5 tabular-nums">
                    <EvolutionCell evolution={a.evolution} />
                  </td>
                  <td className="px-4 py-2.5 text-ink-soft">
                    <span className="font-medium text-ink">
                      {activeSkill ? (observedLevel ? SKILL_LEVEL_LABEL[observedLevel] : "Non renseigné") : displayedSkill?.name ?? "—"}
                    </span>
                    {!activeSkill && displayedSkill?.percent != null && (
                      <span className="ml-1.5 text-xs text-muted">{displayedSkill.percent}%</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-ink-soft">
                    {displayedSkill && displayedSkill.testedCount > 0 ? (
                      <>
                        {CONFIDENCE_LABEL[displayedSkill.confidence]}
                        <span className="mt-1 block">
                          Basé sur {displayedSkill.testedCount} évaluation{displayedSkill.testedCount > 1 ? "s" : ""}
                        </span>
                      </>
                    ) : "Données insuffisantes"}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums text-ink-soft">
                    {last?.absent
                      ? "Absent(e)"
                      : last?.score != null
                        ? `${formatScore(last.score)} / 20`
                        : "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    {a.pattern === "donnees_insuffisantes" ? (
                      <span className="text-xs text-ink-soft">
                        Recul insuffisant
                      </span>
                    ) : (
                      <StatusBadge status={a.status} />
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-5 py-10 text-center text-sm text-muted"
                >
                  Aucun élève ne correspond à cette recherche.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

