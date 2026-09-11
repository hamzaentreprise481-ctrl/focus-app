"use client";
import { useState } from "react";
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
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">Examiner les pistes proposées</Button>
      </DialogTrigger>
      <DialogContent
        title={`Pistes pour ${studentFirstName}`}
        description="Ces pistes sont à adapter à votre jugement. Aucun plan ni suivi n’est enregistré dans cette version."
      >
        <ul className="space-y-3">
          {actions.map((action) => (
            <li
              key={action.label}
              className="border-b border-border pb-3 text-sm"
            >
              <p>{action.label}</p>
              <p className="mt-1 text-xs text-ink-soft">
                Durée indicative : {action.minutes} min, à ajuster
              </p>
            </li>
          ))}
        </ul>
        <div className="mt-5 flex justify-end">
          <Button onClick={() => setOpen(false)}>Revenir à la fiche</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
