import { requireStudent } from "@/lib/auth/server";
import { loadStudentIdentity } from "@/lib/student-data";

export default async function StudentProfilePage() {
  await requireStudent();
  const identity = await loadStudentIdentity();

  return (
    <div className="space-y-7">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-brand">
          Compte
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Mon profil
        </h1>
        <p className="mt-3 text-ink-soft">
          Informations actuellement associées à votre accès FOCUS.
        </p>
      </header>

      <dl className="divide-y divide-border rounded-xl border border-border bg-white">
        <div className="grid gap-1 p-5 sm:grid-cols-[180px_1fr]">
          <dt className="text-sm text-ink-soft">Nom</dt>
          <dd className="font-medium">{identity.name}</dd>
        </div>
        <div className="grid gap-1 p-5 sm:grid-cols-[180px_1fr]">
          <dt className="text-sm text-ink-soft">Adresse e-mail</dt>
          <dd className="font-medium">{identity.email ?? "Non renseignée"}</dd>
        </div>
        <div className="grid gap-1 p-5 sm:grid-cols-[180px_1fr]">
          <dt className="text-sm text-ink-soft">Établissement</dt>
          <dd className="font-medium">{identity.schoolName}</dd>
        </div>
        <div className="grid gap-1 p-5 sm:grid-cols-[180px_1fr]">
          <dt className="text-sm text-ink-soft">Classe</dt>
          <dd className="font-medium">{identity.className}</dd>
        </div>
        <div className="grid gap-1 p-5 sm:grid-cols-[180px_1fr]">
          <dt className="text-sm text-ink-soft">Niveau</dt>
          <dd className="font-medium">
            {identity.classLevel ?? "Non renseigné"}
          </dd>
        </div>
      </dl>

      <div className="rounded-xl border border-border bg-paper p-5 text-sm leading-6 text-ink-soft">
        Les changements d’établissement, de classe ou de rôle sont gérés par
        l’établissement. L’élève ne peut pas modifier lui-même ses droits
        d’accès.
      </div>
    </div>
  );
}
