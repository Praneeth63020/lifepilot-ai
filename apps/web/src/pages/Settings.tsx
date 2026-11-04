import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { CalendarDays, Download, Inbox, RefreshCw, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { ConnectionDTO, PreferencesDTO } from "@lifepilot/shared";
import { api, errorMessage } from "../api";
import { SoundPicker, TimeOfDay, TimezoneSelect } from "../components/prefs";
import { useToast } from "../components/toast";
import { Badge, Button, Card, ErrorNote, Field, Input, PageHeader, Select, Toggle } from "../components/ui";
import { fmtDateTime, relative } from "../lib/format";
import { disablePush, enablePush, pushSupport } from "../lib/push";
import { useSession } from "../session";

const TABS = ["General", "Notifications", "Connections", "Privacy & data", "Security"] as const;
type Tab = (typeof TABS)[number];

function usePrefsSaver() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (patch: Partial<PreferencesDTO>) => api.patch<PreferencesDTO>("/preferences", patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast({ title: "Saved", tone: "success" });
    },
    onError: (e) => toast({ title: "Couldn't save", body: errorMessage(e), tone: "error" }),
  });
}

export function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>(params.get("connected") || params.get("error") ? "Connections" : "General");

  // Result of the Google OAuth round-trip.
  useEffect(() => {
    const connected = params.get("connected");
    const error = params.get("error");
    if (connected) toast({ title: `${connected === "gmail" ? "Gmail" : "Google Calendar"} connected`, body: "The first sync is running in the background.", tone: "success" });
    if (error) toast({ title: "Connection failed", body: error, tone: "error" });
    if (connected || error) {
      qc.invalidateQueries();
      setParams({}, { replace: true });
    }
  }, [params, setParams, toast, qc]);

  return (
    <div>
      <PageHeader title="Settings" />
      <div role="tablist" aria-label="Settings sections" className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={clsx("-mb-px shrink-0 border-b-2 px-3 py-2 text-sm", tab === t ? "border-accent font-medium text-ink" : "border-transparent text-muted hover:text-ink")}>
            {t}
          </button>
        ))}
      </div>
      {tab === "General" && <GeneralTab />}
      {tab === "Notifications" && <NotificationsTab />}
      {tab === "Connections" && <ConnectionsTab />}
      {tab === "Privacy & data" && <PrivacyTab />}
      {tab === "Security" && <SecurityTab />}
    </div>
  );
}

function GeneralTab() {
  const { me } = useSession();
  const [p, setP] = useState(me!.preferences);
  const save = usePrefsSaver();
  const set = <K extends keyof PreferencesDTO>(k: K, v: PreferencesDTO[K]) => setP((x) => ({ ...x, [k]: v }));
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card title="Time & day">
        <div className="flex flex-col gap-3">
          <Field label="Timezone" htmlFor="g-tz"><TimezoneSelect id="g-tz" value={p.timezone} onChange={(v) => set("timezone", v)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Working hours start" htmlFor="g-ws"><TimeOfDay id="g-ws" value={p.workStartMin} onChange={(v) => set("workStartMin", v)} /></Field>
            <Field label="Working hours end" htmlFor="g-we"><TimeOfDay id="g-we" value={p.workEndMin} onChange={(v) => set("workEndMin", v)} /></Field>
            <Field label="Sleep from" htmlFor="g-ss"><TimeOfDay id="g-ss" value={p.sleepStartMin} onChange={(v) => set("sleepStartMin", v)} /></Field>
            <Field label="Awake at" htmlFor="g-se"><TimeOfDay id="g-se" value={p.sleepEndMin} onChange={(v) => set("sleepEndMin", v)} /></Field>
            <Field label="Daily planning time" htmlFor="g-pt"><TimeOfDay id="g-pt" value={p.dailyPlanningMin} onChange={(v) => set("dailyPlanningMin", v)} /></Field>
          </div>
        </div>
      </Card>
      <Card title="Planner">
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-3">
            <Field label="Focus block" htmlFor="g-fb"><Select id="g-fb" value={p.focusBlockMin} onChange={(e) => set("focusBlockMin", Number(e.target.value))}>{[25, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m} min</option>)}</Select></Field>
            <Field label="Break" htmlFor="g-br"><Select id="g-br" value={p.breakMin} onChange={(e) => set("breakMin", Number(e.target.value))}>{[0, 5, 10, 15, 20].map((m) => <option key={m} value={m}>{m} min</option>)}</Select></Field>
            <Field label="Buffer after events" htmlFor="g-bu"><Select id="g-bu" value={p.bufferMin} onChange={(e) => set("bufferMin", Number(e.target.value))}>{[0, 5, 10, 15, 30].map((m) => <option key={m} value={m}>{m} min</option>)}</Select></Field>
          </div>
          <Field label="Theme" htmlFor="g-th">
            <Select id="g-th" value={p.theme} onChange={(e) => set("theme", e.target.value as PreferencesDTO["theme"])}>
              <option value="system">Match system</option><option value="light">Light</option><option value="dark">Dark</option>
            </Select>
          </Field>
          <Toggle checked={p.aiEnabled} onChange={(v) => set("aiEnabled", v)} label="AI email analysis" description="When off, nothing is sent to an AI model; the built-in rule engine is used." />
          <Field label="Important senders" htmlFor="g-vip" hint="Comma-separated addresses or domains, e.g. boss@company.com, university.edu. Their emails rank higher.">
            <Input id="g-vip" value={p.importantSenders.join(", ")} onChange={(e) => set("importantSenders", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} />
          </Field>
        </div>
      </Card>
      <div className="lg:col-span-2">
        <Button
          variant="primary"
          loading={save.isPending}
          onClick={() =>
            save.mutate({
              timezone: p.timezone, workStartMin: p.workStartMin, workEndMin: p.workEndMin, sleepStartMin: p.sleepStartMin, sleepEndMin: p.sleepEndMin,
              dailyPlanningMin: p.dailyPlanningMin, focusBlockMin: p.focusBlockMin, breakMin: p.breakMin, bufferMin: p.bufferMin, theme: p.theme,
              aiEnabled: p.aiEnabled, importantSenders: p.importantSenders,
            })
          }
        >
          Save changes
        </Button>
      </div>
    </div>
  );
}

