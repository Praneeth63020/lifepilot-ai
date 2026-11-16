import clsx from "clsx";
import { Bell, BellRing, CalendarDays, Check, FolderKanban, ListChecks, Mail, Moon, Repeat, ScanText, Smartphone, Sparkles, Sun, Tag } from "lucide-react";
import type { ReactNode } from "react";
import { cardClass } from "../ui";
import { Chip } from "./mock";

function Tile({ icon, title, body, children, className, dark = false, iconTone = "neutral" }: { icon: ReactNode; title: string; body: string; children?: ReactNode; className?: string; dark?: boolean; iconTone?: "neutral" | "accent" | "violet" | "blue" | "ok" }) {
  return (
    <article
      className={clsx(
        "flex flex-col overflow-hidden p-5 sm:p-6",
        dark ? "rounded-[var(--radius-card)] border border-side-line bg-side text-side-ink" : cardClass,
        className,
      )}
    >
      <span
        aria-hidden
        className={clsx(
          "grid size-10 place-items-center rounded-xl [&>svg]:size-5",
          dark ? "bg-accent text-accent-ink" : iconTone === "accent" ? "bg-accent text-accent-ink" : iconTone === "violet" ? "bg-violet/10 text-violet" : iconTone === "blue" ? "bg-blue/10 text-blue" : iconTone === "ok" ? "bg-ok/10 text-ok" : "bg-surface-2 text-ink",
        )}
      >
        {icon}
      </span>
      <h3 className={clsx("mt-4 font-display text-lg font-semibold tracking-tight", dark ? "text-side-ink" : "text-ink")}>{title}</h3>
      <p className={clsx("mt-1.5 text-[15px] leading-relaxed", dark ? "text-side-muted" : "text-muted")}>{body}</p>
      {children && <div className="mt-5 flex-1">{children}</div>}
    </article>
  );
}

