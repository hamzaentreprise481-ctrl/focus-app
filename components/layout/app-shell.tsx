import { Sidebar } from "@/components/layout/sidebar";
import { TeacherProvider } from "@/components/layout/teacher-context";
export function AppShell({
  children,
  teacherName,
  teacherId,
}: {
  children: React.ReactNode;
  teacherName: string;
  teacherId: string;
}) {
  return (
    <TeacherProvider name={teacherName} id={teacherId}>
      <div className="teacher-shell">
        <a href="#main-content" className="skip-link">
          Aller au contenu
        </a>
        <Sidebar teacherName={teacherName} />
        <main id="main-content" className="teacher-main" tabIndex={-1}>
          <div className="teacher-topline">
            <span>Espace professeur</span>
            <span>Démonstration · données fictives uniquement</span>
          </div>
          <div className="mx-auto w-full max-w-[1180px] px-5 py-8 sm:px-8 sm:py-10 lg:px-10">
            {children}
          </div>
        </main>
      </div>
    </TeacherProvider>
  );
}
