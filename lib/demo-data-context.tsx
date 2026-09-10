"use client";

// Petit store externe (au sens de useSyncExternalStore) pour les données de
// démonstration ajoutées en session : une évaluation créée doit se refléter
// immédiatement dans le tableau de bord, la liste des évaluations et les
// fiches élèves concernées, ET survivre à un rechargement de page via
// localStorage — sans backend.
//
// On utilise useSyncExternalStore plutôt qu'un useState+useEffect classique :
// c'est le mécanisme prévu par React pour lire une source de données externe
// (ici le localStorage du navigateur, absent côté serveur) sans provoquer de
// désynchronisation d'hydratation ni de cascade de rendus.

import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { Evaluation, EvaluationDataset, RawGrade } from "@/lib/types";
import { defaultDataset } from "@/lib/analysis";
import { loadOverlay, persistOverlay, type DemoOverlay } from "@/lib/demo-store";

const EMPTY_OVERLAY: DemoOverlay = { evaluations: [], rawGrades: [] };

let currentOverlay: DemoOverlay = EMPTY_OVERLAY;
let loadedFromStorage = false;
const listeners = new Set<() => void>();

function ensureLoaded() {
  if (loadedFromStorage || typeof window === "undefined") return;
  currentOverlay = loadOverlay();
  loadedFromStorage = true;
}

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function getSnapshot(): DemoOverlay {
  ensureLoaded();
  return currentOverlay;
}

function getServerSnapshot(): DemoOverlay {
  return EMPTY_OVERLAY;
}

function addEvaluationToStore(evaluation: Evaluation, grades: RawGrade[]) {
  ensureLoaded();
  currentOverlay = {
    evaluations: [...currentOverlay.evaluations, evaluation],
    rawGrades: [...currentOverlay.rawGrades, ...grades],
  };
  persistOverlay(currentOverlay);
  listeners.forEach((callback) => callback());
}

export function useDemoData() {
  const overlay = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const dataset: EvaluationDataset = useMemo(
    () => ({
      evaluations: [...defaultDataset.evaluations, ...overlay.evaluations],
      rawGrades: [...defaultDataset.rawGrades, ...overlay.rawGrades],
    }),
    [overlay]
  );

  const addEvaluation = useCallback((evaluation: Evaluation, grades: RawGrade[]) => {
    addEvaluationToStore(evaluation, grades);
  }, []);

  return {
    dataset,
    addedEvaluationIds: useMemo(() => overlay.evaluations.map((e) => e.id), [overlay]),
    addEvaluation,
  };
}
