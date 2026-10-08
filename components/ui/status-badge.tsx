import { cn } from "@/lib/utils";
import type { StatusLevel } from "@/lib/types";

const STATUS_CONFIG: Record<
  StatusLevel,
  { label: string; dot: string; text: string; bg: string }
> = {
  normal: {
    label: "Sans signal particulier",
    dot: "bg-normal",
    text: "text-normal",
    bg: "bg-normal-soft",
  },
  a_surveiller: {
    label: "À surveiller",
    dot: "bg-watch",
    text: "text-watch",
    bg: "bg-watch-soft",
  },
  attention: {
    label: "À examiner",
    dot: "bg-brand",
    text: "text-brand",
    bg: "bg-brand-soft",
  },
};

export function StatusBadge({
  status,
  className,
}: {
  status: StatusLevel;
  className?: string;
}) {
  const config = STATUS_CONFIG[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        config.bg,
        config.text,
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", config.dot)} />
      {config.label}
    </span>
  );
}
