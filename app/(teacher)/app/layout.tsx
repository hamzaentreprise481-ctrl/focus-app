import { requireTeacher } from "@/lib/auth/server";
import { AppShell } from "@/components/layout/app-shell";
import {
  EMPTY_SUPABASE_SCHOOL_DATA,
  loadSupabaseSchoolData,
} from "@/lib/supabase-school-data";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Mon espace professeur · FOCUS",
  robots: { index: false, follow: false },
};

export default async function TeacherLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const teacher = await requireTeacher();
  const name =
    typeof teacher.user_metadata?.display_name === "string"
      ? teacher.user_metadata.display_name
      : "Professeur";
  const isTestLogin = teacher.app_metadata?.test_login === true;

  let schoolData = EMPTY_SUPABASE_SCHOOL_DATA;
  let dataError: string | null = null;

  if (!isTestLogin) {
    try {
      schoolData = await loadSupabaseSchoolData({
        teacherId: teacher.id,
        teacherName: name,
      });
    } catch (error) {
      console.error("FOCUS school data load failed", error);
      dataError =
        "Impossible de charger les données de l’établissement. Aucun jeu de démonstration n’est utilisé en secours.";
    }
  }

  return (
    <AppShell
      teacherName={name}
      teacherId={teacher.id}
      schoolData={schoolData}
      dataError={dataError}
      dataMode={isTestLogin ? "demo" : "supabase"}
    >
      {children}
    </AppShell>
  );
}
