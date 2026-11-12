"use client";
import Link from "next/link";
import { useActionState } from "react";
import { requestPasswordReset, setNewPassword } from "@/app/(auth)/connexion/password-actions";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

function Alert({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="rounded-lg bg-watch-soft p-3 text-sm text-watch">
      {children}
    </p>
  );
}

export function ResetRequestForm({ configured }: { configured: boolean }) {
  const [state, action, pending] = useActionState(requestPasswordReset, null);
  if (state?.sent)
    return (
      <div role="status" className="space-y-4 text-sm">
        <p className="rounded-lg bg-normal-soft p-4 text-normal">
          Si un compte correspond à cette adresse, un e-mail contenant un lien de réinitialisation vient d’être envoyé. Le lien est
          valable peu de temps et ne sert qu’une fois.
        </p>
        <p className="text-ink-soft">Pensez à vérifier le dossier des courriers indésirables.</p>
        <Link href="/connexion" className="font-medium text-brand">
          Retour à la connexion
        </Link>
      </div>
    );
  return (
    <form action={action} className="space-y-5">
      <div>
        <Label htmlFor="reset-email">Adresse e-mail professionnelle</Label>
        <Input id="reset-email" name="email" type="email" autoComplete="username" maxLength={254} required disabled={!configured} />
      </div>
      {state?.error && <Alert>{state.error}</Alert>}
      <Button type="submit" className="w-full" disabled={pending || !configured}>
        {pending ? "Envoi en cours…" : "Recevoir un lien de réinitialisation"}
      </Button>
      <Link href="/connexion" className="block text-center text-sm text-ink-soft">
        Retour à la connexion
      </Link>
    </form>
  );
}

export function NewPasswordForm() {
  const [state, action, pending] = useActionState(setNewPassword, null);
  return (
    <form action={action} className="space-y-5">
      <div>
        <Label htmlFor="new-password">Nouveau mot de passe</Label>
        <Input id="new-password" name="password" type="password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} maxLength={128} required />
        <p className="mt-1 text-xs text-ink-soft">Au moins {MIN_PASSWORD_LENGTH} caractères. Une phrase de plusieurs mots convient bien.</p>
      </div>
      <div>
        <Label htmlFor="new-password-confirmation">Confirmer le mot de passe</Label>
        <Input id="new-password-confirmation" name="confirmation" type="password" autoComplete="new-password" maxLength={128} required />
      </div>
      {state?.error && <Alert>{state.error}</Alert>}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Enregistrement…" : "Enregistrer le mot de passe"}
      </Button>
    </form>
  );
}