/** "Everything in one place": eight product areas in a varied bento grid. Visuals use sample data. */
export function ProductBento() {
  return (
    <div className="grid gap-4 md:grid-cols-6 lg:grid-cols-12">
      {/* 1. Tasks */}
      <Tile
        className="md:col-span-6 lg:col-span-7 2xl:col-span-4"
        icon={<ListChecks />}
        iconTone="accent"
        title="Tasks & commitments"
        body="Capture everything you've promised to do, with priorities, due dates, subtasks, tags and recurrence. Search and filter in seconds."
      >
        <div aria-hidden className="grid gap-2 sm:grid-cols-2">
          {[
            { t: "Renew passport", meta: "Due 30 Nov", chips: [<Chip key="a" tone="warn">High</Chip>, <Chip key="b"><Tag className="size-3" /> personal</Chip>], sub: "2 of 4 subtasks" },
            { t: "Weekly review", meta: "Every Friday", chips: [<Chip key="a" tone="blue">Medium</Chip>, <Chip key="b"><Repeat className="size-3" /> weekly</Chip>], sub: "Recurring" },
          ].map((x) => (
            <div key={x.t} className="rounded-xl border border-line bg-surface-2/60 p-3">
              <p className="text-sm font-medium text-ink">{x.t}</p>
              <p className="text-xs text-muted">{x.meta} · {x.sub}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">{x.chips}</div>
            </div>
          ))}
        </div>
      </Tile>

      {/* 2. Gmail intelligence */}
      <Tile
        dark
        className="md:col-span-6 lg:col-span-5 2xl:col-span-3"
        icon={<Mail />}
        title="Gmail intelligence"
        body="Recent emails are sorted into categories with an importance score, so deadlines, requests and bills don't get buried under everything else."
      >
        <div aria-hidden className="flex flex-wrap gap-2">
          {["Urgent", "Requires action", "Deadline", "Meeting", "Financial", "Travel", "Informational", "Low priority"].map((c, i) => (
            <span key={c} className={clsx("rounded-full border px-3 py-1 text-xs font-medium", i < 5 ? "border-accent/50 text-accent" : "border-side-line text-side-muted")}>
              {c}
            </span>
          ))}
        </div>
        <p className="mt-4 text-xs text-side-muted">Read-only access · optional · disconnect any time</p>
      </Tile>

      {/* 3. Google Calendar */}
      <Tile className="md:col-span-3 lg:col-span-4 2xl:col-span-3" icon={<CalendarDays />} iconTone="blue" title="Google Calendar" body="See your events by day, week or month. Overlaps are flagged with alternative times. Google events stay read-only.">
        <div aria-hidden className="grid grid-cols-5 gap-1.5">
          {["Mon", "Tue", "Wed", "Thu", "Fri"].map((d, i) => (
            <div key={d} className="flex flex-col gap-1">
              <span className="text-center text-[11px] text-muted">{d}</span>
              <span className="h-16 rounded-lg bg-surface-2 p-1">
                <span className={clsx("block rounded bg-blue/25", i % 2 ? "mt-3 h-5" : "h-7")} />
                {i === 2 && <span className="mt-1 block h-4 rounded bg-danger/30 ring-1 ring-danger/40" />}
              </span>
            </div>
          ))}
        </div>
      </Tile>

      {/* 4. AI deadline extraction */}
      <Tile className="bg-accent-soft! md:col-span-3 lg:col-span-4 2xl:col-span-2" icon={<ScanText />} iconTone="accent" title="AI deadline extraction" body="Deadlines, changed deadlines and multiple dates are pulled from emails, with the exact sentence they came from.">
        <p aria-hidden className="rounded-xl border border-line bg-surface p-3 text-sm leading-relaxed text-muted">
          “The deadline has moved — please send it by <mark className="rounded bg-accent px-1 text-accent-ink">Friday 12 noon</mark> instead.”
        </p>
      </Tile>

      {/* 5. Daily planning */}
      <Tile className="md:col-span-6 lg:col-span-4 2xl:col-span-3" icon={<Sparkles />} iconTone="violet" title="Daily planning" body="Your top three priorities, scheduled around meetings within working hours — with breaks, preparation time and overload warnings.">
        <div aria-hidden className="flex h-10 overflow-hidden rounded-xl border border-line">
          <span className="w-[22%] bg-accent" />
          <span className="w-[10%] bg-blue/60" />
          <span className="w-[6%] bg-ok/60" />
          <span className="w-[18%] bg-accent/70" />
          <span className="w-[14%] bg-surface-2" />
          <span className="w-[8%] bg-violet/60" />
          <span className="w-[14%] bg-blue/60" />
          <span className="w-[8%] bg-surface-2" />
        </div>
        <p aria-hidden className="mt-2 flex justify-between font-mono text-[11px] text-muted"><span>9:00</span><span>13:00</span><span>17:00</span></p>
      </Tile>

      {/* 6. Smart reminders */}
      <Tile className="md:col-span-3 lg:col-span-5 2xl:col-span-4" icon={<BellRing />} iconTone="accent" title="Smart reminders" body="A reminder to prepare, another when it's due. Snooze, quiet hours, and three LifePilot sounds while the app is open.">
        <div aria-hidden className="flex flex-col gap-2">
          <div className="flex items-center gap-2.5 rounded-xl border border-line bg-surface-2/60 px-3 py-2">
            <Bell className="size-4 text-accent-strong" />
            <span className="flex-1 text-sm text-ink">Prepare: Interview — in 30 min</span>
            <Chip>Snooze</Chip>
          </div>
          <div className="flex items-center gap-2.5 rounded-xl border border-line bg-surface-2/60 px-3 py-2">
            <Moon className="size-4 text-violet" />
            <span className="flex-1 text-sm text-ink">Quiet hours 22:00 – 07:00</span>
            <Sun className="size-4 text-muted" />
          </div>
        </div>
      </Tile>

      {/* 7. Projects */}
      <Tile className="md:col-span-3 lg:col-span-4 2xl:col-span-3" icon={<FolderKanban />} iconTone="ok" title="Projects & progress" body="Group related tasks and see progress, what's overdue and the next deadline at a glance.">
        <div aria-hidden className="flex flex-col gap-3">
          {[
            { n: "Job search", v: 64, tone: "bg-ok" },
            { n: "Home move", v: 30, tone: "bg-accent" },
          ].map((p) => (
            <div key={p.n}>
              <p className="flex justify-between text-xs"><span className="font-medium text-ink">{p.n}</span><span className="text-muted">{p.v}%</span></p>
              <span className="mt-1 block h-2 overflow-hidden rounded-full bg-surface-2"><span className={clsx("block h-full rounded-full", p.tone)} style={{ width: `${p.v}%` }} /></span>
            </div>
          ))}
        </div>
      </Tile>

      {/* 8. Notifications */}
      <Tile className="md:col-span-6 lg:col-span-3 2xl:col-span-2" icon={<Smartphone />} iconTone="blue" title="Notifications" body="In-app alerts while LifePilot is open, plus browser push when it isn't — all in one notification centre.">
        <p aria-hidden className="flex items-center gap-1.5 text-xs text-ok"><Check className="size-3.5" /> Browser push enabled</p>
      </Tile>
    </div>
  );
}
