"use client";

import { useState } from "react";
import { Sparkles, Check } from "lucide-react";
import { Dialog, DialogTrigger, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { RecommendedAction } from "@/lib/analysis";

export function CreateAccompagnementDialog({
  studentFirstName,
  actions,
}: {
  studentFirstName: string;
  actions: RecommendedAction[];
}) {
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setCreated(false);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="primary">
          <Sparkles className="h-4 w-4" />
          Créer un accompagnement
        </Button>
      </DialogTrigger>
      <DialogContent
        title={
          created
            ? "Accompagnement créé"
            : `Accompagnement pour ${studentFirstName}`
        }
        description={
          created
            ? undefined
            : "Cette action est simulée dans le prototype : elle montre comment un suivi pourrait être lancé en un clic."
        }
      >
        {created ? (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-normal-soft text-normal">
              <Check className="h-5 w-5" />
            </span>
            <p className="text-sm text-ink-soft">
              Un plan d&rsquo;accompagnement de {actions.length} action
              {actions.length > 1 ? "s" : ""} a été préparé pour{" "}
              {studentFirstName}. Dans une future version, il serait suivi
              jusqu&rsquo;à sa réalisation.
            </p>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Fermer
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <ul className="space-y-2">
              {actions.map((action, i) => (
                <li
                  key={i}
                  className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-border px-3 py-2 text-sm"
                >
                  <span className="text-ink">{action.label}</span>
                  <span className="shrink-0 text-xs text-muted">
                    {action.minutes} min
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Annuler
              </Button>
              <Button variant="primary" onClick={() => setCreated(true)}>
                Confirmer
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
