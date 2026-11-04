import clsx from "clsx";
import type { PlanItemDTO } from "@lifepilot/shared";
import { fmtTime, minutesLabel } from "../lib/format";

const KIND_STYLE: Record<PlanItemDTO["kind"], { bar: string; label: string }> = {
  event: { bar: "bg-muted/60", label: "Calendar event" },
  task: { bar: "bg-accent", label: "Suggested focus block" },
  prep: { bar: "bg-warn", label: "Suggested preparation" },
  break: { bar: "bg-ok", label: "Suggested break" },
};

export function PlanTimeline({ items, tz, now = new Date(), compact }: { items: PlanItemDTO[]; tz: string; now?: Date; compact?: boolean }) {
  return (
    <ol className="flex flex-col gap-1" aria-label="Schedule">
      {items.map((i) => {
        const past = new Date(i.endAt) < now;
        const dur = Math.round((new Date(i.endAt).getTime() - new Date(i.startAt).getTime()) / 60000);
        const s = KIND_STYLE[i.kind];
        return (
          <li key={i.id} className={clsx("flex gap-3 rounded-lg px-2 py-1.5", past && "opacity-50")}>
            <span className="w-16 shrink-0 pt-0.5 text-right font-mono text-xs text-muted">{fmtTime(i.startAt, tz)}</span>
            <span className={clsx("w-1 shrink-0 rounded", s.bar)} aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-x-2 text-sm font-medium">
                <span className={clsx(i.kind === "break" && "text-muted")}>{i.title}</span>
                <span className="text-xs font-normal text-muted">{minutesLabel(dur)}</span>
              </span>
              {!compact && (
                <span className="block text-xs text-muted">
                  <span className="sr-only">{s.label}: </span>
                  {i.isFact ? "Confirmed · " : "Suggestion · "}
                  {i.reason}
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function PlanLegend() {
  return (
    <div className="flex flex-wrap gap-3 text-xs text-muted">
      {Object.entries(KIND_STYLE).map(([k, v]) => (
        <span key={k} className="flex items-center gap-1.5">
          <span className={clsx("h-3 w-1 rounded", v.bar)} aria-hidden /> {v.label}
        </span>
      ))}
    </div>
  );
}