function NotificationsTab() {
  const { me, config } = useSession();
  const [p, setP] = useState(me!.preferences);
  const save = usePrefsSaver();
  const toast = useToast();
  const set = <K extends keyof PreferencesDTO>(k: K, v: PreferencesDTO[K]) => setP((x) => ({ ...x, [k]: v }));
  const support = pushSupport();
  const [pushBusy, setPushBusy] = useState(false);

  async function togglePush(on: boolean) {
    setPushBusy(true);
    try {
      if (on) {
        if (!config?.webPushPublicKey) throw new Error("Web push isn't configured on this server (VAPID keys missing).");
        const r = await enablePush(config.webPushPublicKey);
        if (!r.ok) throw new Error(r.reason);
      } else {
        await disablePush();
      }
      set("webPushEnabled", on);
      save.mutate({ webPushEnabled: on });
    } catch (e) {
      toast({ title: "Push not enabled", body: errorMessage(e), tone: "error" });
    } finally {
      setPushBusy(false);
    }
  }

  const test = useMutation({
    mutationFn: () => api.post("/reminders", { remindAt: new Date(Date.now() + 60_000).toISOString(), note: "This is a test reminder from LifePilot." }),
    onSuccess: () => toast({ title: "Test reminder scheduled", body: "It should arrive in about a minute (unless you're in quiet hours). Keep this tab open to hear the sound.", tone: "info" }),
    onError: (e) => toast({ title: "Couldn't schedule test", body: errorMessage(e), tone: "error" }),
  });

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card title="Channels">
        <Toggle checked={p.inAppEnabled} onChange={(v) => set("inAppEnabled", v)} label="In-app notifications" description="Shown with your chosen sound while LifePilot is open." />
        <Toggle
          checked={p.webPushEnabled}
          onChange={(v) => void togglePush(v)}
          disabled={pushBusy || !config?.webPushPublicKey || support === "unsupported" || support === "insecure"}
          label="Browser push notifications"
          description={
            !config?.webPushPublicKey
              ? "Not configured on this server."
              : support === "unsupported"
                ? "Not supported in this browser (on iOS, add LifePilot to your Home Screen first)."
                : support === "denied"
                  ? "Blocked in your browser's site settings."
                  : "Reaches you when LifePilot is closed. Uses your device's notification sound; Focus / Do Not Disturb still apply."
          }
        />
        <Button className="mt-2" size="sm" onClick={() => test.mutate()} loading={test.isPending}><Send className="size-4" /> Send a test reminder</Button>
      </Card>
      <Card title="Sound">
        <SoundPicker value={p.notificationSound} onChange={(v) => set("notificationSound", v)} />
        <Toggle checked={p.escalateSounds} onChange={(v) => set("escalateSounds", v)} label="Escalate for important reminders" description="High-priority items use the Priority Alert; due-now high-priority items use the Deadline Alert." />
        <p className="text-xs text-muted">Browsers only play sounds after you've interacted with the page.</p>
      </Card>
      <Card title="Timing">
        <div className="flex flex-col gap-3">
          <Field label="Heads-up before due time" htmlFor="n-lead">
            <Select id="n-lead" value={p.reminderLeadMin} onChange={(e) => set("reminderLeadMin", Number(e.target.value))}>
              {[0, 15, 30, 60, 120, 240, 1440].map((m) => <option key={m} value={m}>{m === 0 ? "None" : m < 60 ? `${m} min` : m === 1440 ? "1 day" : `${m / 60} h`}</option>)}
            </Select>
          </Field>
          <Field label="Maximum automatic reminders per task" htmlFor="n-max">
            <Select id="n-max" value={p.maxRemindersPerTask} onChange={(e) => set("maxRemindersPerTask", Number(e.target.value))}>{[0, 1, 2, 3].map((m) => <option key={m} value={m}>{m}</option>)}</Select>
          </Field>
        </div>
      </Card>
      <Card title="Quiet hours">
        <Toggle checked={p.quietHoursEnabled} onChange={(v) => set("quietHoursEnabled", v)} label="Enable quiet hours" description="Reminders that would land here wait until quiet hours end; preparation reminders move earlier instead." />
        {p.quietHoursEnabled && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="From" htmlFor="n-qs"><TimeOfDay id="n-qs" value={p.quietStartMin} onChange={(v) => set("quietStartMin", v)} /></Field>
            <Field label="Until" htmlFor="n-qe"><TimeOfDay id="n-qe" value={p.quietEndMin} onChange={(v) => set("quietEndMin", v)} /></Field>
          </div>
        )}
      </Card>
      <div className="lg:col-span-2">
        <Button
          variant="primary"
          loading={save.isPending}
          onClick={() =>
            save.mutate({
              inAppEnabled: p.inAppEnabled, notificationSound: p.notificationSound, escalateSounds: p.escalateSounds, reminderLeadMin: p.reminderLeadMin,
              maxRemindersPerTask: p.maxRemindersPerTask, quietHoursEnabled: p.quietHoursEnabled, quietStartMin: p.quietStartMin, quietEndMin: p.quietEndMin,
            })
          }
        >
          Save changes
        </Button>
      </div>
    </div>
  );
}

