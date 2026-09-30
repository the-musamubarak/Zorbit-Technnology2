import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export const isoDay = (d: Date) => {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

export const startOfDayIso = (day: string) => new Date(`${day}T00:00:00`).toISOString();
export const endOfDayIso = (day: string) => new Date(`${day}T23:59:59.999`).toISOString();

export type Preset = {
  key: string;
  label: string;
  range: () => { from: string; to: string };
};

const shift = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
};

export const PRESETS: Preset[] = [
  { key: "today", label: "Today", range: () => ({ from: isoDay(new Date()), to: isoDay(new Date()) }) },
  {
    key: "yesterday",
    label: "Yesterday",
    range: () => ({ from: isoDay(shift(1)), to: isoDay(shift(1)) }),
  },
  { key: "7d", label: "Last 7 days", range: () => ({ from: isoDay(shift(6)), to: isoDay(new Date()) }) },
  {
    key: "month",
    label: "This month",
    range: () => {
      const now = new Date();
      return { from: isoDay(new Date(now.getFullYear(), now.getMonth(), 1)), to: isoDay(now) };
    },
  },
  { key: "30d", label: "Last 30 days", range: () => ({ from: isoDay(shift(29)), to: isoDay(new Date()) }) },
  { key: "3m", label: "Last 3 months", range: () => ({ from: isoDay(shift(89)), to: isoDay(new Date()) }) },
  { key: "6m", label: "Last 6 months", range: () => ({ from: isoDay(shift(179)), to: isoDay(new Date()) }) },
  { key: "1y", label: "Last 1 year", range: () => ({ from: isoDay(shift(364)), to: isoDay(new Date()) }) },
];

export function DateRangeFilter({
  from,
  to,
  onChange,
  className,
}: {
  from: string;
  to: string;
  onChange: (range: { from: string; to: string }) => void;
  className?: string;
}) {
  return (
    <div className={cn("surface-card space-y-3 p-4", className)}>
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => {
          const r = p.range();
          const active = r.from === from && r.to === to;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => onChange(r)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">From</Label>
          <Input
            type="date"
            value={from}
            max={to}
            onChange={(e) => onChange({ from: e.target.value, to })}
            className="w-[10.5rem]"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">To</Label>
          <Input
            type="date"
            value={to}
            min={from}
            onChange={(e) => onChange({ from, to: e.target.value })}
            className="w-[10.5rem]"
          />
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange(PRESETS[4].range())}
          className="mb-0.5"
        >
          Reset
        </Button>
      </div>
    </div>
  );
}
