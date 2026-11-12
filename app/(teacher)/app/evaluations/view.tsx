"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, Plus, Search } from "lucide-react";
import { analyzeEvaluation } from "@/lib/analysis";
import { useSchoolData } from "@/lib/school-data-context";
import { DataLoadState } from "@/components/evaluations/data-load-state";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/feedback";
import { formatDate } from "@/lib/utils";

export default function EvaluationsPage() {
  const { dataset, loaded, storageError } = useSchoolData();
  const [classId, setClassId] = useState("");
  const [query, setQuery] = useState("");
  if (!loaded || storageError) return <DataLoadState />;
  const evaluations = [...dataset.evaluations]
    .sort((a, b) => b.date.localeCompare(a.date))
    .filter(
      (e) =>
        (!classId || e.classId === classId) &&
        e.name
          .toLocaleLowerCase("fr")
          .includes(query.trim().toLocaleLowerCase("fr")),
    );
  return (
    <div className="space-y-6">
      <PageHeader
        title="Évaluations"
        description="Retrouvez le sujet, les copies, les analyses et vos décisions pour chaque évaluation."
        actions={
          <Button asChild>
            <Link
              href={`/app/evaluations/nouvelle${classId ? `?classe=${encodeURIComponent(classId)}` : ""}`}
            >
              <Plus size={16} aria-hidden="true" />
              Nouvelle évaluation
            </Link>
          </Button>
        }
      />
      <div className="flex flex-wrap items-end gap-4">
        <div className="w-full sm:max-w-xs">
          <Label htmlFor="evaluation-search">Rechercher une évaluation</Label>
          <div className="relative">
            <Search
              size={16}
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-3 text-muted"
            />
            <Input
              id="evaluation-search"
              className="pl-9"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Nom de l’évaluation"
            />
          </div>
        </div>
        <div className="w-full sm:w-auto">
          <Label htmlFor="evaluation-class">Classe</Label>
          <select
            id="evaluation-class"
            value={classId}
            onChange={(e) => setClassId(e.target.value)}
            className="h-10 w-full rounded-[var(--radius-sm)] border border-border-strong bg-surface px-3 text-sm"
          >
            <option value="">Toutes mes classes</option>
            {dataset.classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.subject}
              </option>
            ))}
          </select>
        </div>
        <p role="status" className="pb-2 text-sm text-ink-soft">
          {evaluations.length} évaluation{evaluations.length > 1 ? "s" : ""}
        </p>
        {(query || classId) && (
          <Button
            variant="ghost"
            onClick={() => {
              setQuery("");
              setClassId("");
            }}
          >
            Réinitialiser les filtres
          </Button>
        )}
      </div>
      {evaluations.length === 0 ? (
        <EmptyState
          title={
            dataset.evaluations.length
              ? "Aucune évaluation ne correspond"
              : "Commencez par une évaluation"
          }
          description={
            dataset.evaluations.length
              ? "Modifiez la recherche ou la classe sélectionnée pour retrouver une évaluation."
              : "Créez une évaluation, ajoutez son corrigé puis une première réponse d’élève. Vous pouvez commencer sans notes."
          }
          action={
            dataset.evaluations.length ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setQuery("");
                  setClassId("");
                }}
              >
                Afficher toutes les évaluations
              </Button>
            ) : (
              <Button asChild>
                <Link href="/app/evaluations/nouvelle">
                  Créer la première évaluation
                </Link>
              </Button>
            )
          }
        />
      ) : (
        <ul className="divide-y divide-border rounded-[var(--radius-lg)] border border-border bg-surface">
          {evaluations.map((evaluation) => {
            const analysis = analyzeEvaluation(evaluation.id, dataset);
            const c = dataset.classes.find((c) => c.id === evaluation.classId);
            return (
              <li key={evaluation.id}>
                <Link
                  href={`/app/evaluations/${evaluation.id}`}
                  className="flex flex-wrap items-center justify-between gap-4 p-5 hover:bg-paper"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-base font-medium">{evaluation.name}</p>
                    <p className="mt-1 text-sm text-ink-soft">
                      {c?.name ?? "Classe"} · {c?.subject ?? "Matière"} ·{" "}
                      {formatDate(evaluation.date)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-4 text-sm">
                    <span className="text-ink-soft">
                      {analysis.recordedCount} / {c?.studentIds.length ?? 0}{" "}
                      résultats saisis
                    </span>
                    <ChevronRight
                      size={18}
                      aria-hidden="true"
                      className="text-muted"
                    />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
