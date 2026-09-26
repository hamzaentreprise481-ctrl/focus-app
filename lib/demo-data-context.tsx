"use client";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { Evaluation, EvaluationDataset, RawGrade } from "@/lib/types";
import { defaultDataset } from "@/lib/demo/dataset";
import {
  loadOverlay,
  persistOverlay,
  type DemoOverlay,
} from "@/lib/demo-store";
import { SchoolDataProvider } from "@/lib/school-data-context";
import { useTeacher } from "@/components/layout/teacher-context";

interface Snapshot {
  overlay: DemoOverlay;
  loaded: boolean;
  error: string | null;
}
const INITIAL: Snapshot = {
  overlay: { evaluations: [], rawGrades: [] },
  loaded: false,
  error: null,
};
const snapshots = new Map<string, Snapshot>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((callback) => callback());
function storageChanged(event: StorageEvent) {
  if (event.key !== null && !event.key.startsWith("focus-demo-overlay-v2:"))
    return;
  snapshots.clear();
  emit();
}
function subscribe(callback: () => void) {
  if (!listeners.size) window.addEventListener("storage", storageChanged);
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
    if (!listeners.size) window.removeEventListener("storage", storageChanged);
  };
}
function getSnapshot(id: string): Snapshot {
  if (typeof window === "undefined") return INITIAL;
  if (!snapshots.has(id)) {
    try {
      snapshots.set(id, {
        overlay: loadOverlay(id),
        loaded: true,
        error: null,
      });
    } catch (error) {
      snapshots.set(id, {
        ...INITIAL,
        loaded: true,
        error: (error as Error).message,
      });
    }
  }
  return snapshots.get(id)!;
}
const getServerSnapshot = () => INITIAL;

function useDemoData() {
  const { id } = useTeacher();
  const snapshot = useCallback(() => getSnapshot(id), [id]);
  const state = useSyncExternalStore(subscribe, snapshot, getServerSnapshot);
  const dataset: EvaluationDataset = useMemo(
    () => ({
      ...defaultDataset,
      evaluations: [
        ...defaultDataset.evaluations,
        ...state.overlay.evaluations,
      ],
      rawGrades: [...defaultDataset.rawGrades, ...state.overlay.rawGrades],
    }),
    [state.overlay],
  );
  const saveEvaluation = useCallback(
    async (evaluation: Evaluation, grades: RawGrade[]) => {
      try {
        // Re-read before writing so sequential saves in other tabs are preserved.
        const old = loadOverlay(id);
        const next = {
          evaluations: [
            ...old.evaluations.filter((e) => e.id !== evaluation.id),
            evaluation,
          ],
          rawGrades: [
            ...old.rawGrades.filter((g) => g.evaluationId !== evaluation.id),
            ...grades,
          ],
        };
        persistOverlay(next, id);
        snapshots.set(id, { overlay: next, loaded: true, error: null });
        emit();
        return { ok: true as const };
      } catch (error) {
        return { ok: false as const, error: (error as Error).message };
      }
    },
    [id],
  );
  const retryStorage = useCallback(() => {
    snapshots.delete(id);
    emit();
  }, [id]);
  return {
    dataset,
    source: "demo" as const,
    loaded: state.loaded,
    storageError: state.error,
    retryStorage,
    editableEvaluationIds: useMemo(
      () => state.overlay.evaluations.map((e) => e.id),
      [state.overlay],
    ),
    saveEvaluation,
  };
}


export function DemoDataProvider({ children }: { children: React.ReactNode }) {
  const value = useDemoData();
  return <SchoolDataProvider value={value}>{children}</SchoolDataProvider>;
}
