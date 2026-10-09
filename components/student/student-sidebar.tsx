"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ClipboardCheck,
  Home,
  LogOut,
  TrendingUp,
  UserRound,
} from "lucide-react";
import { cn, initials } from "@/lib/utils";
import { studentLogout } from "@/app/(auth)/connexion-eleve/actions";

const NAV_ITEMS = [
  { href: "/student", label: "Accueil", icon: Home },
  {
    href: "/student/evaluations",
    label: "Évaluations",
    icon: ClipboardCheck,
  },
  {
    href: "/student/progression",
    label: "Progression",
    icon: TrendingUp,
  },
  { href: "/student/profil", label: "Profil", icon: UserRound },
];

export function StudentSidebar({ studentName }: { studentName: string }) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/student"
      ? pathname === href
      : pathname === href || pathname.startsWith(href + "/");

  return (
    <aside className="border-b border-border bg-white p-4 md:sticky md:top-0 md:h-dvh md:w-60 md:shrink-0 md:border-b-0 md:border-r md:p-5">
      <Link
        href="/student"
        className="mb-5 flex items-center gap-3 px-2 font-semibold md:mb-9"
        aria-label="FOCUS, accueil élève"
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand text-sm text-white">
          F
        </span>
        <span>
          FOCUS
          <small className="block text-[9px] tracking-[0.14em] text-ink-soft">
            ÉLÈVE
          </small>
        </span>
      </Link>

      <nav
        aria-label="Navigation élève"
        className="grid grid-cols-4 gap-1 md:grid-cols-1 md:gap-1.5"
      >
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={isActive(href) ? "page" : undefined}
            className={cn(
              "flex min-h-11 items-center justify-center gap-2 rounded-lg px-2 py-2 text-center text-[11px] text-ink-soft hover:bg-paper md:justify-start md:px-3 md:text-left md:text-sm",
              isActive(href) && "bg-brand-soft font-semibold text-brand-ink",
            )}
          >
            <Icon size={18} aria-hidden="true" />
            <span>{label}</span>
          </Link>
        ))}
      </nav>

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-4 md:mt-auto md:block md:pt-5">
        <div className="hidden items-center gap-3 md:flex">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-soft text-xs font-semibold text-brand">
            {initials(studentName)}
          </span>
          <span className="min-w-0 truncate text-sm font-medium">
            {studentName}
          </span>
        </div>
        <form action={studentLogout} className="md:mt-4">
          <button
            type="submit"
            className="flex min-h-10 items-center gap-2 rounded-lg px-2 text-sm text-ink-soft hover:bg-paper md:w-full md:px-3"
          >
            <LogOut size={17} aria-hidden="true" />
            <span>Se déconnecter</span>
          </button>
        </form>
      </div>
    </aside>
  );
}
