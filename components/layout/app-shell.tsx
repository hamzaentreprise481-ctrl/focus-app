"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // The public presentation has its own navigation and deliberately stays
  // outside the authenticated product chrome.
  if (pathname === "/decouvrir") return children;

  return (
    <div className="flex h-full min-h-screen bg-paper">
      <Sidebar />
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1180px] px-5 py-7 sm:px-8 sm:py-9 lg:px-10">{children}</div>
      </main>
    </div>
  );
}
