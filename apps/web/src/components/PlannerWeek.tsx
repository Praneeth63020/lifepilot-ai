import type { UseQueryResult } from "@tanstack/react-query";
import clsx from "clsx";
import { AlertTriangle, Check, Sparkles } from "lucide-react";
import type { DailyPlanDTO } from "@lifepilot/shared";
import { fmtDate, fmtTime, isoToZoned, minutesLabel, parseHHMM, zonedToISO } from "../lib/format";
import { TIME_GRID_KINDS } from "./TimeGrid";
import { Badge, Button, ErrorNote, Spinner, cardClass } from "./ui";

export function PlanStatusBadge({ status }: { status: DailyPlanDTO["status"] | null }) {
  if (status === "accepted")
    return (
      <Badge tone="ok">
        <Check aria-hidden className="size-3" />
        Accepted
      </Badge>
    );
  if (status === "proposed") return <Badge tone="accent">Proposed</Badge>;
  if (status === null) return <Badge>No plan</Badge>;
  return <Badge>{status}</Badge>;
}

const hourText = (min: number) => new Intl.DateTimeFormat(undefined, { hour: "numeric" }).format(new Date(2000, 0, 1, Math.floor(min / 60) % 24, min % 60));

/** Seven compact day columns: each day's plan status, a strip of its blocks, the block list and an action. */
export function PlannerWeek({
  days,
  today,
  tz,
  now,
  results,
  workStartMin,
  workEndMin,
  pendingDay,
  onPlan,
  onOpen,
}: {
  days: string[];
  today: string;
  tz: string;
  now: Date;
  results: UseQueryResult<{ plan: DailyPlanDTO | null }>[];
  workStartMin: number;
  workEndMin: number;
  pendingDay?: string;
  onPlan: (day: string) => void;
  onOpen: (day: string) => void;
}) {
  const plans = results.map((r) => r.data?.plan ?? null);
  const live = (p: DailyPlanDTO | null) => (p && (p.status === "proposed" || p.status === "accepted") ? p : null);
  const planned = plans.filter((p) => live(p)).length;
  const accepted = plans.filter((p) => p?.status === "accepted").length;
  const focusMin = plans.reduce((s, p) => s + (live(p)?.stats.scheduledTaskMinutes ?? 0), 0);
  const unplacedCount = plans.reduce((s, p) => s + (live(p)?.unscheduled.length ?? 0), 0);
  const loading = results.some((r) => r.isLoading);

  return (
    <div className="flex flex-col gap-4">
      <div className={clsx(cardClass, "flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 text-sm sm:px-5")}>
        {loading ? (
          <span className="text-muted">Loading the week…</span>
        ) : (
          <>
            <span><span className="font-semibold">{planned}</span> <span className="text-muted">of 7 days planned</span></span>
            <span><span className="font-semibold">{accepted}</span> <span className="text-muted">accepted</span></span>
            <span><span className="font-semibold">{minutesLabel(focusMin)}</span> <span className="text-muted">of task time scheduled</span></span>
            {unplacedCount > 0 && <span className="text-warn"><span className="font-semibold">{unplacedCount}</span> task{unplacedCount === 1 ? "" : "s"} didn't fit</span>}
            <span className="text-xs text-muted sm:ml-auto">Proposals stay proposals until you open the day and accept them.</span>
          </>
        )}
      </div>

      <div className="relative overflow-x-auto pb-1">
        <ol aria-label="Week" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-[repeat(7,minmax(142px,1fr))]">
          {days.map((d, idx) => {
            const r = results[idx]!;
            const p = r.data?.plan ?? null;
            const lp = live(p);
            const isToday = d === today;
            const past = d < today;
            const iso = zonedToISO(d, "12:00", tz);
            const full = fmtDate(iso, tz, { weekday: "long", month: "long", day: "numeric" });
            // Strip range: working hours, widened to fit every block.
            const mins = (lp?.items ?? []).map((i) => {
              const s = parseHHMM(isoToZoned(i.startAt, tz).time);
              let e = parseHHMM(isoToZoned(i.endAt, tz).time);
              if (e <= s) e = 24 * 60;
              return { i, s, e };
            });
            const lo = Math.min(workStartMin, ...mins.map((m) => m.s));
            const hi = Math.max(workEndMin, ...mins.map((m) => m.e));
            const span = Math.max(60, hi - lo);
            return (
              <li key={d} className={clsx(cardClass, "flex min-w-0 flex-col gap-3 p-3", isToday && "ring-2 ring-accent/60", past && !lp && "opacity-70")}>
                <div className="flex flex-col items-start gap-1.5">
                  <div className="min-w-0">
                    <p className={clsx("text-[11px] font-semibold uppercase tracking-[0.08em]", isToday ? "text-accent-strong" : "text-muted")}>
                      {isToday ? "Today" : fmtDate(iso, tz, { weekday: "short" })}
                    </p>
                    <p className="font-display text-lg font-semibold leading-tight">{fmtDate(iso, tz, { month: "short", day: "numeric" })}</p>
                  </div>
                  {!r.isLoading && <PlanStatusBadge status={p?.status ?? null} />}
                </div>

                {r.isLoading && <Spinner label="Loading" />}
                {r.error && <ErrorNote error={r.error} onRetry={() => r.refetch()} />}

                {lp && (
                  <>
                    <div aria-hidden>
                      <div className="relative h-3 overflow-hidden rounded-full bg-surface-2">
                        {mins.map(({ i, s, e }) => (
                          <span
                            key={i.id}
                            className={clsx("absolute inset-y-0", TIME_GRID_KINDS[i.kind].bar, !i.isFact && lp.status === "proposed" && "opacity-60")}
                            style={{ left: `${((s - lo) / span) * 100}%`, width: `${Math.max(1, ((e - s) / span) * 100)}%` }}
                          />
                        ))}
                      </div>
                      <div className="mt-1 flex justify-between text-[10px] tabular-nums text-muted">
                        <span>{hourText(lo)}</span>
                        <span>{hourText(hi)}</span>
                      </div>
                    </div>
                    <p className="text-xs text-muted">
                      <span className="font-medium text-ink">{minutesLabel(lp.stats.scheduledTaskMinutes)}</span> tasks · {minutesLabel(lp.stats.freeMinutes)} free
                    </p>
                    {(lp.drift.length > 0 || lp.warnings.length > 0) && (
                      <div className="flex flex-wrap gap-1">
                        {lp.drift.length > 0 && <Badge tone="warn"><AlertTriangle aria-hidden className="size-3" />Out of date</Badge>}
                        {lp.warnings.length > 0 && <Badge tone="warn">{lp.warnings.length} warning{lp.warnings.length === 1 ? "" : "s"}</Badge>}
                      </div>
                    )}
                    <ul className="flex flex-col gap-1">
                      {lp.items.map((i) => {
                        const k = TIME_GRID_KINDS[i.kind];
                        const Icon = k.icon;
                        const done = new Date(i.endAt) < now;
                        return (
                          <li
                            key={i.id}
                            className={clsx("relative min-w-0 rounded-md border py-1 pl-2.5 pr-1.5 text-xs", k.box, !i.isFact && lp.status === "proposed" && "border-dashed", done && "opacity-60")}
                            title={`${i.title} · ${fmtTime(i.startAt, tz)} – ${fmtTime(i.endAt, tz)}`}
                          >
                            <span aria-hidden className={clsx("absolute inset-y-0 left-0 w-[3px] rounded-l-md", k.bar)} />
                            <span className="sr-only">{k.label}: </span>
                            <span className={clsx("line-clamp-2 leading-snug", i.kind === "break" ? "text-muted" : "font-medium")}>{i.title}</span>
                            <span className="mt-0.5 flex min-w-0 items-center gap-1 whitespace-nowrap text-[11px] tabular-nums text-muted">
                              <Icon aria-hidden className={clsx("size-3 shrink-0", k.text)} />
                              <span className="truncate">
                                {fmtTime(i.startAt, tz)} · {minutesLabel(Math.round((new Date(i.endAt).getTime() - new Date(i.startAt).getTime()) / 60000))}
                              </span>
                            </span>
                          </li>
                        );
                      })}
                      {lp.items.length === 0 && <li className="text-xs text-muted">Nothing scheduled.</li>}
                    </ul>
                  </>
                )}

                {!r.isLoading && !lp && <p className="text-xs text-muted">{past ? "No plan was made for this day." : p ? `This day's plan was ${p.status}.` : "Not planned yet."}</p>}

                <div className="mt-auto pt-1">
                  {lp ? (
                    <Button size="sm" variant="secondary" className="w-full" onClick={() => onOpen(d)}>
                      {lp.status === "proposed" ? "Review" : "Open"}
                      <span className="sr-only"> {full}</span>
                    </Button>
                  ) : !past && !r.isLoading ? (
                    <Button size="sm" variant="primary" className="w-full" loading={pendingDay === d} onClick={() => onPlan(d)}>
                      {pendingDay !== d && <Sparkles aria-hidden className="size-3.5" />} Plan this day
                      <span className="sr-only"> ({full})</span>
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" className="w-full" onClick={() => onOpen(d)}>
                      View day<span className="sr-only"> {full}</span>
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
