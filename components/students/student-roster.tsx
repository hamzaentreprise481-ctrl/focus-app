"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, TrendingDown, TrendingUp, Minus } from "lucide-react";
import { CONFIDENCE_LABEL, type StudentAnalysis } from "@/lib/analysis";
import type { StatusLevel } from "@/lib/types";
import { StatusBadge } from "@/components/ui/status-badge";
import { Input } from "@/components/ui/input";
import { cn, formatScore, initials } from "@/lib/utils";

const FILTERS: { value: StatusLevel | "all"; label: string }[] = [
  { value: "all", label: "Tous" },
  { value: "normal", label: "Normal" },
  { value: "a_surveiller", label: "À surveiller" },
  { value: "attention", label: "Attention" },
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

  const filtered = useMemo(() => {
    return analyses
      .filter((a) => filter === "all" || a.status === filter)
      .filter((a) => a.name.toLowerCase().includes(query.trim().toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name, "fr"));
  }, [analyses, query, filter]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher un élève"
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
                  : "border-border-strong text-ink-soft hover:bg-paper"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-sm text-muted">
          {filtered.length} élève{filtered.length > 1 ? "s" : ""}
        </span>
      </div>

      <div className="mt-4 overflow-x-auto rounded-[var(--radius-lg)] border border-border bg-surface">
        <table className="w-full min-w-[780px] text-left text-sm">
          <thead className="sticky top-0 z-10 bg-surface">
            <tr className="border-b border-border text-[11px] uppercase tracking-[0.06em] text-muted">
              <th scope="col" className="px-5 py-3 font-medium">Nom</th>
              <th scope="col" className="px-4 py-3 font-medium">Trajectoire</th>
              <th scope="col" className="px-4 py-3 font-medium">Signal de compétence</th>
              <th scope="col" className="px-4 py-3 font-medium">Niveau de preuve</th>
              <th scope="col" className="px-4 py-3 font-medium">Dernière évaluation</th>
              <th scope="col" className="px-4 py-3 font-medium">Statut</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((a) => {
              const last = [...a.timeline].reverse().find((t) => t.absent || t.score !== null);
              return (
                <tr key={a.studentId} className="border-b border-border last:border-0 hover:bg-paper">
                  <th scope="row" className="px-5 py-2.5 text-left font-normal">
                    <Link href={`/eleves/${a.studentId}`} className="flex items-center gap-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-paper text-xs font-semibold text-ink-soft">
                        {initials(a.name)}
                      </span>
                      <span className="font-medium text-ink hover:text-brand">{a.name}</span>
                    </Link>
                  </th>
                  <td className="px-4 py-2.5 tabular-nums">
                    <EvolutionCell evolution={a.evolution} />
                  </td>
                  <td className="px-4 py-2.5 text-ink-soft">
                    <span className="font-medium text-ink">{a.weakestSkill?.name ?? "—"}</span>
                    {a.weakestSkill && <span className="ml-1.5 text-xs text-muted">{a.weakestSkill.percent}%</span>}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-ink-soft">
                    {a.weakestSkill ? CONFIDENCE_LABEL[a.weakestSkill.confidence] : "Données insuffisantes"}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums text-ink-soft">
                    {last?.absent ? "Absent(e)" : last?.score != null ? `${formatScore(last.score)} / 20` : "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusBadge status={a.status} />
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-sm text-muted">
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
