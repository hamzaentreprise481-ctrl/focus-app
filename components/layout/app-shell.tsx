import { Sidebar } from "@/components/layout/sidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-screen">
      <Sidebar />
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-6 py-8 sm:px-8 lg:px-10">{children}</div>
      </main>
    </div>
  );
}
