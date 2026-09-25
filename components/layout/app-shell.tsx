import { Sidebar } from "@/components/layout/sidebar";
import { TeacherProvider } from "@/components/layout/teacher-context";
import { DemoDataState } from "@/components/evaluations/demo-data-state";
import { SupabaseDataProvider } from "@/lib/supabase-data-context";
import type { SupabaseSchoolData } from "@/lib/supabase-school-data";

export function AppShell({
  children,
  teacherName,
  teacherId,
  schoolData,
  dataError,
}: {
  children: React.ReactNode;
  teacherName: string;
  teacherId: string;
  schoolData: SupabaseSchoolData;
  dataError: string | null;
}) {
  return (
    <TeacherProvider name={teacherName} id={teacherId}>
      <SupabaseDataProvider initialData={schoolData} initialError={dataError}>
        <div className="teacher-shell">
          <a href="#main-content" className="skip-link">
            Aller au contenu
          </a>
          <Sidebar teacherName={teacherName} />
          <main id="main-content" className="teacher-main" tabIndex={-1}>
            <div className="teacher-topline">
              <span>Espace professeur</span>
              <span>Données établissement · Supabase</span>
            </div>
            <div className="mx-auto w-full max-w-[1180px] px-5 py-8 sm:px-8 sm:py-10 lg:px-10">
              <DemoDataState />
              {children}
            </div>
          </main>
        </div>
      </SupabaseDataProvider>
    </TeacherProvider>
  );
}
