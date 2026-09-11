"use client";
import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  ClipboardPlus,
  Users,
  ChevronDown,
} from "lucide-react";
import { analyzeClass, getAttentionFeed } from "@/lib/analysis";
import { useDemoData } from "@/lib/demo-data-context";
import { useTeacher } from "@/components/layout/teacher-context";
import { AttentionCard } from "@/components/dashboard/attention-card";
import { MasteryBar } from "@/components/ui/mastery-bar";
import { formatDate } from "@/lib/utils";

export default function DashboardPage() {
  const { dataset } = useDemoData();
  const { name } = useTeacher();
  const { classInfo, counts, weakestSkills } = analyzeClass(
    "seconde-3",
    dataset,
  );
  const feed = getAttentionFeed("seconde-3", 4, dataset);
  const recent = [...dataset.evaluations]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 3);
  const actions = [
    {
      title: "Ouvrir ma classe",
      description: "Retrouver la vue d’ensemble de mes élèves.",
      href: `/app/classes/${classInfo.id}`,
      icon: BookOpen,
    },
    {
      title: "Ajouter une évaluation",
      description: "Enrichir le suivi à partir de mes observations.",
      href: "/app/evaluations/nouvelle",
      icon: ClipboardPlus,
    },
    {
      title: "Consulter mes élèves",
      description: "Prendre le temps d’un suivi individuel.",
      href: "/app/eleves",
      icon: Users,
    },
  ];
  return (
    <div className="space-y-10">
      <section className="welcome-area">
        <p className="text-sm text-brand">
          {classInfo.name} <span className="mx-2 text-border-strong">/</span>{" "}
          {classInfo.subject}
        </p>
        <h1 className="mt-5 text-3xl font-medium tracking-tight sm:text-4xl">
          Bonjour{name === "Professeur" ? "" : ` ${name}`}.
        </h1>
        <p className="mt-3 text-lg text-ink-soft">
          Par quoi souhaitez-vous commencer ?
        </p>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-soft">
          Votre espace est prêt. Retrouvez votre classe, ajoutez une observation
          ou prenez un moment pour un élève.
        </p>
        <div className="mt-8 grid gap-3 lg:grid-cols-3">
          {actions.map(({ title, description, href, icon: Icon }, i) => (
            <Link key={href} href={href} className={cnAction(i)}>
              <Icon size={22} aria-hidden="true" />
              <h2 className="mt-5 text-base font-semibold">{title}</h2>
              <p className="mt-2 text-sm leading-relaxed opacity-85">
                {description}
              </p>
              <ArrowRight className="mt-6" size={18} aria-hidden="true" />
            </Link>
          ))}
        </div>
      </section>
      <section aria-labelledby="recent-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="recent-title" className="text-lg font-semibold">
              Le fil de votre classe
            </h2>
            <p className="mt-1 text-sm text-ink-soft">
              {counts.total} élèves · {dataset.evaluations.length} évaluations
              dans cet espace de démonstration
            </p>
          </div>
          <Link
            href="/app/evaluations"
            className="text-sm font-medium text-brand"
          >
            Toutes les évaluations →
          </Link>
        </div>
        <div className="mt-5 divide-y divide-border rounded-xl border border-border bg-white">
          {recent.length ? (
            recent.map((e) => (
              <Link
                key={e.id}
                href={`/app/evaluations/${e.id}`}
                className="flex items-center justify-between gap-4 p-5 hover:bg-paper"
              >
                <div>
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
            <p className="p-5 text-sm text-ink-soft">
              Votre première évaluation donnera le point de départ du suivi.
            </p>
          )}
        </div>
      </section>
      <section id="suivis" className="border-t border-border pt-8">
        <details className="insights-disclosure">
          <summary className="flex cursor-pointer items-center justify-between gap-4 rounded-lg py-3">
            <div>
              <h2 className="text-lg font-semibold">
                À consulter quand vous êtes prêt
              </h2>
              <p className="mt-1 text-sm font-normal text-ink-soft">
                Quelques points pédagogiques et pistes de travail, à relire avec
                votre regard.
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
              <div className="space-y-5 rounded-xl border border-border bg-white p-5">
                {weakestSkills.map((s) => (
                  <div key={s.skillId}>
                    <div className="mb-2 flex justify-between gap-4 text-sm">
                      <span>{s.name}</span>
                      <span>{s.percent}%</span>
                    </div>
                    <MasteryBar percent={s.percent} />
                    <p className="mt-1 text-xs text-ink-soft">
                      À partir des observations de {s.sampleSize} élèves
                    </p>
                  </div>
                ))}
                {!weakestSkills.length && (
                  <p className="text-sm text-ink-soft">
                    Les compétences renseignées apparaîtront ici.
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
function cnAction(index: number) {
  return `rounded-xl border p-6 transition-colors ${index === 0 ? "border-brand bg-brand text-white hover:bg-brand-hover" : "border-border bg-white text-ink hover:border-brand/40"}`;
}
