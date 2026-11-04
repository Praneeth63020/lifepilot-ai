import { ArrowRight, Bell, CalendarDays, Inbox, Lock, ShieldCheck, Sparkles, Volume2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Logo } from "../components/Logo";
import { Badge, Button } from "../components/ui";
import { SOUNDS, playSound } from "../lib/sounds";
import { useSession } from "../session";

const EXAMPLE = [
  { time: "9:00", title: "Prepare slides for design review", kind: "task", note: "High priority · due 2:30 PM" },
  { time: "10:00", title: "Team stand-up", kind: "event", note: "From your calendar" },
  { time: "10:40", title: "Assignment 3 — consensus protocols", kind: "task", note: "From an email · due Thu" },
  { time: "12:10", title: "Break", kind: "break", note: "After 90 min of focus" },
  { time: "14:40", title: "Prepare: Design review", kind: "prep", note: "20 min before it starts" },
  { time: "15:00", title: "Design review", kind: "event", note: "From your calendar" },
];

export function LandingPage() {
  const { me, config } = useSession();
  const cta = me ? (
    <Link to="/app"><Button variant="primary">Open LifePilot <ArrowRight className="size-4" /></Button></Link>
  ) : (
    <>
      <Link to="/register"><Button variant="primary">Get started <ArrowRight className="size-4" /></Button></Link>
      <Link to="/login"><Button>Sign in</Button></Link>
    </>
  );

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <Logo to="/" />
        <nav aria-label="Site" className="flex items-center gap-1 sm:gap-2">
          <a href="#features" className="hidden rounded-lg px-3 py-2 text-sm text-muted hover:text-ink sm:inline">Features</a>
          <a href="#privacy" className="hidden rounded-lg px-3 py-2 text-sm text-muted hover:text-ink sm:inline">Privacy</a>
          {me ? <Link to="/app"><Button size="sm" variant="primary">Open app</Button></Link> : <Link to="/login"><Button size="sm">Sign in</Button></Link>}
        </nav>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-10 sm:px-6 lg:grid-cols-2 lg:pt-16">
          <div>
            <h1 className="text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">Your life, intelligently organized.</h1>
            <p className="mt-4 max-w-xl text-lg text-muted">
              LifePilot reads the emails and calendar you authorize, pulls out what you actually have to do, and builds a realistic plan for today —
              around your meetings, your working hours and your quiet hours.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">{cta}</div>
            <p className="mt-3 text-xs text-muted">Works with manual tasks alone. Connecting Gmail and Calendar is optional.</p>
          </div>

          <figure aria-label="Example daily plan" className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
            <figcaption className="mb-3 flex items-center justify-between text-sm">
              <span className="font-semibold">Today's plan</span>
              <Badge>Example</Badge>
            </figcaption>
            <ol className="flex flex-col gap-1.5">
              {EXAMPLE.map((i) => (
                <li key={i.time + i.title} className="flex gap-3 rounded-lg px-2 py-1.5">
                  <span className="w-12 shrink-0 pt-0.5 text-right font-mono text-xs text-muted">{i.time}</span>
                  <span
                    className={
                      i.kind === "event"
                        ? "w-1 shrink-0 rounded bg-muted/50"
                        : i.kind === "break"
                          ? "w-1 shrink-0 rounded bg-ok/60"
                          : i.kind === "prep"
                            ? "w-1 shrink-0 rounded bg-warn/70"
                            : "w-1 shrink-0 rounded bg-accent"
                    }
                    aria-hidden
                  />
                  <span>
                    <span className="block text-sm font-medium">{i.title}</span>
                    <span className="block text-xs text-muted">{i.note}</span>
                  </span>
                </li>
              ))}
            </ol>
          </figure>
        </section>

        <section id="features" className="border-y border-line bg-surface">
          <div className="mx-auto grid max-w-6xl gap-8 px-4 py-14 sm:px-6 md:grid-cols-2 lg:grid-cols-4">
            {[
              { icon: Inbox, title: "Smart inbox", body: "Finds deadlines, requests, invitations and bills. Shows why each email matters and how sure it is. You decide what becomes a task." },
              { icon: Sparkles, title: "Realistic daily plan", body: "Your top three priorities, focus blocks that fit between meetings, preparation time, breaks — and an honest list of what won't fit." },
              { icon: CalendarDays, title: "Conflict detection", body: "Spots overlapping events and suggests alternative times. It never changes your real calendar." },
              { icon: Bell, title: "Reminders that respect you", body: "Preparation and due-time reminders, quiet hours, snooze, and no repeat nagging once something is done." },
            ].map(({ icon: Icon, title, body }) => (
              <div key={title}>
                <Icon className="size-5 text-accent" aria-hidden />
                <h2 className="mt-3 font-semibold">{title}</h2>
                <p className="mt-1 text-sm text-muted">{body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-2">
          <div>
            <h2 className="text-xl font-semibold">Gmail & Google Calendar</h2>
            <p className="mt-2 text-sm text-muted">
              Read-only access, requested only when you choose to connect. LifePilot never sends, deletes, forwards or replies to email, and never edits your calendar.
              You can disconnect at any time and delete everything that was imported.
            </p>
            <p className="mt-3 text-sm">
              {config?.googleConfigured ? (
                <Badge tone="ok">Available on this server</Badge>
              ) : (
                <Badge tone="warn" title="The operator hasn't added Google OAuth credentials">Requires configuration on this server</Badge>
              )}{" "}
              {config?.demoMode && <Badge>Demo data available</Badge>}
            </p>
          </div>
          <div>
            <h2 className="text-xl font-semibold">A sound you'll recognise</h2>
            <p className="mt-2 text-sm text-muted">Three original LifePilot sounds. Pick one in settings; high-priority and deadline reminders can escalate automatically.</p>
            <ul className="mt-3 flex flex-col gap-2">
              {SOUNDS.map((s) => (
                <li key={s.id} className="flex items-center justify-between rounded-lg border border-line bg-surface px-3 py-2">
                  <span>
                    <span className="block text-sm font-medium">{s.name}</span>
                    <span className="block text-xs text-muted">{s.description}</span>
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => void playSound(s.id)} aria-label={`Preview ${s.name}`}>
                    <Volume2 className="size-4" /> Play
                  </Button>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted">In browsers, custom sounds play while LifePilot is open; system push notifications use your device's sound.</p>
          </div>
        </section>

        <section id="privacy" className="border-t border-line bg-surface">
          <div className="mx-auto grid max-w-6xl gap-8 px-4 py-14 sm:px-6 md:grid-cols-3">
            {[
              { icon: Lock, title: "Minimal data", body: "Only recent emails in a configurable window. We keep a short text excerpt for extraction — never full mailboxes or attachments." },
              { icon: ShieldCheck, title: "Encrypted credentials", body: "Google tokens are encrypted at rest and never sent to your browser. Sessions use secure, httpOnly cookies." },
              { icon: Sparkles, title: "Instructions in emails are ignored", body: "Email content is treated as data. Messages that try to instruct an AI are flagged for you, never obeyed." },
            ].map(({ icon: Icon, title, body }) => (
              <div key={title}>
                <Icon className="size-5 text-accent" aria-hidden />
                <h2 className="mt-3 font-semibold">{title}</h2>
                <p className="mt-1 text-sm text-muted">{body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-14 text-center sm:px-6">
          <h2 className="text-2xl font-semibold">Plan today in under a minute.</h2>
          <div className="mt-5 flex flex-wrap justify-center gap-2">{cta}</div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-6 text-xs text-muted sm:px-6">
          <span>© {new Date().getFullYear()} LifePilot AI</span>
          <span>You can export or delete your data at any time from Settings.</span>
        </div>
      </footer>
    </div>
  );
}
