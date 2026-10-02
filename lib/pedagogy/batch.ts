// Analysing every copy of an assessment, one copy per request.
//
// The browser drives the loop: each copy is one call of the analysis action,
// persisted (or refused) on its own, so a long class never exceeds a server
// function's time limit, a stop keeps everything already analysed, and a
// second run only picks up the copies still waiting.

import type { ModelAnalysisStatus, ResponseOverviewRow } from "@/lib/pedagogy/types";

/** Why the analysis action refused, when the reason is not about one copy. */
export type AnalysisFailureCode = "ai_not_configured" | "rate_limited";

export type BatchItem =
  | { studentId: string; name: string; status: ModelAnalysisStatus; recommendationCount: number; reused: boolean }
  | { studentId: string; name: string; status: "failed"; error: string };

/** Students whose saved copy has no current analysis, in roster order. */
export function copiesToAnalyse(
  students: ReadonlyArray<{ id: string; name: string }>,
  overview: ReadonlyMap<string, ResponseOverviewRow>,
) {
  return students.filter((student) => overview.get(student.id)?.needsAnalysis === true);
}

/** After three failures in a row the service is down: stop instead of failing every copy. */
export const MAX_CONSECUTIVE_FAILURES = 3;

/** Whether the loop must stop after this item, and why. */
export function batchStopReason(
  items: readonly BatchItem[],
  lastFailureCode?: AnalysisFailureCode,
): string | null {
  if (lastFailureCode === "ai_not_configured") return "L’IA n’est pas configurée sur ce serveur : aucune copie ne peut être analysée.";
  if (lastFailureCode === "rate_limited") return "La limite horaire d’analyses est atteinte : relancez plus tard, les copies déjà analysées sont conservées.";
  const tail = items.slice(-MAX_CONSECUTIVE_FAILURES);
  if (tail.length === MAX_CONSECUTIVE_FAILURES && tail.every((item) => item.status === "failed"))
    return `${MAX_CONSECUTIVE_FAILURES} échecs consécutifs : le service d’analyse semble indisponible. Les copies déjà analysées sont conservées.`;
  return null;
}

export interface BatchSummary {
  analysed: number;
  errorsFound: number;
  noErrorObserved: number;
  insufficientEvidence: number;
  failed: number;
  hypotheses: number;
}

export function summarizeBatch(items: readonly BatchItem[]): BatchSummary {
  const summary: BatchSummary = { analysed: 0, errorsFound: 0, noErrorObserved: 0, insufficientEvidence: 0, failed: 0, hypotheses: 0 };
  for (const item of items) {
    if (item.status === "failed") {
      summary.failed++;
      continue;
    }
    summary.analysed++;
    summary.hypotheses += item.recommendationCount;
    if (item.status === "errors_found") summary.errorsFound++;
    else if (item.status === "no_error_observed") summary.noErrorObserved++;
    else summary.insufficientEvidence++;
  }
  return summary;
}

const plural = (count: number, one: string, many: string) => `${count} ${count > 1 ? many : one}`;

/** One sentence for the teacher; "no error" is never presented as mastery. */
export function batchSummaryText(summary: BatchSummary): string {
  if (!summary.analysed && !summary.failed) return "Aucune copie n’attendait d’analyse.";
  const parts: string[] = [];
  if (summary.errorsFound)
    parts.push(`${plural(summary.errorsFound, "copie", "copies")} avec erreur(s) observée(s) (${plural(summary.hypotheses, "hypothèse", "hypothèses")} à examiner)`);
  if (summary.noErrorObserved)
    parts.push(`${plural(summary.noErrorObserved, "copie", "copies")} sans erreur observée — ce n’est pas une preuve de maîtrise`);
  if (summary.insufficientEvidence) parts.push(`${plural(summary.insufficientEvidence, "copie", "copies")} : preuves insuffisantes`);
  if (summary.failed) parts.push(`${plural(summary.failed, "échec", "échecs")}, à relancer`);
  return `${plural(summary.analysed, "copie analysée", "copies analysées")} : ${parts.join(" ; ")}.`;
}
