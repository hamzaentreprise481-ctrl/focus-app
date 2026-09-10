"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid, Users, GraduationCap, ClipboardCheck, Settings, ExternalLink } from "lucide-react";
import { cn, initials } from "@/lib/utils";
import { currentTeacher } from "@/lib/data/class-info";

const NAV_ITEMS = [
  { href: "/", label: "Accueil", icon: LayoutGrid },
  { href: "/classes", label: "Classes", icon: Users },
  { href: "/eleves", label: "Élèves", icon: GraduationCap },
  { href: "/evaluations", label: "Évaluations", icon: ClipboardCheck },
];

export function Sidebar() {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");

  return (
    <aside className="sticky top-0 flex h-screen w-[68px] shrink-0 flex-col border-r border-border bg-surface lg:w-60">
      <div className="flex h-16 items-center justify-center gap-2 px-2 lg:justify-start lg:px-5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-brand text-[13px] font-semibold text-white">
          F
        </span>
        <span className="hidden text-[15px] font-semibold tracking-tight text-ink lg:inline">FOCUS</span>
      </div>

      <nav className="flex-1 space-y-0.5 px-2 pt-2 lg:px-3">
        {NAV_ITEMS.map((item) => {
          const active = isActive(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              title={item.label}
              className={cn(
                "flex items-center justify-center gap-2.5 rounded-[var(--radius-sm)] px-2 py-2.5 text-sm font-medium transition-colors lg:justify-start lg:px-3 lg:py-2",
                active ? "bg-brand-soft text-brand-ink" : "text-ink-soft hover:bg-paper hover:text-ink"
              )}
            >
              <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={2} />
              <span className="hidden lg:inline">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="space-y-0.5 border-t border-border px-2 py-3 lg:px-3">
        <Link
          href="/decouvrir"
          title="Découvrir FOCUS"
          className="mb-1 flex items-center justify-center gap-2.5 rounded-[var(--radius-sm)] px-2 py-2.5 text-sm font-medium text-ink-soft transition-colors hover:bg-paper hover:text-ink lg:justify-start lg:px-3 lg:py-2"
        >
          <ExternalLink className="h-[18px] w-[18px] shrink-0" strokeWidth={2} />
          <span className="hidden lg:inline">Découvrir FOCUS</span>
        </Link>
        <Link
          href="/parametres"
          title="Paramètres"
          className={cn(
            "flex items-center justify-center gap-2.5 rounded-[var(--radius-sm)] px-2 py-2.5 text-sm font-medium transition-colors lg:justify-start lg:px-3 lg:py-2",
            isActive("/parametres") ? "bg-brand-soft text-brand-ink" : "text-ink-soft hover:bg-paper hover:text-ink"
          )}
        >
          <Settings className="h-[18px] w-[18px] shrink-0" strokeWidth={2} />
          <span className="hidden lg:inline">Paramètres</span>
        </Link>
      </div>

      <div className="flex items-center justify-center gap-2.5 border-t border-border px-2 py-4 lg:justify-start lg:px-5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[12px] font-semibold text-brand-ink">
          {initials(currentTeacher)}
        </span>
        <div className="hidden min-w-0 lg:block">
          <p className="truncate text-[13px] font-medium text-ink">{currentTeacher}</p>
          <p className="truncate text-xs text-muted">Mathématiques</p>
        </div>
      </div>
      <p className="hidden px-5 pb-3 text-[11px] text-muted lg:block">Données de démonstration</p>
    </aside>
  );
}
