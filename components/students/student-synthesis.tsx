"use client";

import { CONFIDENCE_LABEL, type StudentAnalysis } from "@/lib/analysis";

/**
 * The deterministic reading of a student's results, in three distinct
 * parts: what was recorded, a cautious interpretation, and next steps that
 * each point back to an observation. Teacher judgment remains final.
 */
export function StudentSynthesis({
  analysis,
  firstName,
}: {
  analysis: StudentAnalysis;
  firstName: string;
}) {
  const insufficient = analysis.pattern === "donnees_insuffisantes";
  return (
    <section
      aria-labelledby="synthesis-title"
      className="rounded-xl border border-border bg-surface p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand">
          Lecture des résultats
        </p>
        <p className="text-xs text-ink-soft" data-testid="signal-reliability">
          Fiabilité du signal : {CONFIDENCE_LABEL[analysis.confidence]} · Basé
          sur {analysis.signalBasis}
        </p>
      </div>
      <h2 id="synthesis-title" className="mt-3 text-xl font-medium">
        {analysis.summary}
      </h2>

      <div className="mt-5 grid gap-6 lg:grid-cols-3">
        <div>
          <h3 className="text-sm font-semibold">Ce qui a été saisi</h3>
          <ul className="mt-2 space-y-2 text-sm text-ink-soft">
            {analysis.evidence.map((item) => (
              <li key={item.label}>
                <span className="font-medium text-ink">{item.label} : </span>
                {item.detail}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="text-sm font-semibold">Lecture possible</h3>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">
            {analysis.narrative}
          </p>
        </div>
        <div>
          <h3 className="text-sm font-semibold">Pistes à envisager</h3>
          {analysis.recommendedActions.length ? (
            <ul className="mt-2 space-y-2 text-sm">
              {analysis.recommendedActions.map((action) => (
                <li key={action.label}>
                  {action.label}
                  <span className="block text-xs text-ink-soft">
                    Environ {action.minutes} min
                    {action.because ? ` · en lien avec : ${action.because}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-ink-soft">
              {insufficient
                ? `Pas de piste tant que les résultats de ${firstName} sont trop peu nombreux : une prochaine évaluation notée, avec les compétences renseignées, permettra une première lecture.`
                : "Aucune piste particulière : les résultats disponibles ne montrent pas de signal à traiter."}
            </p>
          )}
        </div>
      </div>

      <p className="mt-5 text-xs text-ink-soft">
        Lecture issue de règles explicites, sans prédiction. Les pistes sont
        des suggestions : votre connaissance de l’élève prime.
      </p>
    </section>
  );
}
