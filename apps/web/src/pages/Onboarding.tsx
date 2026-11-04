import { useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Check, Inbox } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { PreferencesDTO } from "@lifepilot/shared";
import { api, errorMessage } from "../api";
import { Logo } from "../components/Logo";
import { SoundPicker, TimeOfDay, TimezoneSelect } from "../components/prefs";
import { useToast } from "../components/toast";
import { Badge, Button, ErrorNote, Field, Select, Toggle } from "../components/ui";
import { useSession } from "../session";

const STEPS = ["Your day", "Reminders", "Connections"] as const;

export function OnboardingPage() {
  const { me, config } = useSession();
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [p, setP] = useState<PreferencesDTO>(me!.preferences);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof PreferencesDTO>(k: K, v: PreferencesDTO[K]) => setP((x) => ({ ...x, [k]: v }));

  async function save(extra: Partial<PreferencesDTO> = {}) {
    const body = {
      timezone: p.timezone,
      workStartMin: p.workStartMin,
      workEndMin: p.workEndMin,
      sleepStartMin: p.sleepStartMin,
      sleepEndMin: p.sleepEndMin,
      dailyPlanningMin: p.dailyPlanningMin,
      focusBlockMin: p.focusBlockMin,
      reminderLeadMin: p.reminderLeadMin,
      quietHoursEnabled: p.quietHoursEnabled,
      quietStartMin: p.quietStartMin,
      quietEndMin: p.quietEndMin,
      notificationSound: p.notificationSound,
      escalateSounds: p.escalateSounds,
      ...extra,
    };
    await api.patch("/preferences", body);
  }

  async function next() {
    setError(null);
    if (step === 0 && p.workStartMin >= p.workEndMin) {
      setError("Work start must be before work end.");
      return;
    }
    setBusy("next");
    try {
      await save();
      setStep((s) => s + 1);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function finish(action?: "demo" | "gmail" | "calendar") {
    setError(null);
    setBusy(action ?? "finish");
    try {
      await save({ onboardingCompleted: true });
      if (action === "demo") {
        const r = await api.post<{ loaded: { emails: number; events: number; tasks: number } }>("/integrations/demo");
        toast({ title: "Demo data loaded", body: `${r.loaded.emails} synthetic emails, ${r.loaded.events} events, ${r.loaded.tasks} tasks.`, tone: "success" });
      }
      if (action === "gmail" || action === "calendar") {
        const { url } = await api.post<{ url: string }>(`/integrations/${action}/connect`);
        window.location.assign(url);
        return;
      }
      await qc.invalidateQueries();
      nav("/app");
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col px-4 py-8">
      <Logo to="/" />
      <ol className="mt-8 flex gap-2" aria-label="Onboarding progress">
        {STEPS.map((s, i) => (
          <li key={s} className="flex-1">
            <div className={i <= step ? "h-1 rounded bg-accent" : "h-1 rounded bg-line"} />
            <span className={i === step ? "mt-1 block text-xs font-medium" : "mt-1 block text-xs text-muted"}>{s}</span>
          </li>
        ))}
      </ol>

      <div className="mt-6 rounded-2xl border border-line bg-surface p-5 sm:p-6">
        {error && <div className="mb-4"><ErrorNote error={new Error(error)} /></div>}

        {step === 0 && (
          <div className="flex flex-col gap-4">
            <h1 className="text-lg font-semibold">How does your day usually look?</h1>
            <Field label="Timezone" htmlFor="tz" hint="All reminders and plans use this timezone.">
              <TimezoneSelect id="tz" value={p.timezone} onChange={(v) => set("timezone", v)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Work / study starts" htmlFor="ws"><TimeOfDay id="ws" value={p.workStartMin} onChange={(v) => set("workStartMin", v)} /></Field>
              <Field label="Work / study ends" htmlFor="we"><TimeOfDay id="we" value={p.workEndMin} onChange={(v) => set("workEndMin", v)} /></Field>
              <Field label="Usually asleep from" htmlFor="ss"><TimeOfDay id="ss" value={p.sleepStartMin} onChange={(v) => set("sleepStartMin", v)} /></Field>
              <Field label="Usually awake at" htmlFor="se"><TimeOfDay id="se" value={p.sleepEndMin} onChange={(v) => set("sleepEndMin", v)} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Plan my day at" htmlFor="pt"><TimeOfDay id="pt" value={p.dailyPlanningMin} onChange={(v) => set("dailyPlanningMin", v)} /></Field>
              <Field label="Preferred focus session" htmlFor="fb">
                <Select id="fb" value={p.focusBlockMin} onChange={(e) => set("focusBlockMin", Number(e.target.value))}>
                  {[25, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m} minutes</option>)}
                </Select>
              </Field>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="flex flex-col gap-4">
            <h1 className="text-lg font-semibold">Reminders</h1>
            <Field label="Remind me before something is due" htmlFor="lead">
              <Select id="lead" value={p.reminderLeadMin} onChange={(e) => set("reminderLeadMin", Number(e.target.value))}>
                {[0, 15, 30, 60, 120, 240, 1440].map((m) => <option key={m} value={m}>{m === 0 ? "No advance reminder" : m < 60 ? `${m} minutes before` : m === 1440 ? "1 day before" : `${m / 60} hour${m > 60 ? "s" : ""} before`}</option>)}
              </Select>
            </Field>
            <Toggle checked={p.quietHoursEnabled} onChange={(v) => set("quietHoursEnabled", v)} label="Quiet hours" description="No reminders during this window — they wait until it ends (preparation reminders move earlier instead)." />
            {p.quietHoursEnabled && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="From" htmlFor="qs"><TimeOfDay id="qs" value={p.quietStartMin} onChange={(v) => set("quietStartMin", v)} /></Field>
                <Field label="Until" htmlFor="qe"><TimeOfDay id="qe" value={p.quietEndMin} onChange={(v) => set("quietEndMin", v)} /></Field>
              </div>
            )}
            <div>
              <p className="mb-2 text-sm font-medium">Notification sound</p>
              <SoundPicker value={p.notificationSound} onChange={(v) => set("notificationSound", v)} />
            </div>
            <Toggle checked={p.escalateSounds} onChange={(v) => set("escalateSounds", v)} label="Use Priority / Deadline sounds for important reminders" />
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-4">
            <h1 className="text-lg font-semibold">Connect your email and calendar (optional)</h1>
            <p className="text-sm text-muted">
              LifePilot asks Google for <strong>read-only</strong> access. It reads recent emails (14 days by default) and upcoming events to find deadlines and free time.
              It can't send, delete or change anything, and you can disconnect and delete imported data any time.
            </p>
            <ul className="flex flex-col gap-2 text-sm">
              <li className="flex items-center justify-between gap-3 rounded-lg border border-line p-3">
                <span className="flex items-center gap-2"><Inbox className="size-4 text-accent" /> Gmail — read-only</span>
                <Button size="sm" disabled={!config?.googleConfigured} loading={busy === "gmail"} onClick={() => finish("gmail")}>Connect</Button>
              </li>
              <li className="flex items-center justify-between gap-3 rounded-lg border border-line p-3">
                <span className="flex items-center gap-2"><CalendarDays className="size-4 text-accent" /> Google Calendar — read-only</span>
                <Button size="sm" disabled={!config?.googleConfigured} loading={busy === "calendar"} onClick={() => finish("calendar")}>Connect</Button>
              </li>
            </ul>
            {!config?.googleConfigured && <p className="text-xs text-muted"><Badge tone="warn">Not configured</Badge> This server has no Google OAuth credentials, so connecting is unavailable.</p>}
            {config?.demoMode && (
              <div className="rounded-lg border border-warn/40 bg-warn/5 p-3 text-sm">
                <p className="font-medium">Try it with demo data</p>
                <p className="mt-1 text-muted">Loads synthetic emails, calendar events and tasks into your account, clearly labelled as demo. No real account is connected.</p>
                <Button className="mt-2" size="sm" loading={busy === "demo"} onClick={() => finish("demo")}>Load demo data</Button>
              </div>
            )}
          </div>
        )}

        <div className="mt-6 flex justify-between">
          <Button variant="ghost" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>Back</Button>
          {step < 2 ? (
            <Button variant="primary" loading={busy === "next"} onClick={next}>Continue</Button>
          ) : (
            <Button variant="primary" loading={busy === "finish"} onClick={() => finish()}>
              <Check className="size-4" /> Finish — I'll add tasks manually
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
