"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpenCheck,
  Building2,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  UsersRound,
} from "lucide-react";
import { cn, initials } from "@/lib/utils";
import { directorLogout } from "@/app/(auth)/connexion-direction/actions";

const ITEMS = [
  { href: "/director", label: "Vue générale", icon: LayoutDashboard },
  { href: "/director/classes", label: "Classes", icon: Building2 },
  { href: "/director/eleves", label: "Élèves", icon: GraduationCap },
  { href: "/director/professeurs", label: "Professeurs", icon: UsersRound },
  { href: "/director/programme", label: "Programme", icon: BookOpenCheck },
];

export function DirectorSidebar({ name }: { name: string }) {
  const pathname = usePathname();
  const active = (href: string) =>
    href === "/director"
      ? pathname === href
      : pathname === href || pathname.startsWith(href + "/");

  return (
    <aside className="border-b border-border bg-white p-4 md:sticky md:top-0 md:h-dvh md:w-60 md:shrink-0 md:border-b-0 md:border-r md:p-5">
      <Link href="/director" className="mb-5 flex items-center gap-3 px-2 font-semibold md:mb-9">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-sm text-white">F</span>
        <span>FOCUS<small className="block text-[9px] tracking-[0.14em] text-ink-soft">DIRECTION</small></span>
      </Link>
      <nav className="grid grid-cols-5 gap-1 md:grid-cols-1 md:gap-1.5" aria-label="Navigation direction">
        {ITEMS.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex min-h-11 items-center justify-center gap-2 rounded-lg px-2 py-2 text-center text-[10px] text-ink-soft hover:bg-paper md:justify-start md:px-3 md:text-left md:text-sm",
              active(href) && "bg-brand-soft font-semibold text-brand-ink",
            )}
          >
            <Icon size={18} aria-hidden="true" />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
      <div className="mt-4 border-t border-border pt-4 md:mt-auto">
        <div className="hidden items-center gap-3 md:flex">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-soft text-xs font-semibold text-brand">
            {initials(name)}
          </span>
          <span className="truncate text-sm font-medium">{name}</span>
        </div>
        <form action={directorLogout} className="md:mt-4">
          <button type="submit" className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-sm text-ink-soft hover:bg-paper">
            <LogOut size={17} aria-hidden="true" />
            Se déconnecter
          </button>
        </form>
      </div>
    </aside>
  );
}
