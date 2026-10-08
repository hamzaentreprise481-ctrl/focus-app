"use client";
import Link from "next/link";
import { useActionState, useState } from "react";
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
  const [email, setEmail] = useState("");
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
          value={email}
          onChange={(event) => setEmail(event.target.value)}
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
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <Link
          href="/connexion/mot-de-passe-oublie"
          className="font-medium text-brand"
        >
          Mot de passe oublié ?
        </Link>
      </div>
      <p className="text-xs leading-relaxed text-ink-soft">
        Votre compte est ouvert sur invitation. Pour obtenir un accès,{" "}
        <Link href="/#contact" className="font-medium text-brand underline">
          demandez une démonstration
        </Link>
        .
      </p>
    </form>
  );
}
