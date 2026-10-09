import { StudentSidebar } from "@/components/student/student-sidebar";

export function StudentShell({
  children,
  studentName,
  schoolName,
  className,
}: {
  children: React.ReactNode;
  studentName: string;
  schoolName: string;
  className: string;
}) {
  return (
    <div className="min-h-dvh md:flex">
      <a href="#student-main" className="skip-link">
        Aller au contenu
      </a>
      <StudentSidebar studentName={studentName} />
      <main id="student-main" className="min-w-0 flex-1" tabIndex={-1}>
        <div className="flex flex-wrap justify-between gap-2 border-b border-border px-5 py-4 text-xs text-ink-soft sm:px-8">
          <span>Espace élève</span>
          <span>
            {schoolName} · {className}
          </span>
        </div>
        <div className="mx-auto w-full max-w-[1100px] px-5 py-8 sm:px-8 sm:py-10">
          {children}
        </div>
      </main>
    </div>
  );
}
