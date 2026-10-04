"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { deleteEvaluationAction } from "@/app/(teacher)/app/actions";

export function DeleteEvaluationButton({
  evaluationId,
  evaluationName,
  resultCount,
}: {
  evaluationId: string;
  evaluationName: string;
  resultCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await deleteEvaluationAction(evaluationId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.push("/app/evaluations");
      router.refresh();
    } catch {
      setError("Suppression impossible. L’évaluation est conservée. Réessayez.");
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) {
          setOpen(next);
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary">Supprimer l’évaluation</Button>
      </DialogTrigger>
      <DialogContent
        title="Supprimer cette évaluation ?"
        description={`« ${evaluationName} » et ${resultCount} résultat${resultCount > 1 ? "s" : ""} saisi${resultCount > 1 ? "s" : ""} (notes, absences, compétences, sujet et copies) seront supprimés définitivement.`}
      >
        <p className="text-sm text-ink-soft">
          Une évaluation dont des copies ont déjà été analysées est conservée
          pour l’historique des élèves : corrigez-la plutôt.
        </p>
        {error && (
          <p role="alert" className="mt-4 rounded-lg border border-border bg-paper p-3 text-sm">
            {error}
          </p>
        )}
        <div className="mt-5 flex flex-wrap justify-end gap-3">
          <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
            Annuler
          </Button>
          <Button onClick={confirm} disabled={pending}>
            {pending ? "Suppression…" : "Supprimer définitivement"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
