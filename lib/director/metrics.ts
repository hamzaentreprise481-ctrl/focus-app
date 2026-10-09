// Deterministic indicators of FOCUS Direction. Pure functions: the same
// inputs always give the same figures, and every threshold is written here
// (and shown in /director/parametres) — no language model computes them.
//
// Three dimensions are never merged:
//   - programme enseigné: what teachers DECLARED as taught (lessons);
//   - programme évalué:   what assessments covered;
//   - compétences documentées: explicit competency levels entered.
// None of them says that students master the programme.

const DAY_MS = 24 * 60 * 60 * 1000;

/** Rounded percentage, or null when there is nothing to measure. */
export function percent(part: number, total: number): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return null;
  return Math.round((Math.min(part, total) / total) * 100);
}

function day(value: string) {
  // Dates are calendar days (YYYY-MM-DD): compare them at noon UTC.
  return Date.parse(value + "T12:00:00Z");
}

export type PaceStatus =
  /** No programme to measure (no référentiel or no official programme). */
  | "no_programme"
  /** Nothing declared yet: missing data, never presented as a delay. */
  | "no_data"
  /** Less than MIN_ELAPSED_WEEKS of school year: a pace means nothing yet. */
  | "too_early"
  | "done"
  | "on_track"
  | "watch"
  | "at_risk";

export interface PaceInput {
  /** Units declared as taught so far (distinct). */
  covered: number;
  /** Units of the programme for this class and subject. */
  total: number;
  yearStart: string;
  yearEnd: string;
  today: string;
}

export interface PaceResult {
  status: PaceStatus;
  covered: number;
  total: number;
  remaining: number;
  /** Calendar weeks since the start of the year (holidays not deducted). */
  elapsedWeeks: number;
  /** Calendar weeks until the end of the year (holidays not deducted). */
  remainingWeeks: number;
  /** Units per week observed so far; null before any data. */
  observedPerWeek: number | null;
  /** Units per week needed to finish by the end of the year. */
  neededPerWeek: number | null;
  /** Observed pace as a percentage of the needed pace (the status basis). */
  ratioPercent: number | null;
}

/** Below this many elapsed weeks the observed pace is not interpreted. */
export const MIN_ELAPSED_WEEKS = 3;
/** "Vigilance" when the observed pace is at least this share of the needed pace. */
export const WATCH_RATIO = 0.8;

function round1(value: number) {
  return Math.round(value * 10) / 10;
}
function round2(value: number) {
  return Math.round(value * 100) / 100;
}

/**
 * Pace of the declared programme against the time left in the school year:
 * on track when the observed pace (units per week so far) reaches the pace
 * needed to cover the rest before the end of the year; "vigilance" from
 * WATCH_RATIO of it; at risk below. Calendar weeks are used on both sides
 * (school holidays are not known to FOCUS), which the UI states.
 */
export function programmePace(input: PaceInput): PaceResult {
  const total = Math.max(0, Math.floor(input.total));
  const covered = Math.max(0, Math.min(Math.floor(input.covered), total));
  const remaining = total - covered;
  const start = day(input.yearStart);
  const end = day(input.yearEnd);
  const now = Math.min(Math.max(day(input.today), start), end);
  // Exact values decide; rounded ones are only displayed.
  const elapsed = Math.max(0, (now - start) / DAY_MS / 7);
  const left = Math.max(0, (end - now) / DAY_MS / 7);
  const base = { covered, total, remaining, elapsedWeeks: round1(elapsed), remainingWeeks: round1(left) };
  const none = { observedPerWeek: null, neededPerWeek: null, ratioPercent: null };

  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
    return { ...base, ...none, status: "no_data" };
  if (total === 0) return { ...base, ...none, status: "no_programme" };
  if (covered === 0) return { ...base, ...none, status: "no_data" };
  if (remaining === 0)
    return { ...base, status: "done", observedPerWeek: elapsed > 0 ? round2(covered / elapsed) : null, neededPerWeek: 0, ratioPercent: null };
  if (elapsed < MIN_ELAPSED_WEEKS) return { ...base, ...none, status: "too_early" };

  const observed = covered / elapsed;
  if (left <= 0)
    return { ...base, status: "at_risk", observedPerWeek: round2(observed), neededPerWeek: null, ratioPercent: null };
  const needed = remaining / left;
  const ratio = observed / needed;
  const status: PaceStatus = ratio >= 1 ? "on_track" : ratio >= WATCH_RATIO ? "watch" : "at_risk";
  return {
    ...base,
    status,
    observedPerWeek: round2(observed),
    neededPerWeek: round2(needed),
    // Floored so that a status shown as "vigilance" never reads 100 %.
    ratioPercent: Math.floor(ratio * 100),
  };
}

export const PACE_LABEL: Record<PaceStatus, string> = {
  no_programme: "Programme non défini",
  no_data: "Non renseigné",
  too_early: "Trop tôt pour conclure",
  done: "Programme déclaré traité",
  on_track: "Dans les temps",
  watch: "Vigilance",
  at_risk: "Risque de retard",
};

/** Calendar days between two YYYY-MM-DD dates (b - a). */
export function daysBetween(a: string, b: string) {
  return Math.round((day(b) - day(a)) / DAY_MS);
}
