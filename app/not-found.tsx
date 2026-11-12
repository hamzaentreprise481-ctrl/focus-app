import Link from "next/link";
export default function NotFound() {
  return (
    <main className="mx-auto max-w-xl space-y-4 px-6 py-20">
      <h1 className="text-2xl font-semibold">Page introuvable</h1>
      <p>Ce lien n’existe plus ou son adresse est incorrecte.</p>
      <Link href="/" className="font-medium text-brand">
        Retour à l’accueil
      </Link>
    </main>
  );
}
