"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AlertTriangle,
  BookOpenCheck,
  Building2,
  LogOut,
  Settings,
  Users,
  UsersRound,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { directorLogout } from "@/app/(auth)/connexion-direction/actions";

const NAV_ITEMS = [
  { href: "/director", label: "Établissement", icon: Building2 },
  { href: "/director/classes", label: "Classes", icon: Users },
  { href: "/director/professeurs", label: "Professeurs", icon: UsersRound },
  { href: "/director/programme", label: "Programme", icon: BookOpenCheck },
  { href: "/director/alertes", label: "Alertes", icon: AlertTriangle },
  { href: "/director/parametres", label: "Paramètres", icon: Settings },
];

export function DirectorSidebar({ directorName }: { directorName: string }) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/director"
      ? pathname === href
      : pathname === href || pathname.startsWith(href + "/");

  return (
    <aside className="bg-brand-ink p-4 text-white md:sticky md:top-0 md:flex md:h-dvh md:w-60 md:shrink-0 md:flex-col md:p-5">
      <Link
        href="/director"
        className="mb-5 flex items-center gap-3 px-2 font-semibold md:mb-9"
        aria-label="FOCUS Direction, accueil"
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white text-sm text-brand-ink">
          F
        </span>
        <span>
          FOCUS
          <small className="block text-[9px] tracking-[0.14em] text-white/70">
            DIRECTION
          </small>
        </span>
      </Link>

      <nav
        aria-label="Navigation direction"
        className="grid grid-cols-3 gap-1 sm:grid-cols-6 md:grid-cols-1 md:gap-1.5"
      >
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={isActive(href) ? "page" : undefined}
            className={cn(
              "flex min-h-11 flex-col items-center justify-center gap-1 rounded-lg px-1 py-2 text-center text-[11px] text-white/80 hover:bg-white/10 md:flex-row md:justify-start md:gap-2 md:px-3 md:text-left md:text-sm",
              isActive(href) && "bg-white font-semibold text-brand-ink hover:bg-white",
            )}
          >
            <Icon size={18} aria-hidden="true" />
            <span>{label}</span>
          </Link>
        ))}
      </nav>

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/20 pt-4 md:mt-auto md:block md:pt-5">
        <span className="min-w-0 truncate px-2 text-sm text-white/80">
          {directorName}
        </span>
        <form action={directorLogout} className="md:mt-4">
          <button
            type="submit"
            className="flex min-h-10 items-center gap-2 rounded-lg px-2 text-sm text-white/80 hover:bg-white/10 md:w-full md:px-3"
          >
            <LogOut size={17} aria-hidden="true" />
            <span>Se déconnecter</span>
          </button>
        </form>
      </div>
    </aside>
  );
}
