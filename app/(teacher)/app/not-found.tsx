import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";

export default function TeacherNotFound() {
  return (
    <EmptyState
      title="Page introuvable"
      description="Ce lien ne correspond à aucune classe ou aucun élève accessible dans votre espace. Revenez à l’accueil pour retrouver vos données."
      action={
        <Button variant="secondary" asChild>
          <Link href="/app">Retour à l’accueil professeur</Link>
        </Button>
      }
    />
  );
}
