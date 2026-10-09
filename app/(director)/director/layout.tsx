import { DirectorShell } from "@/components/director/director-shell";
import { loadDirectorData } from "@/lib/director-data";

export const dynamic = "force-dynamic";

export default async function DirectorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const data = await loadDirectorData();
  return (
    <DirectorShell name={data.directorName} schoolName={data.schoolName}>
      {children}
    </DirectorShell>
  );
}
