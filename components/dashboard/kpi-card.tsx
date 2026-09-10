import { cn } from "@/lib/utils";

export function KpiCard({
  value,
  label,
  dotClassName,
  emphasis,
}: {
  value: number;
  label: string;
  dotClassName?: string;
  emphasis?: boolean;
}) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-surface p-5">
      <div className="flex items-center gap-2">
        {dotClassName && <span className={cn("h-2 w-2 rounded-full", dotClassName)} />}
        <p className="text-sm text-ink-soft">{label}</p>
      </div>
      <p className={cn("mt-2 text-[32px] font-semibold leading-none tracking-tight text-ink", emphasis && "text-brand")}>
        {value}
      </p>
    </div>
  );
}