const SCOPE_INFO: Record<string, string> = {
  "https://www.googleapis.com/auth/gmail.readonly": "Read your email messages and settings (read-only). Used to find deadlines and requests. LifePilot can't send, delete or modify email.",
  "https://www.googleapis.com/auth/calendar.readonly": "See your calendar events (read-only). Used to find free time and conflicts. LifePilot can't create or change events.",
};

function ConnectionsTab() {
  const { config, me } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const conns = useQuery({ queryKey: ["integrations"], queryFn: () => api.get<{ items: ConnectionDTO[] }>("/integrations"), refetchInterval: 15_000 });
  const jobs = useQuery({ queryKey: ["sync-jobs"], queryFn: () => api.get<{ items: { id: string; product: string; status: string; itemsProcessed: number; error: string | null; createdAt: string }[] }>("/integrations/sync-jobs"), refetchInterval: 15_000 });
  const err = (title: string) => (e: unknown) => toast({ title, body: errorMessage(e), tone: "error" });
  const connect = useMutation({ mutationFn: (p: string) => api.post<{ url: string }>(`/integrations/${p}/connect`), onSuccess: (r) => window.location.assign(r.url), onError: err("Couldn't start connection") });
  const demo = useMutation({ mutationFn: () => api.post<{ loaded: { emails: number; events: number } }>("/integrations/demo"), onSuccess: (r) => { qc.invalidateQueries(); toast({ title: "Demo data loaded", body: `${r.loaded.emails} new emails, ${r.loaded.events} new events (synthetic).`, tone: "success" }); }, onError: err("Couldn't load demo data") });
  const sync = useMutation({ mutationFn: (p: string) => api.post(`/integrations/${p}/sync`), onSuccess: () => { toast({ title: "Sync queued", tone: "info" }); setTimeout(() => qc.invalidateQueries(), 3000); }, onError: err("Couldn't sync") });
  const disc = useMutation({
    mutationFn: (v: { p: string; deleteData: boolean }) => api.del(`/integrations/${v.p}`, undefined, v.deleteData ? { deleteData: "true" } : undefined),
    onSuccess: (_r, v) => { qc.invalidateQueries(); toast({ title: v.deleteData ? "Disconnected and imported data deleted" : "Disconnected", body: v.deleteData ? undefined : "Imported data was kept. You can delete it below.", tone: "success" }); },
    onError: err("Couldn't disconnect"),
  });

  return (
    <div className="flex flex-col gap-5">
      {!config?.googleConfigured && (
        <p className="rounded-lg border border-warn/40 bg-warn/5 p-3 text-sm">
          <strong>Google isn't configured on this server.</strong> An administrator needs to add <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> (see docs/setup.md). Until then you can use manual tasks and events{config?.demoMode ? ", or load demo data" : ""}.
        </p>
      )}
      {conns.error && <ErrorNote error={conns.error} />}
      <div className="grid gap-5 lg:grid-cols-2">
        {(conns.data?.items ?? []).map((c) => {
          const Icon = c.product === "gmail" ? Inbox : CalendarDays;
          const name = c.product === "gmail" ? "Gmail" : "Google Calendar";
          const isDemo = c.provider === "demo";
          return (
            <Card key={c.product} title={<span className="flex items-center gap-2"><Icon className="size-4 text-accent" /> {name}</span>}
              action={
                c.status === "active" ? (isDemo ? <Badge tone="warn">Demo data</Badge> : <Badge tone="ok">Connected</Badge>)
                : c.status === "not_connected" ? <Badge>Not connected</Badge>
                : <Badge tone={c.status === "disconnected" ? "neutral" : "danger"}>{c.status}</Badge>
              }
            >
              <div className="flex flex-col gap-2 text-sm">
                {c.externalEmail && !isDemo && <p>Account: <strong>{c.externalEmail}</strong></p>}
                {isDemo && <p className="text-muted">Synthetic data only. No Google account is connected.</p>}
                {c.lastSyncAt && <p className="text-muted">Last successful sync {relative(c.lastSyncAt)} ({fmtDateTime(c.lastSyncAt, me!.preferences.timezone)})</p>}
                {c.lastSyncError && <p className="text-danger">{c.lastSyncError}</p>}
                {!isDemo && (c.scopes.length > 0 || config?.googleConfigured) && (
                  <details>
                    <summary className="cursor-pointer text-muted">What access is requested?</summary>
                    <ul className="mt-1 list-disc pl-5 text-xs text-muted">
                      {(c.scopes.length ? c.scopes : [c.product === "gmail" ? "https://www.googleapis.com/auth/gmail.readonly" : "https://www.googleapis.com/auth/calendar.readonly"]).map((s) => <li key={s}>{SCOPE_INFO[s] ?? s}</li>)}
                    </ul>
                  </details>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  {c.status === "active" && <Button size="sm" onClick={() => sync.mutate(c.product)}><RefreshCw className="size-4" /> Sync now</Button>}
                  {(c.status !== "active" || isDemo) && config?.googleConfigured && (
                    <Button size="sm" variant="primary" loading={connect.isPending} onClick={() => connect.mutate(c.product)}>{c.status === "revoked" || c.status === "error" ? "Reconnect" : `Connect ${name}`}</Button>
                  )}
                  {c.status === "active" && <Button size="sm" variant="ghost" onClick={() => disc.mutate({ p: c.product, deleteData: false })}>Disconnect</Button>}
                  {c.status !== "not_connected" && (
                    <Button size="sm" variant="danger" onClick={() => confirm(`Disconnect ${name} and delete all imported ${c.product === "gmail" ? "emails and insights" : "events"}? Tasks you created stay.`) && disc.mutate({ p: c.product, deleteData: true })}>
                      Delete imported data
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
      {config?.demoMode && (
        <Card title="Demo data">
          <p className="text-sm text-muted">Load synthetic emails, events and tasks to try every feature. They're labelled as demo everywhere and kept separate from real Google data.</p>
          <Button className="mt-3" size="sm" loading={demo.isPending} onClick={() => demo.mutate()}>Load / refresh demo data</Button>
        </Card>
      )}
      <Card title="Recent sync activity">
        {jobs.data?.items.length ? (
          <ul className="flex flex-col gap-1 text-xs">
            {jobs.data.items.map((j) => (
              <li key={j.id} className="flex flex-wrap gap-2">
                <span className="w-32 text-muted">{relative(j.createdAt)}</span>
                <span className="w-16">{j.product}</span>
                <Badge tone={j.status === "succeeded" ? "ok" : j.status === "failed" ? "danger" : "neutral"}>{j.status}</Badge>
                <span className="text-muted">{j.itemsProcessed} new{j.error ? ` · ${j.error}` : ""}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted">No syncs yet.</p>}
      </Card>
    </div>
  );
}

function PrivacyTab() {
  const { refresh } = useSession();
  const nav = useNavigate();
  const toast = useToast();
  const [password, setPassword] = useState("");
  const del = useMutation({
    mutationFn: () => api.del("/account", { password }),
    onSuccess: async () => { await refresh(); nav("/"); toast({ title: "Your account and data were deleted", tone: "success" }); },
  });
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card title="What LifePilot stores">
        <ul className="list-disc pl-5 text-sm text-muted">
          <li>Your tasks, events, plans, reminders and preferences.</li>
          <li>For synced emails: subject, sender, date, a short snippet and a plain-text excerpt (max 4,000 characters) — never full mailboxes or attachments.</li>
          <li>Google access tokens, encrypted. They never leave the server.</li>
          <li>A security log of sign-ins and connection changes.</li>
        </ul>
      </Card>
      <Card title="Export your data">
        <p className="text-sm text-muted">Download everything as JSON (secrets excluded).</p>
        <a href="/api/v1/account/export" download><Button className="mt-3" size="sm"><Download className="size-4" /> Download export</Button></a>
      </Card>
      <Card title="Delete account" className="border-danger/40 lg:col-span-2">
        <p className="text-sm text-muted">Revokes Google access, cancels all reminders and permanently deletes your account and every piece of data. This can't be undone.</p>
        {del.error && <div className="mt-2"><ErrorNote error={new Error(errorMessage(del.error))} /></div>}
        <form className="mt-3 flex max-w-md gap-2" onSubmit={(e) => { e.preventDefault(); if (confirm("Permanently delete your account?")) del.mutate(); }}>
          <Input type="password" aria-label="Confirm password" placeholder="Your password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          <Button variant="danger" type="submit" loading={del.isPending} disabled={!password}>Delete everything</Button>
        </form>
      </Card>
    </div>
  );
}

function SecurityTab() {
  const { me } = useSession();
  const toast = useToast();
  const qc = useQueryClient();
  const sessions = useQuery({ queryKey: ["sessions"], queryFn: () => api.get<{ items: { id: string; current: boolean; userAgent: string | null; createdAt: string; lastSeenAt: string }[] }>("/auth/sessions") });
  const revoke = useMutation({ mutationFn: () => api.post("/auth/sessions/revoke-others"), onSuccess: () => { qc.invalidateQueries({ queryKey: ["sessions"] }); toast({ title: "Signed out other devices", tone: "success" }); } });
  const resend = useMutation({ mutationFn: () => api.post("/auth/resend-verification"), onSuccess: () => toast({ title: "Verification email sent", tone: "success" }) });
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card title="Email">
        <p className="text-sm">{me!.user.email} {me!.user.emailVerified ? <Badge tone="ok">verified</Badge> : <Badge tone="warn">not verified</Badge>}</p>
        {!me!.user.emailVerified && <Button className="mt-3" size="sm" loading={resend.isPending} onClick={() => resend.mutate()}>Resend verification email</Button>}
        <p className="mt-3 text-xs text-muted">To change your password, sign out and use “Forgot password”. All sessions are signed out after a reset.</p>
      </Card>
      <Card title="Active sessions" action={<Button size="sm" variant="ghost" onClick={() => revoke.mutate()}>Sign out others</Button>}>
        <ul className="flex flex-col gap-2 text-sm">
          {sessions.data?.items.map((s) => (
            <li key={s.id}>
              <span className="block truncate">{s.userAgent ?? "Unknown device"} {s.current && <Badge tone="accent">this device</Badge>}</span>
              <span className="text-xs text-muted">Last active {relative(s.lastSeenAt)}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
