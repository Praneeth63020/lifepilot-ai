import clsx from "clsx";
import { BellRing, CalendarDays, Check, Clock3, Flag, Mail, Sparkles } from "lucide-react";
import { barTone, Chip, FakeButton, MockCard, MockWindow, type Tone } from "./mock";

const PRIORITIES: { title: string; meta: string; tone: Tone; level: string; done?: boolean }[] = [
  { title: "Finish slides for design review", meta: "Due 2:30 PM · Work", tone: "danger", level: "Urgent" },
  { title: "Submit lab report", meta: "Due Thu 5:00 PM · from an email", tone: "warn", level: "High" },
  { title: "Pay electricity bill", meta: "Due Fri · 10 min", tone: "blue", level: "Medium", done: true },
];

const SCHEDULE: { time: string; title: string; note: string; tone: Tone; tall?: boolean }[] = [
  { time: "9:00", title: "Finish slides for design review", note: "Focus block · 90 min", tone: "accent", tall: true },
  { time: "10:30", title: "Team stand-up", note: "Calendar · 15 min", tone: "blue" },
  { time: "10:45", title: "Break", note: "After 90 min of focus", tone: "ok" },
  { time: "11:00", title: "Submit lab report", note: "Focus block · 60 min", tone: "accent" },
  { time: "14:40", title: "Prepare: Design review", note: "Preparation · 20 min", tone: "violet" },
  { time: "15:00", title: "Design review", note: "Calendar · 45 min", tone: "blue" },
];

