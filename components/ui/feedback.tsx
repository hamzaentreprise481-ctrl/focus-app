import { CheckCircle2, CircleAlert, FileText } from "lucide-react";

export function Feedback({
  tone = "info",
  children,
}: {
  tone?: "info" | "success" | "error";
  children: React.ReactNode;
}) {
  const Icon = tone === "success" ? CheckCircle2 : CircleAlert;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`feedback feedback-${tone}`}
    >
      <Icon size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-surface p-6">
      <FileText size={22} aria-hidden="true" className="mb-3 text-muted" />
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-soft">
        {description}
      </p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function SectionLoading({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-label={label}
      className="rounded-[var(--radius-lg)] border border-border bg-surface p-5"
    >
      <p className="mb-4 text-sm text-ink-soft">{label}</p>
      <div aria-hidden="true" className="space-y-3 motion-safe:animate-pulse">
        <div className="h-4 w-2/5 rounded bg-border" />
        <div className="h-3 w-3/4 rounded bg-paper" />
        <div className="h-16 rounded bg-paper" />
      </div>
    </div>
  );
}
