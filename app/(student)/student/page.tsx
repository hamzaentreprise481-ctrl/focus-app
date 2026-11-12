import { requireStudent } from "@/lib/auth/server";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  MessageCircleQuestion,
  Sparkles,
  Target,
  TrendingUp,
} from "lucide-react";
import {
  loadStudentAssessments,
  loadStudentIdentity,
  loadStudentProgress,
} from "@/lib/student-data";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(value + "T12:00:00"));
}

export default async function StudentHomePage() {
  await requireStudent();
  const [identity, assessments, progress] = await Promise.all([
    loadStudentIdentity(),
    loadStudentAssessments(),
    loadStudentProgress(),
  ]);
  const recent = assessments.slice(0, 3);
  const graded = assessments.filter((item) => item.status === "graded");
  const mastered = progress.filter((item) => item.level === "mastered").length;
  const masteryRate = progress.length
    ? Math.round((mastered / progress.length) * 100)
    : 0;

  return (
    <div className="space-y-8">
      <section className="overflow-hidden rounded-2xl bg-brand-ink px-6 py-7 text-white shadow-sm sm:px-8 sm:py-9">
        <div className="grid gap-7 lg:grid-cols-[1fr_310px] lg:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/65">
              Votre espace
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              Bonjour {identity.name}.
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/75 sm:text-base">
              Retrouvez ce qui a été saisi et validé par vos professeurs,
              puis utilisez FOCUS pour comprendre ce que vous pouvez travailler
              ensuite.
            </p>
            <p className="mt-4 flex max-w-2xl items-start gap-2 text-xs leading-5 text-white/55">
              <CheckCircle2 size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
              FOCUS n’affiche pas ici de conclusion brute générée par l’IA.
            </p>
          </div>

          <Link
            href="/student/assistant"
            className="group rounded-2xl bg-white p-5 text-ink shadow-sm transition hover:-translate-y-0.5"
          >
            <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-brand">
              <Sparkles size={15} aria-hidden="true" />
              Assistant FOCUS
            </span>
            <strong className="mt-3 block text-lg leading-snug">
              Une notion vous bloque ?
            </strong>
            <span className="mt-1 block text-sm leading-6 text-ink-soft">
              Demandez une explication, un exercice ou une révision adaptée.
            </span>
            <span className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-brand">
              Poser une question
              <ArrowRight
                size={16}
                aria-hidden="true"
                className="transition-transform group-hover:translate-x-1"
              />
            </span>
          </Link>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-border bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-ink-soft">Évaluations corrigées</p>
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-soft text-brand">
              <ClipboardCheck size={18} aria-hidden="true" />
            </span>
          </div>
          <p className="mt-4 text-3xl font-semibold tabular-nums">{graded.length}</p>
          <p className="mt-1 text-xs text-muted">Résultats disponibles</p>
        </div>

        <div className="rounded-2xl border border-border bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-ink-soft">Compétences suivies</p>
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-soft text-brand">
              <Target size={18} aria-hidden="true" />
            </span>
          </div>
          <p className="mt-4 text-3xl font-semibold tabular-nums">{progress.length}</p>
          <p className="mt-1 text-xs text-muted">Dans vos évaluations</p>
        </div>

        <div className="rounded-2xl border border-border bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-ink-soft">Compétences maîtrisées</p>
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-normal-soft text-normal">
              <TrendingUp size={18} aria-hidden="true" />
            </span>
          </div>
          <div className="mt-4 flex items-end justify-between gap-3">
            <p className="text-3xl font-semibold tabular-nums">{mastered}</p>
            <span className="text-xs font-semibold text-normal">{masteryRate} %</span>
          </div>
          <div
            className="mt-3 h-1.5 overflow-hidden rounded-full bg-border"
            role="img"
            aria-label={`Compétences maîtrisées : ${masteryRate} %`}
          >
            <div
              className="h-full rounded-full bg-normal"
              style={{ width: `${masteryRate}%` }}
            />
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(280px,.55fr)]">
        <div>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
                Derniers résultats
              </p>
              <h2 className="mt-1 text-xl font-semibold">Dernières évaluations</h2>
            </div>
            <Link href="/student/evaluations" className="text-sm font-semibold text-brand">
              Tout voir →
            </Link>
          </div>

          <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
            {recent.length ? (
              recent.map((assessment, index) => (
                <Link
                  key={assessment.id}
                  href={"/student/evaluations/" + assessment.id}
                  className={`group flex items-center justify-between gap-4 p-5 transition hover:bg-brand-soft/40 ${
                    index ? "border-t border-border" : ""
                  }`}
                >
                  <div className="min-w-0">
                    <p className="font-medium">{assessment.title}</p>
                    <p className="mt-1 text-sm text-ink-soft">
                      {assessment.subject} · {formatDate(assessment.date)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        assessment.status === "graded"
                          ? "bg-normal-soft text-normal"
                          : assessment.status === "absent"
                            ? "bg-attention-soft text-attention"
                            : "bg-paper text-ink-soft"
                      }`}
                    >
                      {assessment.status === "graded"
                        ? String(assessment.score) + "/20"
                        : assessment.status === "absent"
                          ? "Absent"
                          : "En attente"}
                    </span>
                    <ArrowRight
                      size={17}
                      aria-hidden="true"
                      className="text-muted transition-transform group-hover:translate-x-1"
                    />
                  </div>
                </Link>
              ))
            ) : (
              <div className="p-6 text-sm text-ink-soft">
                Aucune évaluation passée n’est encore disponible.
              </div>
            )}
          </div>
        </div>

        <aside className="rounded-2xl border border-border bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
            Raccourcis
          </p>
          <h2 className="mt-1 text-lg font-semibold">Continuer</h2>
          <div className="mt-4 grid gap-2">
            <Link
              href="/student/evaluations"
              className="group flex items-center gap-3 rounded-xl border border-border p-4 hover:border-border-strong hover:bg-paper"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
                <ClipboardCheck size={18} aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <strong className="block text-sm">Mes évaluations</strong>
                <span className="mt-0.5 block text-xs text-ink-soft">
                  Notes et commentaires
                </span>
              </span>
              <ArrowRight size={15} className="ml-auto text-muted" aria-hidden="true" />
            </Link>
            <Link
              href="/student/progression"
              className="group flex items-center gap-3 rounded-xl border border-border p-4 hover:border-border-strong hover:bg-paper"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-normal-soft text-normal">
                <TrendingUp size={18} aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <strong className="block text-sm">Ma progression</strong>
                <span className="mt-0.5 block text-xs text-ink-soft">
                  Compétences suivies
                </span>
              </span>
              <ArrowRight size={15} className="ml-auto text-muted" aria-hidden="true" />
            </Link>
            <Link
              href="/student/assistant"
              className="group flex items-center gap-3 rounded-xl border border-brand/20 bg-brand-soft p-4 hover:border-brand/40"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-brand">
                <MessageCircleQuestion size={18} aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <strong className="block text-sm text-brand-ink">Assistant FOCUS</strong>
                <span className="mt-0.5 block text-xs text-brand">
                  Expliquer, réviser, s’entraîner
                </span>
              </span>
              <ArrowRight size={15} className="ml-auto text-brand" aria-hidden="true" />
            </Link>
          </div>
        </aside>
      </section>
    </div>
  );
}
