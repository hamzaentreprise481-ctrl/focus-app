import { DirectorSidebar } from "@/components/director/director-sidebar";

export function DirectorShell({
  children,
  name,
  schoolName,
}: {
  children: React.ReactNode;
  name: string;
  schoolName: string;
}) {
  return (
    <div className="min-h-dvh md:flex">
      <a href="#director-main" className="skip-link">Aller au contenu</a>
      <DirectorSidebar name={name} />
      <main id="director-main" className="min-w-0 flex-1" tabIndex={-1}>
        <div className="flex flex-wrap justify-between gap-2 border-b border-border px-5 py-4 text-xs text-ink-soft sm:px-8">
          <span>Espace direction</span>
          <span>{schoolName}</span>
        </div>
        <div className="mx-auto w-full max-w-[1180px] px-5 py-8 sm:px-8 sm:py-10">
          {children}
        </div>
      </main>
    </div>
  );
}
