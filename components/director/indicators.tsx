import Link from "next/link";
import { cn } from "@/lib/utils";
import { PACE_LABEL, percent, type PaceResult } from "@/lib/director/metrics";
import type { ProgrammeRow } from "@/lib/director/data";

export function formatDate(value: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(value + "T12:00:00"));
}

export function PageIntro({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="mb-8">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        {title}
      </h1>
      {children && (
        <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-soft">
          {children}
        </p>
      )}
    </header>
  );
}

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-white p-5">
      <p className="text-sm text-ink-soft">{label}</p>
      <p className="mt-2 text-3xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

/** "x / N unit (p %)" with a neutral bar; "Non renseigné" when N is 0. */
export function Measure({
  label,
  part,
  total,
  unit,
  empty = "Non renseigné",
}: {
  label: string;
  part: number;
  total: number;
  unit: string;
  empty?: string;
}) {
  const value = percent(part, total);
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-sm text-ink-soft">{label}</span>
        <span className="text-sm font-medium tabular-nums">
          {value === null ? (
            <span className="text-muted">{empty}</span>
          ) : (
            <>
              {part} / {total} {unit} · {value} %
            </>
          )}
        </span>
      </div>
      <div
        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-border"
        role="img"
        aria-label={
          value === null ? `${label} : ${empty}` : `${label} : ${value} %`
        }
      >
        {value !== null && (
          <div
            className="h-full rounded-full bg-brand"
            style={{ width: `${value}%` }}
          />
        )}
      </div>
    </div>
  );
}

const PACE_TONE: Record<PaceResult["status"], string> = {
  no_programme: "bg-paper text-ink-soft",
  no_data: "bg-paper text-ink-soft",
  too_early: "bg-paper text-ink-soft",
  done: "bg-normal-soft text-normal",
  on_track: "bg-normal-soft text-normal",
  watch: "bg-watch-soft text-watch",
  at_risk: "bg-attention-soft text-attention",
};

export function PaceBadge({ pace }: { pace: PaceResult }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2.5 py-1 text-xs font-medium",
        PACE_TONE[pace.status],
      )}
    >
      {PACE_LABEL[pace.status]}
    </span>
  );
}

/** One line of figures behind a pace status, so it can be checked. */
export function PaceDetail({ pace }: { pace: PaceResult }) {
  if (pace.status === "no_programme")
    return <>Aucune compétence au référentiel de cette matière.</>;
  if (pace.status === "no_data")
    return <>Aucune séance reliée au référentiel n’est déclarée.</>;
  if (pace.status === "too_early")
    return (
      <>
        {pace.covered} / {pace.total} déclarées · {pace.elapsedWeeks} semaines
        écoulées : trop tôt pour mesurer un rythme.
      </>
    );
  return (
    <>
      {pace.covered} / {pace.total} déclarées · {pace.remaining} restantes ·{" "}
      {pace.remainingWeeks} semaines restantes · rythme observé{" "}
      {pace.observedPerWeek ?? "—"} / semaine, nécessaire{" "}
      {pace.neededPerWeek ?? "—"} / semaine
      {pace.ratioPercent !== null && ` (${pace.ratioPercent} % du rythme nécessaire)`}
    </>
  );
}

export function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-white p-6 text-sm leading-6 text-ink-soft">
      {children}
    </div>
  );
}

export function SectionTitle({
  title,
  href,
  linkLabel,
}: {
  title: string;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      {href && (
        <Link href={href} className="text-sm font-medium text-brand">
          {linkLabel ?? "Tout voir"} →
        </Link>
      )}
    </div>
  );
}

/** One class × subject: the three dimensions side by side, never merged. */
export function ProgrammeRowCard({
  row,
  showClass = true,
}: {
  row: ProgrammeRow;
  showClass?: boolean;
}) {
  return (
    <article className="rounded-xl border border-border bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold">
            {showClass ? `${row.className} · ${row.subjectName}` : row.subjectName}
          </h3>
          <p className="mt-0.5 text-sm text-ink-soft">
            {row.teacherNames.length ? row.teacherNames.join(", ") : "Aucun enseignant affecté"}
            {" · "}
            {row.lessons} séance{row.lessons > 1 ? "s" : ""} déclarée{row.lessons > 1 ? "s" : ""}
            {" · "}
            {row.pastAssessments} évaluation{row.pastAssessments > 1 ? "s" : ""} passée{row.pastAssessments > 1 ? "s" : ""}
          </p>
        </div>
        <PaceBadge pace={row.pace} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Measure
          label="Programme enseigné (référentiel déclaré traité)"
          part={row.referential.taught}
          total={row.referential.total}
          unit="compétences"
        />
        {row.official.available ? (
          <Measure
            label="Programme évalué (notions du programme officiel)"
            part={row.official.evaluated}
            total={row.official.total}
            unit="notions"
          />
        ) : (
          <Measure
            label="Programme évalué (référentiel)"
            part={row.referential.evaluated}
            total={row.referential.total}
            unit="compétences"
          />
        )}
        <Measure
          label="Compétences documentées (niveaux saisis)"
          part={row.documented.entered}
          total={row.documented.expected}
          unit="niveaux"
          empty="Aucun niveau attendu"
        />
      </div>
      <p className="mt-3 text-xs leading-5 text-muted">
        <PaceDetail pace={row.pace} />
      </p>
    </article>
  );
}
