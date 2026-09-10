"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { analyzeClass, getAttentionFeed } from "@/lib/analysis";
import { currentTeacher } from "@/lib/data/class-info";
import { useDemoData } from "@/lib/demo-data-context";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { AttentionCard } from "@/components/dashboard/attention-card";
import { MasteryBar } from "@/components/ui/mastery-bar";

export default function DashboardPage() {
  const { dataset } = useDemoData();
  const { classInfo, counts, weakestSkills } = analyzeClass("seconde-3", dataset);
  const feed = getAttentionFeed("seconde-3", 4, dataset);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Bonjour {currentTeacher}</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Classe actuellement sélectionnée : <span className="font-medium text-ink">{classInfo.name}</span>
          </p>
        </div>
        <Link
          href={`/classes/${classInfo.id}`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:text-brand-hover"
        >
          Voir la classe
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard value={counts.total} label="Élèves" emphasis />
        <KpiCard value={counts.normal} label="Progression normale" dotClassName="bg-normal" />
        <KpiCard value={counts.aSurveiller} label="À surveiller" dotClassName="bg-watch" />
        <KpiCard value={counts.attention} label="Attention recommandée" dotClassName="bg-attention" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <section className="lg:col-span-3">
          <h2 className="text-[15px] font-semibold text-ink">Élèves nécessitant votre attention</h2>
          <p className="mt-1 text-sm text-ink-soft">
            Priorisés à partir de l&rsquo;évolution de leurs résultats, pas seulement de leur moyenne — à confirmer
            par votre propre lecture.
          </p>
          <div className="mt-4 space-y-2">
            {feed.length > 0 ? (
              feed.map((analysis) => <AttentionCard key={analysis.studentId} analysis={analysis} />)
            ) : (
              <p className="rounded-[var(--radius-lg)] border border-dashed border-border-strong p-5 text-sm text-ink-soft">
                Aucun signal particulier pour le moment.
              </p>
            )}
          </div>
        </section>

        <section className="lg:col-span-2">
          <h2 className="text-[15px] font-semibold text-ink">Compétences les moins maîtrisées dans la classe</h2>
          <p className="mt-1 text-sm text-ink-soft">
            Moyenne de maîtrise de {classInfo.name}, sur les compétences pour lesquelles des données existent.
          </p>
          <div className="mt-4 space-y-4 rounded-[var(--radius-lg)] border border-border bg-surface p-5">
            {weakestSkills.length > 0 ? (
              weakestSkills.map((skill) => (
                <div key={skill.skillId}>
                  <div className="mb-1.5 flex items-center justify-between text-sm">
                    <span className="font-medium text-ink">{skill.name}</span>
                    <span className="text-ink-soft">
                      {skill.percent}%<span className="ml-1 text-xs text-muted">({skill.sampleSize} élèves)</span>
                    </span>
                  </div>
                  <MasteryBar percent={skill.percent} />
                </div>
              ))
            ) : (
              <p className="text-sm text-ink-soft">Pas encore assez de données de compétence.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
