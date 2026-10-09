import { StudentTutor } from "@/components/student/student-tutor";

export const maxDuration = 35;

export default function StudentTutorPage() {
  return (
    <div className="space-y-7">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-brand">
          AIDE PERSONNALISÉE
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Poser une question à FOCUS Tutor
        </h1>
        <p className="mt-3 max-w-3xl text-ink-soft">
          Le tuteur peut expliquer vos propres résultats et compétences déjà visibles dans FOCUS.
          Il ne peut ni attribuer une note, ni modifier une correction, ni voir les données des autres élèves.
        </p>
      </header>
      <StudentTutor />
    </div>
  );
}
