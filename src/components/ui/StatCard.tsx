import { DeltaChip } from "./DeltaChip";
import { LucideIcon } from "lucide-react";

export function StatCard({
  label,
  value,
  delta,
  goodDirection = "up",
  icon: Icon,
  sub,
}: {
  label: string;
  value: string;
  delta?: number;
  goodDirection?: "up" | "down";
  icon?: LucideIcon;
  sub?: string;
}) {
  return (
    <div className="card p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-ink-500">{label}</p>
        {Icon && <Icon className="h-4 w-4 text-ink-300" />}
      </div>
      <p className="text-2xl font-semibold text-ink-900 tabular-nums">{value}</p>
      <div className="flex items-center gap-2">
        {delta !== undefined && <DeltaChip value={delta} goodDirection={goodDirection} />}
        {sub && <span className="text-xs text-ink-400">{sub}</span>}
      </div>
    </div>
  );
}
