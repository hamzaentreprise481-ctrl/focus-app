import { authConfig } from "@/lib/auth/config";
import { ResetRequestForm } from "@/components/auth/password-forms";

export const metadata = { title: "Mot de passe oublié · FOCUS", robots: { index: false, follow: false } };

export default async function ForgottenPasswordPage({ searchParams }: { searchParams: Promise<{ lien?: string }> }) {
  const { lien } = await searchParams;
  return (
    <>
      <p className="text-xs font-semibold uppercase tracking-widest text-brand">FOCUS Teacher</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">Mot de passe oublié</h1>
      <p className="mb-8 mt-3 text-ink-soft">Indiquez votre adresse : vous recevrez un lien pour choisir un nouveau mot de passe.</p>
      <div className="rounded-2xl border border-border bg-white p-6 sm:p-8">
        {lien === "invalide" && (
          <p role="alert" className="mb-5 rounded-lg bg-watch-soft p-3 text-sm text-watch">
            Ce lien n’est plus valable (déjà utilisé ou expiré). Demandez-en un nouveau ci-dessous.
          </p>
        )}
        <ResetRequestForm configured={!!authConfig()} />
      </div>
    </>
  );
}
