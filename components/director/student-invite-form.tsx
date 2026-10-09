"use client";

import { useActionState } from "react";
import { inviteStudent } from "@/app/(director)/director/eleves/actions";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

export function StudentInviteForm({
  classes,
  enabled,
}: {
  classes: { id: string; name: string }[];
  enabled: boolean;
}) {
  const [state, action, pending] = useActionState(inviteStudent, null);

  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <div>
        <Label htmlFor="invite-first-name">Prénom</Label>
        <Input id="invite-first-name" name="first_name" required maxLength={80} disabled={!enabled} />
      </div>
      <div>
        <Label htmlFor="invite-last-name">Nom</Label>
        <Input id="invite-last-name" name="last_name" required maxLength={80} disabled={!enabled} />
      </div>
      <div>
        <Label htmlFor="invite-email">Adresse e-mail</Label>
        <Input id="invite-email" name="email" type="email" required maxLength={254} disabled={!enabled} />
      </div>
      <div>
        <Label htmlFor="invite-class">Classe</Label>
        <select
          id="invite-class"
          name="class_id"
          required
          disabled={!enabled}
          className="mt-1 min-h-10 w-full rounded-lg border border-border-strong bg-white px-3 text-sm disabled:opacity-50"
        >
          <option value="">Choisir une classe</option>
          {classes.map((row) => (
            <option key={row.id} value={row.id}>{row.name}</option>
          ))}
        </select>
      </div>
      {state?.error && (
        <p role="alert" className="sm:col-span-2 rounded-lg bg-watch-soft p-3 text-sm text-watch">
          {state.error}
        </p>
      )}
      {state?.ok && (
        <p role="status" className="sm:col-span-2 rounded-lg bg-normal-soft p-3 text-sm text-normal">
          Invitation envoyée. L’élève doit ouvrir l’e-mail et choisir son mot de passe.
        </p>
      )}
      <div className="sm:col-span-2">
        <Button type="submit" disabled={!enabled || pending || !classes.length}>
          {pending ? "Création en cours…" : "Inviter un élève"}
        </Button>
      </div>
    </form>
  );
}
