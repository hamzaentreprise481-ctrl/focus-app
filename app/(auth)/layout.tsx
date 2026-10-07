import Link from "next/link";
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-paper">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Link
          href="/"
          className="flex items-center gap-2 font-semibold text-brand"
        >
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-white">
            F
          </span>{" "}
          FOCUS
        </Link>
        <Link href="/" className="text-sm text-ink-soft">
          Retour au site
        </Link>
      </header>
      <main
        id="main-content"
        className="mx-auto max-w-md px-5 pb-16 pt-10 sm:pt-16"
      >
        {children}
      </main>
    </div>
  );
}
