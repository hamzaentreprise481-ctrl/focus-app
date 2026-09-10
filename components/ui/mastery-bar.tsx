import { cn } from "@/lib/utils";

function barColor(percent: number): string {
  if (percent >= 75) return "bg-normal";
  if (percent >= 55) return "bg-brand";
  if (percent >= 35) return "bg-watch";
  return "bg-attention";
}

export function MasteryBar({
  percent,
  className,
  trackClassName,
}: {
  percent: number;
  className?: string;
  trackClassName?: string;
}) {
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-border", trackClassName)}>
      <div
        className={cn("h-full rounded-full transition-[width]", barColor(percent), className)}
        style={{ width: `${Math.max(4, Math.min(100, percent))}%` }}
      />
    </div>
  );
}
