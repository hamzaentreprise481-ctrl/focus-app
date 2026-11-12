import Link from "next/link";
import { createAuthClient } from "@/lib/auth/server";
import { NewPasswordForm } from "@/components/auth/password-forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nouveau mot de passe · FOCUS", robots: { index: false, follow: false } };

/** Reached from a verified reset or invitation link (a session exists). */
export default async function NewPasswordPage({ searchParams }: { searchParams: Promise<{ bienvenue?: string }> }) {
  const { bienvenue } = await searchParams;
  const supabase = await createAuthClient();
  let signedIn = false;
  try {
    signedIn = !!supabase && !!(await supabase.auth.getUser()).data.user;
  } catch {
    signedIn = false;
  }
  return (
    <>
      <p className="text-xs font-semibold uppercase tracking-widest text-brand">FOCUS Teacher</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">{bienvenue ? "Bienvenue sur FOCUS" : "Nouveau mot de passe"}</h1>
      <p className="mb-8 mt-3 text-ink-soft">
        {bienvenue ? "Choisissez le mot de passe de votre compte professeur." : "Choisissez un nouveau mot de passe pour votre compte."}
      </p>
      <div className="rounded-2xl border border-border bg-white p-6 sm:p-8">
        {signedIn ? (
          <NewPasswordForm />
        ) : (
          <div role="alert" className="space-y-4 text-sm">
            <p className="rounded-lg bg-watch-soft p-3 text-watch">
              Ce lien n’est plus valable ou la page a été ouverte sans lien. Demandez un nouveau lien de réinitialisation.
            </p>
            <Link href="/connexion/mot-de-passe-oublie" className="font-medium text-brand">
              Demander un nouveau lien
            </Link>
          </div>
        )}
      </div>
    </>
  );
}
