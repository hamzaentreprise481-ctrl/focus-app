import { Sidebar } from "@/components/layout/sidebar";
import { TeacherProvider } from "@/components/layout/teacher-context";
import { DemoDataState } from "@/components/evaluations/demo-data-state";
import { SupabaseDataProvider } from "@/lib/supabase-data-context";
import { DemoDataProvider } from "@/lib/demo-data-context";
import type { SupabaseSchoolData } from "@/lib/supabase-school-data";

export function AppShell({
  children,
  teacherName,
  teacherId,
  schoolData,
  dataError,
  dataMode = "supabase",
}: {
  children: React.ReactNode;
  teacherName: string;
  teacherId: string;
  schoolData: SupabaseSchoolData;
  dataError: string | null;
  dataMode?: "supabase" | "demo";
}) {
  const content = (
    <div className="teacher-shell">
      <a href="#main-content" className="skip-link">
        Aller au contenu
      </a>
      <Sidebar teacherName={teacherName} />
      <main id="main-content" className="teacher-main" tabIndex={-1}>
        <div className="teacher-topline">
          <span>Espace professeur</span>
          <span>
            {dataMode === "demo"
              ? "Compte professeur de test"
              : "Données établissement · Supabase"}
          </span>
        </div>
        <div className="mx-auto w-full max-w-[1180px] px-5 py-8 sm:px-8 sm:py-10 lg:px-10">
          <DemoDataState />
          {children}
        </div>
      </main>
    </div>
  );

  return (
    <TeacherProvider name={teacherName} id={teacherId}>
      {dataMode === "demo" ? (
        <DemoDataProvider>{content}</DemoDataProvider>
      ) : (
        <SupabaseDataProvider initialData={schoolData} initialError={dataError}>
          {content}
        </SupabaseDataProvider>
      )}
    </TeacherProvider>
  );
}
