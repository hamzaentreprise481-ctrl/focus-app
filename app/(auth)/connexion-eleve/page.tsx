import { redirect } from "next/navigation";
import { getStudent } from "@/lib/auth/server";
import { authConfig } from "@/lib/auth/config";
import { safeStudentNext } from "@/lib/auth/policy";
import { StudentLoginForm } from "@/components/auth/student-login-form";

export const metadata = {
  title: "Espace élève · FOCUS",
  robots: { index: false, follow: false },
};

export default async function StudentLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; deconnexion?: string }>;
}) {
  const params = await searchParams;
  const next = safeStudentNext(params.next);
  if (await getStudent()) redirect(next);

  const configured = !!authConfig();
  return (
    <>
      <p className="text-xs font-semibold uppercase tracking-widest text-brand">
        FOCUS Student
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">
        Espace élève
      </h1>
      <p className="mb-8 mt-3 text-ink-soft">
        Retrouvez vos évaluations, vos retours et votre progression.
      </p>
      <div className="rounded-2xl border border-border bg-white p-6 sm:p-8">
        {params.deconnexion && (
          <p role="status" className="mb-5 text-sm text-normal">
            {params.deconnexion === "locale"
              ? "Vous êtes déconnecté sur cet appareil. Le service n’a pas confirmé la révocation de la session distante."
              : "Vous êtes déconnecté."}
          </p>
        )}
        {!configured && (
          <p
            role="status"
            className="mb-5 rounded-lg bg-brand-soft p-4 text-sm text-brand-ink"
          >
            L’espace élève est en cours de préparation.
          </p>
        )}
        <StudentLoginForm next={next} configured={configured} />
      </div>
    </>
  );
}
