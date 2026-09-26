"use client";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function ErrorPage({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <main className="mx-auto max-w-xl space-y-5 px-6 py-20">
      <h1 className="text-2xl font-semibold">
        Cette page n’a pas pu être chargée
      </h1>
      <p className="text-ink-soft">
        Réessayez dans quelques instants. Si le problème persiste après une mise
        à jour, actualisez la page.
      </p>
      <div className="flex flex-wrap gap-3">
        <Button onClick={retry}>Réessayer</Button>
        <Button variant="secondary" asChild>
          <Link href="/connexion">Retour à la connexion</Link>
        </Button>
      </div>
    </main>
  );
}
