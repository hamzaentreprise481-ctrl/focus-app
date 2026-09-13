"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { analyzeClass } from "@/lib/analysis";
import { classes } from "@/lib/data/class-info";
import { useDemoData } from "@/lib/demo-data-context";

export default function ClassesPage() {
  const { dataset } = useDemoData();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Classes
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          Les classes dont vous assurez le suivi cette année.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {classes.map((c) => {
          const { counts } = analyzeClass(c.id, dataset);
          return (
            <Link
              key={c.id}
              href={`/app/classes/${c.id}`}
              className="group rounded-[var(--radius-lg)] border border-border bg-surface p-5 transition-colors hover:border-border-strong hover:bg-paper"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[15px] font-semibold text-ink">{c.name}</p>
                  <p className="mt-0.5 text-sm text-ink-soft">{c.subject}</p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted transition-transform group-hover:translate-x-0.5" />
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span className="font-medium text-ink">
                  {counts.total} élèves
                </span>
                {counts.attention > 0 && (
                  <span className="text-brand">
                    {counts.attention} points à examiner
                  </span>
                )}
                {counts.aSurveiller > 0 && (
                  <span className="text-watch">
                    {counts.aSurveiller} à surveiller
                  </span>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
