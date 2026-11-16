import { BellRing, CalendarCheck, ListChecks, Plug, ScanSearch } from "lucide-react";

const STEPS = [
  {
    key: "Connect",
    icon: Plug,
    title: "Connect the sources you choose",
    body: "Add tasks yourself, and optionally connect Gmail and Google Calendar with read-only access you authorise.",
    detail: "Disconnect any time",
  },
  {
    key: "Understand",
    icon: ScanSearch,
    title: "Spot what matters",
    body: "LifePilot finds important messages, commitments and deadlines — and marks unclear dates as needing confirmation.",
    detail: "AI can be switched off",
  },
  {
    key: "Organize",
    icon: ListChecks,
    title: "Review and approve",
    body: "Suggestions become tasks only when you approve them. Group work into projects with priorities and tags.",
    detail: "Nothing created silently",
  },
  {
    key: "Plan",
    icon: CalendarCheck,
    title: "Build a realistic day",
    body: "Top priorities are fitted around your events and working hours, with breaks, prep time and an honest overload warning.",
    detail: "Replan when things change",
  },
  {
    key: "Remind",
    icon: BellRing,
    title: "Get reminded at the right time",
    body: "A nudge to prepare, another when it's due — respecting quiet hours, with snooze when you need it.",
    detail: "In-app sounds + browser push",
  },
];

/** CONNECT → UNDERSTAND → ORGANIZE → PLAN → REMIND, as a connected timeline (vertical on small screens). */
export function HowItWorks() {
  return (
    <div className="relative">
      {/* Connector line: horizontal on desktop, vertical on mobile */}
      <span aria-hidden className="absolute left-[23px] top-6 bottom-6 w-px bg-linear-to-b from-accent via-side-line to-accent lg:hidden" />
      <span aria-hidden className="absolute left-[10%] right-[10%] top-6 hidden h-px bg-linear-to-r from-accent via-side-line to-accent lg:block" />
      <ol className="relative grid gap-0 lg:grid-cols-5 lg:gap-4">
      {STEPS.map((s, i) => {
        const Icon = s.icon;
        return (
          <li key={s.key} className="relative flex gap-5 pb-10 last:pb-0 lg:flex-col lg:items-center lg:gap-0 lg:pb-0 lg:text-center">
            <span className="relative z-10 grid size-12 shrink-0 place-items-center rounded-2xl border border-side-line bg-side-2 text-accent shadow-[0_0_0_6px_var(--color-side)]">
              <Icon className="size-5" aria-hidden />
            </span>
            <div className="min-w-0 lg:mt-6 lg:flex lg:flex-col lg:items-center">
              <p className="font-mono text-xs font-semibold tracking-[0.18em] text-accent">
                {String(i + 1).padStart(2, "0")} · {s.key.toUpperCase()}
              </p>
              <h3 className="mt-2 font-display text-lg font-semibold text-side-ink">{s.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-side-muted">{s.body}</p>
              <p className="mt-3 inline-flex rounded-full border border-side-line px-2.5 py-1 text-xs text-side-ink">{s.detail}</p>
            </div>
          </li>
        );
      })}
      </ol>
    </div>
  );
}
