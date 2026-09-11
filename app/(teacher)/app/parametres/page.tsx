import { requireTeacher } from "@/lib/auth/server";

export default async function ParametresPage() {
  const teacher = await requireTeacher();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Paramètres
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          Cette section sera développée dans une prochaine version.
        </p>
      </div>

      <section className="rounded-[var(--radius-lg)] border border-border bg-surface p-5">
        <h2 className="text-[15px] font-semibold text-ink">Compte</h2>
        <div className="mt-4 space-y-3 text-sm">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <span className="text-ink-soft">Nom</span>
            <span className="font-medium text-ink">
              {typeof teacher.user_metadata?.display_name === "string"
                ? teacher.user_metadata.display_name
                : "Professeur"}
            </span>
          </div>
          <div className="flex items-center justify-between border-b border-border pb-3">
            <span className="text-ink-soft">Matière</span>
            <span className="font-medium text-ink">Mathématiques</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-ink-soft">Établissement</span>
            <span className="font-medium text-ink">
              Lycée démonstration FOCUS
            </span>
          </div>
        </div>
      </section>

      <section className="rounded-[var(--radius-lg)] border border-dashed border-border-strong bg-paper p-5">
        <h2 className="text-[15px] font-semibold text-ink">À venir</h2>
        <ul className="mt-3 space-y-1.5 text-sm text-ink-soft">
          <li>— Gestion des classes et droits par établissement</li>
          <li>— Connexion à l&rsquo;ENT / Pronote</li>
          <li>— Notifications de suivi</li>
        </ul>
      </section>
    </div>
  );
}