/** Hero product preview: a dense, illustrative "Today" view. All content is sample data. */
export function HeroPreview() {
  return (
    <div className="relative isolate">
      <div aria-hidden className="pointer-events-none absolute right-0 top-0 -z-10 h-2/3 w-2/3 rounded-full bg-accent/25 blur-3xl" />
      <MockWindow label="Product preview of LifePilot's Today view, with sample data" title="LifePilot — Today, Tuesday" tag="Product preview · sample data">
        <div className="grid gap-3 sm:grid-cols-12">
          {/* Left column: priorities + schedule */}
          <div className="flex flex-col gap-3 sm:col-span-7">
            <MockCard title="Top 3 priorities" icon={<Flag />} aside={<Chip tone="accent">1 of 3 done</Chip>}>
              <ul className="flex flex-col gap-2">
                {PRIORITIES.map((p, i) => (
                  <li key={p.title} className="flex items-center gap-2.5">
                    <span
                      aria-hidden
                      className={clsx("grid size-5 shrink-0 place-items-center rounded-full border", p.done ? "border-ok bg-ok text-white" : "border-line")}
                    >
                      {p.done && <Check className="size-3" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={clsx("block truncate text-[13px] font-medium", p.done ? "text-muted line-through" : "text-ink")}>
                        <span className="mr-1 font-mono text-muted">{i + 1}.</span>
                        {p.title}
                      </span>
                      <span className="block truncate text-xs text-muted">{p.meta}</span>
                    </span>
                    <Chip tone={p.tone}>{p.level}</Chip>
                  </li>
                ))}
              </ul>
            </MockCard>

            <MockCard title="Today's plan" icon={<Clock3 />} aside={<Chip tone="ok">Accepted</Chip>}>
              <ol className="relative flex flex-col gap-1.5">
                {SCHEDULE.map((s, i) => (
                  <li key={s.time} className="relative flex items-stretch gap-2.5">
                    <span className="w-10 shrink-0 pt-1 text-right font-mono text-[11px] text-muted">{s.time}</span>
                    <span aria-hidden className={clsx("w-1 shrink-0 rounded-full", barTone[s.tone])} />
                    <span
                      className={clsx(
                        "min-w-0 flex-1 rounded-lg px-2.5 py-1.5",
                        s.tone === "accent" ? "bg-accent-soft" : s.tone === "blue" ? "bg-blue/10" : s.tone === "ok" ? "bg-ok/10" : "bg-violet/10",
                        s.tall && "py-2.5",
                      )}
                    >
                      <span className="block truncate text-[13px] font-medium text-ink">{s.title}</span>
                      <span className="block truncate text-[11px] text-muted">{s.note}</span>
                    </span>
                    {i === 1 && (
                      <span aria-hidden className="absolute -bottom-1 left-12 right-0 flex items-center">
                        <span className="size-2 rounded-full bg-danger" />
                        <span className="h-px flex-1 bg-danger/60" />
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            </MockCard>
          </div>

          {/* Right column: AI suggestion, emails, events, deadlines */}
          <div className="flex flex-col gap-3 sm:col-span-5">
            <div className="rounded-2xl border border-violet/30 bg-surface p-3.5">
              <p className="flex items-center gap-1.5 text-[13px] font-semibold text-violet">
                <Sparkles className="size-3.5" aria-hidden /> AI suggestion
              </p>
              <p className="mt-1.5 text-[13px] font-medium text-ink">Create task “Submit lab report” — due Thu 5:00 PM</p>
              <p className="mt-1.5 rounded-lg bg-surface-2 px-2 py-1.5 text-xs italic text-muted">“…please submit the lab report by Thursday at 5pm.”</p>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                <FakeButton variant="primary"><Check className="size-3" aria-hidden /> Approve</FakeButton>
                <FakeButton>Edit</FakeButton>
                <FakeButton variant="ghost">Dismiss</FakeButton>
              </div>
            </div>

            <MockCard title="Important emails" icon={<Mail />}>
              <ul className="flex flex-col gap-2">
                {[
                  { from: "Course office", subject: "Lab report deadline", score: 92, cat: "Deadline", tone: "danger" as Tone },
                  { from: "Riverside Energy", subject: "Your bill is ready", score: 74, cat: "Financial", tone: "warn" as Tone },
                ].map((e) => (
                  <li key={e.subject} className="flex items-center gap-2.5">
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-2 font-mono text-xs font-semibold text-ink" title="Importance score">
                      {e.score}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-ink">{e.subject}</span>
                      <span className="block truncate text-xs text-muted">{e.from}</span>
                    </span>
                    <Chip tone={e.tone}>{e.cat}</Chip>
                  </li>
                ))}
              </ul>
            </MockCard>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-1 xl:grid-cols-2">
              <MockCard title="Upcoming" icon={<CalendarDays />}>
                <ul className="flex flex-col gap-1.5 text-xs">
                  <li><span className="font-medium text-ink">Design review</span><span className="block text-muted">Today · 3:00 PM</span></li>
                  <li><span className="font-medium text-ink">Dentist</span><span className="block text-muted">Wed · 9:30 AM</span></li>
                </ul>
              </MockCard>
              <MockCard title="Deadlines" icon={<Flag />}>
                <ul className="flex flex-col gap-1.5 text-xs">
                  <li><span className="font-medium text-ink">Lab report</span><span className="block text-warn">in 2 days</span></li>
                  <li><span className="font-medium text-ink">Electricity bill</span><span className="block text-muted">in 3 days</span></li>
                </ul>
              </MockCard>
            </div>
          </div>
        </div>
      </MockWindow>

      {/* Floating reminder */}
      <div aria-hidden className="relative mx-3 -mt-5 flex items-center gap-3 rounded-2xl border border-side-line bg-side px-4 py-3 text-side-ink shadow-pop sm:absolute sm:-bottom-6 sm:left-6 sm:mx-0 sm:mt-0 sm:w-[300px] lg:-left-6">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent text-accent-ink">
          <BellRing className="size-4" />
        </span>
        <span className="min-w-0">
          <span className="block text-[11px] uppercase tracking-[0.12em] text-side-muted">Reminder · in 20 min</span>
          <span className="block truncate text-sm font-medium">Prepare: Design review</span>
        </span>
      </div>
    </div>
  );
}
