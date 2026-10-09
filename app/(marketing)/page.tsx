import Link from "next/link";
import {
  ArrowRight,
  Building2,
  GraduationCap,
  Presentation,
  ShieldCheck,
} from "lucide-react";

const spaces = [
  {
    href: "/connexion",
    title: "Teacher",
    eyebrow: "PROFESSEUR",
    description:
      "Préparer les évaluations, suivre les copies, valider les observations et renseigner les séances.",
    icon: Presentation,
  },
  {
    href: "/connexion-eleve",
    title: "Student",
    eyebrow: "ÉLÈVE",
    description:
      "Consulter ses résultats et sa progression, puis demander de l’aide au tuteur IA sans modifier les notes.",
    icon: GraduationCap,
  },
  {
    href: "/connexion-direction",
    title: "Director",
    eyebrow: "DIRECTION",
    description:
      "Voir les classes, les équipes, les résultats observés et l’avancement pédagogique de l’établissement.",
    icon: Building2,
  },
];

export default function PresentationPage() {
  return (
    <>
      <section className="border-b border-border bg-white">
        <div className="mx-auto grid max-w-[1180px] gap-12 px-6 py-20 lg:grid-cols-[1.05fr_.95fr] lg:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand">
              FOCUS · SUIVI PÉDAGOGIQUE
            </p>
            <h1 className="mt-5 max-w-3xl text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">
              Une plateforme différente pour chaque rôle de l’établissement.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-ink-soft">
              Le professeur enseigne et valide. L’élève comprend et progresse.
              La direction voit l’établissement dans son ensemble. Les mêmes
              données, mais jamais les mêmes permissions.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a
                href="#espaces"
                className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand px-5 py-3 text-sm font-semibold text-white"
              >
                Choisir mon espace <ArrowRight size={17} aria-hidden="true" />
              </a>
              <Link
                href="/fonctionnement"
                className="inline-flex min-h-11 items-center rounded-lg border border-border-strong bg-white px-5 py-3 text-sm font-semibold"
              >
                Comprendre FOCUS
              </Link>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-paper p-7 sm:p-8">
            <ShieldCheck size={24} className="text-brand" aria-hidden="true" />
            <h2 className="mt-5 text-xl font-semibold">
              Les rôles ne sont pas interchangeables.
            </h2>
            <ul className="mt-5 space-y-4 text-sm leading-6 text-ink-soft">
              <li>
                <strong className="text-ink">Student</strong> ne peut pas saisir
                ni modifier une note.
              </li>
              <li>
                <strong className="text-ink">Teacher</strong> garde la décision
                pédagogique et la validation.
              </li>
              <li>
                <strong className="text-ink">Director</strong> dispose d’une vue
                établissement distincte du travail quotidien du professeur.
              </li>
            </ul>
          </div>
        </div>
      </section>

      <section id="espaces" className="bg-paper">
        <div className="mx-auto max-w-[1180px] px-6 py-16">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand">
              ACCÉDER À FOCUS
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">
              Quel est votre rôle ?
            </h2>
            <p className="mt-3 text-ink-soft">
              Chaque compte ouvre uniquement l’espace auquel l’établissement
              l’a autorisé.
            </p>
          </div>

          <div className="mt-8 grid gap-5 lg:grid-cols-3">
            {spaces.map(({ href, title, eyebrow, description, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className="group rounded-2xl border border-border bg-white p-6 transition hover:-translate-y-0.5 hover:border-border-strong"
              >
                <Icon size={23} className="text-brand" aria-hidden="true" />
                <p className="mt-6 text-[11px] font-semibold tracking-[0.14em] text-brand">
                  {eyebrow}
                </p>
                <h3 className="mt-2 text-2xl font-semibold">{title}</h3>
                <p className="mt-3 min-h-20 text-sm leading-6 text-ink-soft">
                  {description}
                </p>
                <span className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-brand">
                  Ouvrir l’espace
                  <ArrowRight
                    size={16}
                    className="transition group-hover:translate-x-1"
                    aria-hidden="true"
                  />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
