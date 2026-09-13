import { requireTeacher } from "@/lib/auth/server";
import { AppShell } from "@/components/layout/app-shell";
// Never prerender a denial or a teacher response into a shared static page.
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
  return (
    <AppShell teacherName={name} teacherId={teacher.id}>
      {children}
    </AppShell>
  );
}
