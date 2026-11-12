export interface AnalyzableEvidenceSet {
  existing: unknown | null;
}

export function pickNextEvidenceSet<T extends AnalyzableEvidenceSet>(
  orderedNewestFirst: T[],
): T | null {
  if (!orderedNewestFirst.length) return null;
  return (
    orderedNewestFirst.find((item) => item.existing === null) ??
    orderedNewestFirst[0]
  );
}
