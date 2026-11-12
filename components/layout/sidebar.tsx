"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutGrid,
  Users,
  GraduationCap,
  ClipboardCheck,
  Settings,
  LogOut,
} from "lucide-react";
import { cn, initials } from "@/lib/utils";
import { logout } from "@/app/(auth)/connexion/actions";
const NAV_ITEMS = [
  { href: "/app", label: "Accueil", icon: LayoutGrid },
  { href: "/app/classes", label: "Classes", icon: Users },
  { href: "/app/eleves", label: "Élèves", icon: GraduationCap },
  { href: "/app/evaluations", label: "Évaluations", icon: ClipboardCheck },
];
export function Sidebar({ teacherName }: { teacherName: string }) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/app"
      ? pathname === href
      : pathname === href || pathname.startsWith(href + "/");
  return (
    <aside className="teacher-sidebar">
      <Link
        href="/app"
        className="teacher-brand"
        aria-label="FOCUS, accueil professeur"
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand text-sm text-white">
          F
        </span>
        <span>
          FOCUS<small>PROFESSEUR</small>
        </span>
      </Link>
      <nav aria-label="Navigation professeur" className="teacher-nav">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={isActive(href) ? "page" : undefined}
            className={cn("teacher-nav-link", isActive(href) && "is-active")}
          >
            <Icon size={18} aria-hidden="true" />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
      <div className="teacher-account">
        <Link
          href="/app/parametres"
          className="teacher-nav-link"
          aria-current={isActive("/app/parametres") ? "page" : undefined}
        >
          <Settings size={18} aria-hidden="true" />
          <span>Paramètres</span>
        </Link>
        <form action={logout}>
          <button type="submit" className="teacher-nav-link w-full">
            <LogOut size={18} aria-hidden="true" />
            <span>Se déconnecter</span>
          </button>
        </form>
        <div className="teacher-identity">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-soft text-xs font-semibold text-brand">
            {initials(teacherName)}
          </span>
          <span className="min-w-0 truncate text-sm font-medium">
            {teacherName}
          </span>
        </div>
      </div>
    </aside>
  );
}
