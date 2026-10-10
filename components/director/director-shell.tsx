import { DirectorSidebar } from "@/components/director/director-sidebar";

export function DirectorShell({
  children,
  directorName,
  schoolName,
  yearName,
}: {
  children: React.ReactNode;
  directorName: string;
  schoolName: string;
  yearName: string | null;
}) {
  return (
    <div className="min-h-dvh bg-paper md:flex">
      <a href="#director-main" className="skip-link">
        Aller au contenu
      </a>
      <DirectorSidebar directorName={directorName} />
      <main id="director-main" className="min-w-0 flex-1" tabIndex={-1}>
        <div className="flex flex-wrap justify-between gap-2 border-b border-border bg-white px-5 py-4 text-xs text-ink-soft sm:px-8">
          <span>Espace direction · lecture seule</span>
          <span>
            {schoolName}
            {yearName ? ` · ${yearName}` : ""}
          </span>
        </div>
        <div className="mx-auto w-full max-w-[1180px] px-5 py-8 sm:px-8 sm:py-10">
          {children}
        </div>
      </main>
    </div>
  );
}
