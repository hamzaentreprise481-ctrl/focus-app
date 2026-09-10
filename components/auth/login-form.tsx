"use client";
import { useActionState } from "react";
import { login } from "@/app/(auth)/connexion/actions";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function LoginForm({
  next,
  configured,
}: {
  next: string;
  configured: boolean;
}) {
  const [state, action, pending] = useActionState(login, null);
  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="next" value={next} />
      <div>
        <Label htmlFor="email">Adresse e-mail professionnelle</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          maxLength={254}
          required
          disabled={!configured}
        />
      </div>
      <div>
        <Label htmlFor="password">Mot de passe</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          maxLength={1024}
          required
          disabled={!configured}
        />
      </div>
      {state?.error && (
        <p
          role="alert"
          className="rounded-lg bg-watch-soft p-3 text-sm text-watch"
        >
          {state.error}
        </p>
      )}
      <Button
        type="submit"
        className="w-full"
        disabled={pending || !configured}
      >
        {pending ? "Connexion en cours…" : "Se connecter"}
      </Button>
      <p className="text-xs leading-relaxed text-ink-soft">
        Votre compte est ouvert par l’équipe FOCUS. Pour obtenir un accès ou
        réinitialiser votre mot de passe, contactez la personne qui vous a
        invité.
      </p>
    </form>
  );
}
