import { redirect } from "next/navigation";
import { getTeacher } from "@/lib/auth/server";
import { authConfig } from "@/lib/auth/config";
import { safeNext } from "@/lib/auth/policy";
import { LoginForm } from "@/components/auth/login-form";
export const metadata = {
  title: "Espace professeur · FOCUS",
  robots: { index: false, follow: false },
};
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; deconnexion?: string }>;
}) {
  const params = await searchParams;
  const next = safeNext(params.next);
  if (await getTeacher()) redirect(next);
  const configured = !!authConfig();
  return (
    <>
      <p className="text-xs font-semibold uppercase tracking-widest text-brand">
        FOCUS Teacher
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">
        Espace professeur
      </h1>
      <p className="mb-8 mt-3 text-ink-soft">
        Retrouvez votre classe et reprenez votre suivi, à votre rythme.
      </p>
      <div className="rounded-2xl border border-border bg-white p-6 sm:p-8">
        {params.deconnexion && (
          <p role="status" className="mb-5 text-sm text-normal">
            Vous êtes déconnecté.
          </p>
        )}
        {!configured && (
          <p
            role="status"
            className="mb-5 rounded-lg bg-brand-soft p-4 text-sm text-brand-ink"
          >
            L’espace professeur est en cours de préparation. La connexion sera
            disponible après son activation par l’équipe FOCUS.
          </p>
        )}
        <LoginForm next={next} configured={configured} />
      </div>
    </>
  );
}
