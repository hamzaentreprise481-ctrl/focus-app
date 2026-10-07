"use client";
import Link from "next/link";
import { Button } from "@/components/ui/button";

/** Keeps the teacher's navigation when one page fails; nothing is lost. */
export default function TeacherErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <div role="alert" className="max-w-xl space-y-5 py-10">
      <h1 className="text-2xl font-semibold">Cette page n’a pas pu être chargée</h1>
      <p className="text-ink-soft">
        Les données déjà enregistrées ne sont pas affectées. Réessayez ; si le problème persiste, rechargez la page ou revenez à
        l’accueil.
      </p>
      {error.digest && <p className="text-xs text-muted">Référence de l’incident : {error.digest}</p>}
      <div className="flex flex-wrap gap-3">
        <Button onClick={() => retry()}>Réessayer</Button>
        <Button variant="secondary" asChild>
          <Link href="/app">Retour à l’accueil</Link>
        </Button>
      </div>
    </div>
  );
}
