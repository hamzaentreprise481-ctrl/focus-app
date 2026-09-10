import { TrendingDown, TrendingUp } from "lucide-react";
import type { SkillMastery } from "@/lib/analysis";
import { CONFIDENCE_LABEL } from "@/lib/analysis";
import { MasteryBar } from "@/components/ui/mastery-bar";
import { cn } from "@/lib/utils";

export function SkillMasteryList({ skills }: { skills: SkillMastery[] }) {
  const tested = [...skills]
    .filter((s): s is SkillMastery & { percent: number } => s.testedCount > 0 && s.percent !== null)
    .sort((a, b) => b.percent - a.percent);
  const untested = skills.filter((s) => s.testedCount === 0);

  return (
    <div className="space-y-5">
      <div className="space-y-4">
        {tested.map((skill) => (
          <div key={skill.skillId}>
            <div className="mb-1.5 flex items-center justify-between text-sm">
              <span className="font-medium text-ink">{skill.name}</span>
              <span className={cn("flex items-center gap-1 tabular-nums", "text-ink-soft")}>
                {skill.trend === "hausse" && <TrendingUp className="h-3.5 w-3.5 text-normal" />}
                {skill.trend === "baisse" && <TrendingDown className="h-3.5 w-3.5 text-attention" />}
                {skill.percent}%
              </span>
            </div>
            <MasteryBar percent={skill.percent} />
            <p className="mt-1 text-xs text-muted">
              {CONFIDENCE_LABEL[skill.confidence]} · {skill.testedCount} évaluation
              {skill.testedCount > 1 ? "s" : ""}
            </p>
          </div>
        ))}
      </div>

      {untested.length > 0 && (
        <p className="text-xs text-muted">
          Données insuffisantes pour {untested.map((s) => s.name).join(", ")}.
        </p>
      )}
    </div>
  );
}
