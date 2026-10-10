import Link from "next/link";
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#f4f6fa]">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6 sm:py-7">
        <Link
          href="/"
          className="flex items-center gap-2 font-semibold text-brand"
        >
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-ink text-white shadow-sm">
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
        className="mx-auto max-w-lg px-5 pb-16 pt-8 sm:pt-12"
      >
        {children}
      </main>
    </div>
  );
}
