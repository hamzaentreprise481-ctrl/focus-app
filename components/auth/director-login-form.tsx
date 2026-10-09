"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { directorLogin } from "@/app/(auth)/connexion-direction/actions";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function DirectorLoginForm({
  next,
  configured,
}: {
  next: string;
  configured: boolean;
}) {
  const [state, action, pending] = useActionState(directorLogin, null);
  const [email, setEmail] = useState("");

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="next" value={next} />
      <div>
        <Label htmlFor="director-email">Adresse e-mail</Label>
        <Input
          id="director-email"
          name="email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          maxLength={254}
          disabled={!configured}
        />
      </div>
      <div>
        <Label htmlFor="director-password">Mot de passe</Label>
        <Input
          id="director-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={1024}
          disabled={!configured}
        />
      </div>
      {state?.error && (
        <p role="alert" className="rounded-lg bg-watch-soft p-3 text-sm text-watch">
          {state.error}
        </p>
      )}
      <Button className="w-full" disabled={pending || !configured}>
        {pending ? "Connexion en cours…" : "Se connecter"}
      </Button>
      <Link
        href="/connexion/mot-de-passe-oublie"
        className="inline-block text-sm font-medium text-brand"
      >
        Mot de passe oublié ?
      </Link>
    </form>
  );
}
