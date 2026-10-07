"use client";

import { useSchoolData } from "@/lib/school-data-context";
import { Button } from "@/components/ui/button";
import { SectionLoading, Feedback } from "@/components/ui/feedback";

export function DataLoadState() {
  const { loaded, storageError, retryStorage } = useSchoolData();
  if (!loaded)
    return (
      <SectionLoading label="Chargement des données de l’établissement…" />
    );
  if (!storageError) return null;

  return (
    <Feedback tone="error">
      <p className="font-semibold">Données momentanément indisponibles</p>
      <p>{storageError}</p>
      <p className="mt-2 text-ink-soft">
        Réessayez le chargement pour retrouver vos classes et vos évaluations.
      </p>
      <Button className="mt-3" variant="secondary" onClick={retryStorage}>
        Réessayer
      </Button>
    </Feedback>
  );
}
