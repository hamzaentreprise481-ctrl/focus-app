import { DirectorShell } from "@/components/director/director-shell";
import { requireDirector } from "@/lib/auth/server";
import { loadDirectorWorkspace } from "@/lib/director/data";

export const dynamic = "force-dynamic";

export default async function DirectorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireDirector();
  const workspace = await loadDirectorWorkspace();
  return (
    <DirectorShell
      directorName={workspace.directorName}
      schoolName={workspace.school.name}
      yearName={workspace.year?.name ?? null}
    >
      {children}
    </DirectorShell>
  );
}
