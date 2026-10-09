"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { studentLogin } from "@/app/(auth)/connexion-eleve/actions";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function StudentLoginForm({
  next,
  configured,
}: {
  next: string;
  configured: boolean;
}) {
  const [state, action, pending] = useActionState(studentLogin, null);
  const [email, setEmail] = useState("");

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="next" value={next} />
      <div>
        <Label htmlFor="student-email">Adresse e-mail</Label>
        <Input
          id="student-email"
          name="email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          maxLength={254}
          required
          disabled={!configured}
        />
      </div>
      <div>
        <Label htmlFor="student-password">Mot de passe</Label>
        <Input
          id="student-password"
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
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <Link
          href="/connexion/mot-de-passe-oublie"
          className="font-medium text-brand"
        >
          Mot de passe oublié ?
        </Link>
      </div>
      <p className="text-xs leading-relaxed text-ink-soft">
        Votre accès est fourni par votre établissement. FOCUS n’autorise pas
        l’inscription libre d’un compte élève.
      </p>
    </form>
  );
}
