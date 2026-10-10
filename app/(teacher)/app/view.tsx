"use client";
import { useState } from "react";
import { DataLoadState } from "@/components/evaluations/data-load-state";
import Link from "next/link";
import { ArrowRight, Plus, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import {
  analyzeClass,
  CONFIDENCE_LABEL,
  getAttentionFeed,
} from "@/lib/analysis";
import { useSchoolData } from "@/lib/school-data-context";
import { useTeacher } from "@/components/layout/teacher-context";
import { AttentionCard } from "@/components/dashboard/attention-card";
import { WorkQueue } from "@/components/dashboard/work-queue";
import { classWorkItems } from "@/lib/pedagogy/work-queue";
import type { loadTeacherWorkQueue } from "./pedagogy-actions";
import { formatDate } from "@/lib/utils";

export default function DashboardPage({
  workQueue,
}: {
  workQueue: Awaited<ReturnType<typeof loadTeacherWorkQueue>>;
}) {
  const { dataset, loaded, storageError } = useSchoolData();
  const { name } = useTeacher();
  const [selectedClass, setSelectedClass] = useState("");
  const activeClass =
    dataset.classes.find((c) => c.id === selectedClass) ?? dataset.classes[0];
  if (!loaded || storageError) return <DataLoadState />;
  if (!activeClass)
    return (
      <EmptyState
        title="Votre compte attend une classe"
        description="Aucune classe n’est encore affectée à votre espace. Contactez la personne qui vous a invité pour commencer le suivi."
        action={
          <Button variant="secondary" asChild>
            <Link href="/app/parametres">Voir mes affectations</Link>
          </Button>
        }
      />
    );
  const { classInfo, counts, skillSignals } = analyzeClass(
    activeClass.id,
    dataset,
  );
  const signals = skillSignals
    .filter((signal) => signal.fragileNow > 0)
    .slice(0, 3);
  const feed = getAttentionFeed(activeClass.id, 4, dataset);
  const workItems = workQueue.ok
    ? classWorkItems(workQueue.queue, activeClass.id, dataset)
    : null;
  const classEvaluations = dataset.evaluations.filter(
    (e) => e.classId === activeClass.id,
  );
  const recent = [...classEvaluations]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 3);
  return (
    <div className="space-y-8">
      <section>
        <PageHeader
          title={`Bonjour${name === "Professeur" ? "" : ` ${name}`}.`}
          eyebrow="Votre suivi pédagogique"
          description="Les copies à compléter, les analyses à lancer et les hypothèses qui attendent votre décision."
          actions={
            <>
              <Button variant="secondary" asChild>
                <Link href={`/app/classes/${classInfo.id}`}>
                  Ouvrir ma classe
                </Link>
              </Button>
              <Button asChild>
                <Link
                  href={`/app/evaluations/nouvelle?classe=${encodeURIComponent(activeClass.id)}`}
                >
                  <Plus size={16} aria-hidden="true" />
                  Ajouter une évaluation
                </Link>
              </Button>
            </>
          }
        />
        {dataset.classes.length > 1 && (
          <div className="mt-5">
            <label htmlFor="dashboard-class" className="mr-3 text-sm">
              Classe
            </label>
            <select
              id="dashboard-class"
              value={activeClass.id}
              onChange={(event) => setSelectedClass(event.target.value)}
              className="rounded-xl border border-border-strong bg-surface px-3 py-2 text-sm shadow-sm"
            >
              {dataset.classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.subject}
                </option>
              ))}
            </select>
          </div>
        )}
        <p className="mt-4 text-sm text-ink-soft">
          {classInfo.name} · {classInfo.subject} · {counts.total} élèves
        </p>
      </section>
      <WorkQueue
        items={workItems}
        aiConfigured={workQueue.ok && workQueue.queue.aiConfigured}
        error={workQueue.ok ? undefined : workQueue.error}
      />
      <section aria-labelledby="recent-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="recent-title" className="text-lg font-semibold">
              Évaluations récentes
            </h2>
            <p className="mt-1 text-sm text-ink-soft">
              {counts.total} élèves · {classEvaluations.length} évaluations
            </p>
          </div>
          <Link
            href="/app/evaluations"
            className="text-sm font-medium text-brand"
          >
            Toutes les évaluations →
          </Link>
        </div>
        <div className="mt-5 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
          {recent.length ? (
            recent.map((e) => (
              <Link
                key={e.id}
                href={`/app/evaluations/${e.id}`}
                className="flex items-center justify-between gap-4 p-5 hover:bg-paper"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{e.name}</p>
                  <p className="mt-1 text-xs text-ink-soft">
                    {formatDate(e.date)} · {e.skillIds.length} compétences
                    abordées
                  </p>
                </div>
                <ArrowRight size={16} className="shrink-0 text-muted" />
              </Link>
            ))
          ) : (
            <div className="p-5 text-sm text-ink-soft">
              <p>
                Votre première évaluation donnera le point de départ du suivi.
              </p>
              <Link
                href={`/app/evaluations/nouvelle?classe=${encodeURIComponent(activeClass.id)}`}
                className="mt-2 inline-block font-medium text-brand underline"
              >
                Créer la première évaluation
              </Link>
            </div>
          )}
        </div>
      </section>
      <section id="suivis" className="rounded-2xl border border-border bg-white p-5 shadow-sm sm:p-6">
        <details className="insights-disclosure">
          <summary className="flex cursor-pointer items-center justify-between gap-4 rounded-lg py-3">
            <div>
              <h2 className="text-lg font-semibold">
                Points à consulter dans la classe
              </h2>
              <p className="mt-1 text-sm font-normal text-ink-soft">
                Indices issus des résultats saisis. Ils ne constituent pas des
                observations confirmées sur les copies.
              </p>
            </div>
            <ChevronDown size={20} className="shrink-0" />
          </summary>
          <div className="mt-6 grid gap-7 xl:grid-cols-2">
            <div>
              <h3 className="mb-3 text-sm font-semibold">
                Quelques éléments à regarder
              </h3>
              <div className="space-y-3">
                {feed.length ? (
                  feed.map((a) => (
                    <AttentionCard key={a.studentId} analysis={a} />
                  ))
                ) : (
                  <p className="text-sm text-ink-soft">
                    Aucun point particulier pour le moment.
                  </p>
                )}
              </div>
            </div>
            <div>
              <h3 className="mb-3 text-sm font-semibold">
                Compétences à explorer ensemble
              </h3>
              <div className="space-y-5 rounded-xl border border-border bg-paper/60 p-5">
                {signals.map((signal) => (
                  <div key={signal.skillId} className="text-sm">
                    <div className="flex flex-wrap justify-between gap-2">
                      <span className="font-medium">{signal.name}</span>
                      <span className="text-xs text-ink-soft">
                        {CONFIDENCE_LABEL[signal.confidence]}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-ink-soft">
                      {signal.fragileNow} sur {signal.documented} élève
                      {signal.documented > 1 ? "s" : ""} documenté
                      {signal.documented > 1 ? "s" : ""} au dernier niveau
                      fragile ou non maîtrisé
                      {signal.persistent
                        ? `, dont ${signal.persistent} sur deux observations consécutives`
                        : ""}
                      .
                    </p>
                  </div>
                ))}
                {signals.length ? (
                  <Link
                    href={`/app/classes/${classInfo.id}#competences`}
                    className="inline-block text-sm font-medium text-brand"
                  >
                    Voir les élèves concernés dans la classe →
                  </Link>
                ) : (
                  <p className="text-sm text-ink-soft">
                    Les compétences renseignées fragiles ou non maîtrisées
                    apparaîtront ici.
                  </p>
                )}
              </div>
            </div>
          </div>
        </details>
      </section>
    </div>
  );
}
