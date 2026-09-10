"use client";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { Evaluation, EvaluationDataset, RawGrade } from "@/lib/types";
import { defaultDataset } from "@/lib/analysis";
import {
  loadOverlay,
  persistOverlay,
  type DemoOverlay,
} from "@/lib/demo-store";
import { useTeacher } from "@/components/layout/teacher-context";
const EMPTY_OVERLAY: DemoOverlay = { evaluations: [], rawGrades: [] };
const overlays = new Map<string, DemoOverlay>();
const listeners = new Set<() => void>();
function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}
function getServerSnapshot() {
  return EMPTY_OVERLAY;
}
function getSnapshot(id: string) {
  if (typeof window === "undefined") return EMPTY_OVERLAY;
  if (!overlays.has(id)) overlays.set(id, loadOverlay(id));
  return overlays.get(id)!;
}
export function useDemoData() {
  const { id } = useTeacher();
  const snapshot = useCallback(() => getSnapshot(id), [id]);
  const overlay = useSyncExternalStore(subscribe, snapshot, getServerSnapshot);
  const dataset: EvaluationDataset = useMemo(
    () => ({
      evaluations: [...defaultDataset.evaluations, ...overlay.evaluations],
      rawGrades: [...defaultDataset.rawGrades, ...overlay.rawGrades],
    }),
    [overlay],
  );
  const addEvaluation = useCallback(
    (evaluation: Evaluation, grades: RawGrade[]) => {
      const old = getSnapshot(id);
      const next = {
        evaluations: [...old.evaluations, evaluation],
        rawGrades: [...old.rawGrades, ...grades],
      };
      overlays.set(id, next);
      persistOverlay(next, id);
      listeners.forEach((callback) => callback());
    },
    [id],
  );
  return {
    dataset,
    addedEvaluationIds: useMemo(
      () => overlay.evaluations.map((e) => e.id),
      [overlay],
    ),
    addEvaluation,
  };
}
