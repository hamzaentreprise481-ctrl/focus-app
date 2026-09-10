import Link from "next/link";
import {
  ChevronRight,
  TrendingDown,
  TrendingUp,
  CalendarX,
  Shuffle,
  AlertTriangle,
  Minus,
} from "lucide-react";
import type { StudentAnalysis } from "@/lib/analysis";
import { StatusBadge } from "@/components/ui/status-badge";
import { initials } from "@/lib/utils";

const PATTERN_ICON: Record<StudentAnalysis["pattern"], typeof TrendingDown> = {
  absence_sequence_importante: CalendarX,
  difficulte_persistante: TrendingDown,
  baisse_reguliere: TrendingDown,
  leger_flechissement: TrendingDown,
  progression_recente: TrendingUp,
  note_ponctuelle: AlertTriangle,
  resultats_irreguliers: Shuffle,
  stable: Minus,
};

export function AttentionCard({ analysis }: { analysis: StudentAnalysis }) {
  const Icon = PATTERN_ICON[analysis.pattern];

  return (
    <Link
      href={`/app/eleves/${analysis.studentId}`}
      className="group flex items-center gap-4 rounded-[var(--radius-md)] border border-border bg-surface p-4 transition-colors hover:border-border-strong hover:bg-paper"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-paper text-[13px] font-semibold text-ink-soft">
        {initials(analysis.name)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[15px] font-medium text-ink">{analysis.name}</p>
          <StatusBadge status={analysis.status} className="shrink-0" />
        </div>
        <p className="mt-0.5 flex items-start gap-1.5 text-sm text-ink-soft">
          <Icon className="h-3.5 w-3.5 shrink-0" />
          {analysis.summary}
        </p>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}
