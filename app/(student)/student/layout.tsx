import { StudentShell } from "@/components/student/student-shell";
import { loadStudentIdentity } from "@/lib/student-data";

export const dynamic = "force-dynamic";

export default async function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const identity = await loadStudentIdentity();
  return (
    <StudentShell
      studentName={identity.name}
      schoolName={identity.schoolName}
      className={identity.className}
    >
      {children}
    </StudentShell>
  );
}
