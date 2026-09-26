"use client";

import { useSchoolData } from "@/lib/school-data-context";
import { Button } from "@/components/ui/button";

export function DemoDataState() {
  const { source, loaded, storageError, retryStorage } = useSchoolData();
  if (!loaded)
    return (
      <p role="status" className="py-6 text-sm text-ink-soft">
        {source === "demo"
          ? "Chargement des essais enregistrés sur cet appareil…"
          : "Chargement des données de l’établissement…"}
      </p>
    );
  if (!storageError) return null;

  return (
    <div
      role="alert"
      className="my-4 rounded-lg border border-border bg-surface p-4 text-sm"
    >
      <p>{storageError}</p>
      <p className="mt-2 text-ink-soft">
        {source === "demo"
          ? "Seul le jeu d’exemple est affiché. Aucun essai existant n’a été effacé."
          : "FOCUS n’affiche pas de données fictives à la place des données serveur."}
      </p>
      <Button className="mt-3" variant="secondary" onClick={retryStorage}>
        Réessayer la lecture
      </Button>
    </div>
  );
}
