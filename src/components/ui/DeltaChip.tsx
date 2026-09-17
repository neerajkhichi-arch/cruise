import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { cn } from "@/lib/format";

/**
 * Shows a WoW-style delta. `goodDirection` says which direction is
 * "good" for this metric (e.g. down is good for CPL, up is good for
 * leads) so the color always maps to business meaning, not just sign.
 */
export function DeltaChip({
  value,
  goodDirection = "up",
  suffix = "%",
}: {
  value: number;
  goodDirection?: "up" | "down";
  suffix?: string;
}) {
  const rounded = Math.round(value * 10) / 10;
  if (Math.abs(rounded) < 0.5) {
    return (
      <span className="chip chip-neutral">
        <Minus className="h-3 w-3" /> 0{suffix}
      </span>
    );
  }
  const isUp = rounded > 0;
  const isGood = isUp ? goodDirection === "up" : goodDirection === "down";
  return (
    <span className={cn("chip", isGood ? "chip-positive" : "chip-negative")}>
      {isUp ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
      {Math.abs(rounded)}
      {suffix}
    </span>
  );
}

export function StatusChip({ status }: { status: string }) {
  const map: Record<string, string> = {
    HEALTHY: "chip-positive",
    ACTIVE: "chip-positive",
    ATTENTION: "chip-caution",
    PAUSED: "chip-caution",
    CRITICAL: "chip-negative",
    DRAFT: "chip-neutral",
    COMPLETED: "chip-neutral",
    SOLD: "chip-neutral",
    RESERVED: "chip-caution",
  };
  return <span className={cn("chip", map[status] ?? "chip-neutral")}>{status.replace(/_/g, " ")}</span>;
}
