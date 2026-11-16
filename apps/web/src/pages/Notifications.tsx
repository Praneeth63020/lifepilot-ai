import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { AlertTriangle, Bell, BellOff, CheckCheck, Clock, Moon, Settings2, Smartphone, Trash2, Volume2, type LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { NotificationDTO, PreferencesDTO, ReminderDTO } from "@lifepilot/shared";
import { api, errorMessage } from "../api";
import { useToast } from "../components/toast";
import { Badge, Button, Card, Empty, ErrorNote, PageHeader, PriorityBadge, Spinner, StatCard, buttonClass } from "../components/ui";
import { fmtDate, fmtDateTime, fmtTime, hhmm, localISODate, minutesLabel, relative } from "../lib/format";
import { useSession, useTz } from "../session";

const STATUS_LABEL: Record<NotificationDTO["status"], { text: string; tone: "ok" | "neutral" | "danger" | "warn" | "accent"; hint: string }> = {
  available: { text: "New", tone: "accent", hint: "Shown in LifePilot" },
  seen: { text: "Seen", tone: "neutral", hint: "You've seen it" },
  dismissed: { text: "Dismissed", tone: "neutral", hint: "Dismissed" },
  accepted: { text: "Sent to push service", tone: "ok", hint: "The browser's push service accepted it. Display on the device isn't confirmed." },
  pending: { text: "Sending", tone: "warn", hint: "In progress" },
  failed: { text: "Failed", tone: "danger", hint: "Could not be sent" },
  suppressed: { text: "Suppressed", tone: "neutral", hint: "Duplicate or limit reached" },
};

const KIND_LABEL: Record<ReminderDTO["kind"], string> = { prep: "Heads-up", due: "Due", event: "Event prep", custom: "Custom" };
const SOUND_LABEL: Record<PreferencesDTO["notificationSound"], string> = { daily_chime: "Daily chime", priority_alert: "Priority alert", deadline_alert: "Deadline alert", none: "No sound" };

type Filter = "all" | "unseen" | "failed" | "push";
const FILTERS: { id: Filter; label: string; match: (n: NotificationDTO) => boolean }[] = [
  { id: "all", label: "All", match: () => true },
  { id: "unseen", label: "Unseen", match: (n) => n.status === "available" },
  { id: "failed", label: "Failed", match: (n) => n.status === "failed" },
  { id: "push", label: "Push", match: (n) => n.channel === "web_push" },
];
const PAGE = 25;

export function NotificationsPage() {
  const tz = useTz();
  const { me } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>("all");
  const [showAll, setShowAll] = useState(false);
  const list = useQuery({ queryKey: ["notifications", "all"], queryFn: () => api.get<{ items: NotificationDTO[] }>("/notifications", { limit: 200 }) });
  const upcoming = useQuery({ queryKey: ["reminders"], queryFn: () => api.get<{ items: ReminderDTO[] }>("/reminders") });
  const ok = (title: string) => () => {
    qc.invalidateQueries();
    toast({ title, tone: "success" });
  };
  const err = (e: unknown) => toast({ title: "Action failed", body: errorMessage(e), tone: "error" });
  const seenAll = useMutation({ mutationFn: () => api.post("/notifications/seen-all"), onSuccess: ok("All marked as seen"), onError: err });
  const act = useMutation({
    mutationFn: (v: { id: string; action: "dismiss" | "complete" | "snooze" | "seen" }) =>
      api.post(`/notifications/${v.id}/${v.action}`, v.action === "snooze" ? { minutes: 60 } : {}),
    onSuccess: (_r, v) => {
      if (v.action === "seen") return void qc.invalidateQueries();
      ok(v.action === "snooze" ? "Snoozed for 1 hour" : v.action === "complete" ? "Task completed" : "Dismissed")();
    },
    onError: err,
  });
  const cancel = useMutation({ mutationFn: (id: string) => api.del(`/reminders/${id}`), onSuccess: ok("Reminder cancelled"), onError: err });
  const snoozeRem = useMutation({ mutationFn: (id: string) => api.post(`/reminders/${id}/snooze`, { minutes: 60 }), onSuccess: ok("Pushed back 1 hour"), onError: err });

  const items = useMemo(() => list.data?.items ?? [], [list.data]);
  const reminders = upcoming.data?.items ?? [];
  const unseen = items.filter((n) => n.status === "available").length;
  const failed = items.filter((n) => n.status === "failed").length;
  const weekAgo = Date.now() - 7 * 86_400_000;
  const lastWeek = items.filter((n) => new Date(n.createdAt).getTime() >= weekAgo);
  const next = reminders[0];

  // Unseen first, then newest first.
  const shown = useMemo(() => {
    const m = FILTERS.find((f) => f.id === filter)!.match;
    return items.filter(m).sort((a, b) => Number(b.status === "available") - Number(a.status === "available") || b.createdAt.localeCompare(a.createdAt));
  }, [items, filter]);
  const unseenShown = shown.filter((n) => n.status === "available");
  const restShown = shown.filter((n) => n.status !== "available");
  const restVisible = showAll ? restShown : restShown.slice(0, Math.max(0, PAGE - unseenShown.length));

  // Group scheduled reminders by day in the user's timezone.
  const groups = useMemo(() => {
    const today = localISODate(new Date(), tz);
    const tomorrow = localISODate(new Date(Date.now() + 86_400_000), tz);
    const out: { key: string; label: string; items: ReminderDTO[] }[] = [];
    for (const r of reminders) {
      const key = localISODate(new Date(r.remindAt), tz);
      let g = out.find((x) => x.key === key);
      if (!g) out.push((g = { key, label: key === today ? "Today" : key === tomorrow ? "Tomorrow" : fmtDate(r.remindAt, tz, { weekday: "long", month: "short", day: "numeric" }), items: [] }));
      g.items.push(r);
    }
    return out;
  }, [reminders, tz]);

  const renderItem = (n: NotificationDTO) => {
    const s = STATUS_LABEL[n.status];
    const Icon: LucideIcon = n.status === "failed" ? AlertTriangle : n.channel === "web_push" ? Smartphone : Bell;
    const actionable = n.channel === "in_app" && (n.status === "available" || n.status === "seen");
    return (
      <li key={n.id} className={clsx("flex gap-3 py-3.5", n.status === "dismissed" && "opacity-75")}>
        <span
          aria-hidden
          className={clsx(
            "mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl [&>svg]:size-4",
            n.status === "failed" ? "bg-danger/10 text-danger" : n.status === "available" ? "bg-accent text-accent-ink" : "bg-surface-2 text-muted",
          )}
        >
          <Icon />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={clsx("break-words text-sm", n.status === "available" ? "font-semibold" : "font-medium")}>{n.title}</span>
            <PriorityBadge priority={n.priority} />
            <Badge tone={s.tone} title={n.error ?? s.hint}>{s.text}</Badge>
            <Badge>{n.channel === "web_push" ? "Push" : "In-app"}</Badge>
          </div>
          {n.body && <p className="mt-0.5 break-words text-sm text-muted">{n.body}</p>}
          <p className="mt-1 text-xs text-muted">
            <time dateTime={n.createdAt}>{fmtDateTime(n.createdAt, tz)}</time> · {relative(n.createdAt)}
            {n.seenAt && n.status !== "available" && ` · seen ${relative(n.seenAt)}`}
          </p>
          {n.error && (
            <p className="mt-2 flex gap-1.5 break-words rounded-lg bg-danger/10 px-2.5 py-1.5 text-xs text-danger">
              <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden /> {n.error}
            </p>
          )}
          {actionable && (
            <div className="mt-2 flex flex-wrap gap-1">
              {n.taskId && <Button size="sm" variant="secondary" onClick={() => act.mutate({ id: n.id, action: "complete" })}><CheckCheck className="size-4" aria-hidden /> Mark done</Button>}
              {n.reminderId && <Button size="sm" variant="ghost" onClick={() => act.mutate({ id: n.id, action: "snooze" })}><Clock className="size-4" aria-hidden /> Snooze 1h</Button>}
              {n.status === "available" && <Button size="sm" variant="ghost" onClick={() => act.mutate({ id: n.id, action: "seen" })}>Mark seen</Button>}
              <Button size="sm" variant="ghost" onClick={() => act.mutate({ id: n.id, action: "dismiss" })}>Dismiss</Button>
            </div>
          )}
        </div>
      </li>
    );
  };

  return (
    <div>
      <PageHeader
        title="Notifications"
        subtitle="Scheduled reminders and everything LifePilot has sent you, with delivery status."
        actions={
          <>
            <Link to="/app/settings?tab=notifications" className={buttonClass({ variant: "ghost" })}>
              <Settings2 className="size-4" aria-hidden /> Notification preferences
            </Link>
            <Button onClick={() => seenAll.mutate()} loading={seenAll.isPending} disabled={list.isSuccess && unseen === 0}>
              <CheckCheck className="size-4" aria-hidden /> Mark all seen
            </Button>
          </>
        }
      />

      {/* Summary — numbers only, so reminder titles appear once on this page. */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label="Unseen" value={list.data ? unseen : "—"} icon={<Bell />} tone={unseen ? "accent" : "neutral"} hint={unseen ? "Waiting in LifePilot" : "You're all caught up"} />
        <StatCard
          label="Scheduled reminders"
          value={upcoming.data ? reminders.length : "—"}
          icon={<Clock />}
          tone="violet"
          hint={next ? `Next ${relative(next.remindAt)} · ${fmtTime(next.remindAt, tz)}` : "Nothing scheduled"}
        />
        <StatCard label="Sent in the last 7 days" value={list.data ? lastWeek.length : "—"} icon={<Smartphone />} tone="blue" hint={`${lastWeek.filter((n) => n.channel === "in_app").length} in-app · ${lastWeek.filter((n) => n.channel === "web_push").length} push`} />
        <StatCard label="Failed deliveries" value={list.data ? failed : "—"} icon={<AlertTriangle />} tone={failed ? "danger" : "ok"} hint={failed ? "Details are shown on each one below" : "Everything was delivered"} />
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] lg:grid-rows-[auto_1fr]">
        <Card
          title="Notifications"
          icon={<Bell />}
          subtitle="Unseen first, then your full history with delivery status."
          action={
            <div role="group" aria-label="Filter notifications" className="flex flex-wrap justify-end gap-1">
              {FILTERS.map((f) => {
                const count = items.filter(f.match).length;
                return (
                  <button
                    key={f.id}
                    type="button"
                    aria-pressed={filter === f.id}
                    onClick={() => {
                      setFilter(f.id);
                      setShowAll(false);
                    }}
                    className={clsx(
                      "rounded-full border px-2.5 py-1 text-xs transition-colors",
                      filter === f.id ? "border-accent bg-accent-soft font-medium text-ink" : "border-line text-muted hover:bg-surface-2 hover:text-ink",
                    )}
                  >
                    {f.label} <span className="tabular-nums">{count}</span>
                  </button>
                );
              })}
            </div>
          }
          className="min-w-0 lg:col-start-1 lg:row-start-1"
        >
          {list.isLoading && <Spinner />}
          {list.error && <ErrorNote error={list.error} onRetry={() => list.refetch()} />}
          {list.data && shown.length === 0 && (
            <Empty icon={<BellOff />} title={filter === "all" ? "Nothing sent yet" : "Nothing here"}>
              {filter === "all" ? "Reminders you receive appear here, with whether they reached your device." : "No notifications match this filter."}
            </Empty>
          )}
          {unseenShown.length > 0 && (
            <>
              <h3 className="mt-1 text-xs font-semibold uppercase tracking-[0.08em] text-muted">Unseen · {unseenShown.length}</h3>
              <ul className="flex flex-col divide-y divide-line">{unseenShown.map(renderItem)}</ul>
            </>
          )}
          {restVisible.length > 0 && (
            <>
              {unseenShown.length > 0 && <h3 className="mt-4 border-t border-line pt-4 text-xs font-semibold uppercase tracking-[0.08em] text-muted">Earlier</h3>}
              <ul className="flex flex-col divide-y divide-line">{restVisible.map(renderItem)}</ul>
            </>
          )}
          {restVisible.length < restShown.length && (
            <div className="mt-2 border-t border-line pt-3 text-center">
              <Button size="sm" variant="ghost" onClick={() => setShowAll(true)}>
                Show all {shown.length}
              </Button>
            </div>
          )}
        </Card>

        <Card title="Upcoming reminders" icon={<Clock />} subtitle="Push one back an hour or cancel it here; edit the task to change its due time." className="min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          {upcoming.isLoading && <Spinner />}
          {upcoming.error && <ErrorNote error={upcoming.error} onRetry={() => upcoming.refetch()} />}
          {upcoming.data?.items.length === 0 && (
            <Empty icon={<BellOff />} title="No reminders scheduled">
              Add a due time to a task and LifePilot schedules a preparation and a due reminder.
            </Empty>
          )}
          <div className="flex flex-col gap-4">
            {groups.map((g) => (
              <div key={g.key}>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-muted">{g.label}</h3>
                <ul className="flex flex-col divide-y divide-line">
                  {g.items.map((r) => (
                    <li key={r.id} className="flex items-start gap-3 py-2.5">
                      <span className="w-[4.75rem] shrink-0 whitespace-nowrap pt-0.5 text-sm font-semibold tabular-nums">{fmtTime(r.remindAt, tz)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block break-words text-sm font-medium">{r.title}</span>
                        <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                          <Badge tone={r.kind === "due" ? "accent" : r.kind === "prep" ? "violet" : "blue"}>{KIND_LABEL[r.kind]}</Badge>
                          <PriorityBadge priority={r.priority} />
                          <span>{relative(r.remindAt)}</span>
                          {r.snoozeCount > 0 && <span>· snoozed {r.snoozeCount}×</span>}
                        </span>
                        {r.note && <span className="mt-1 block text-xs text-muted">{r.note}</span>}
                      </span>
                      <span className="flex shrink-0 gap-0.5">
                        <Button size="sm" variant="ghost" title="Snooze 1 hour" disabled={snoozeRem.isPending} onClick={() => snoozeRem.mutate(r.id)}>
                          +1h
                        </Button>
                        <Button size="sm" variant="ghost" aria-label="Cancel reminder" title="Cancel reminder" disabled={cancel.isPending} onClick={() => cancel.mutate(r.id)}>
                          <Trash2 className="size-4" aria-hidden />
                        </Button>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Card>

        {me && <DeliveryCard prefs={me.preferences} />}
      </div>
    </div>
  );
}

/** The user's current delivery settings (read-only here; changed in Settings → Notifications). */
function DeliveryCard({ prefs }: { prefs: PreferencesDTO }) {
  const rows: { icon: LucideIcon; label: string; value: string }[] = [
    { icon: Bell, label: "In-app", value: prefs.inAppEnabled ? "On" : "Off" },
    { icon: Smartphone, label: "Browser push", value: prefs.webPushEnabled ? "On" : "Off" },
    { icon: Moon, label: "Quiet hours", value: prefs.quietHoursEnabled ? `${hhmm(prefs.quietStartMin)}–${hhmm(prefs.quietEndMin)}` : "Off" },
    { icon: Clock, label: "Heads-up before due", value: minutesLabel(prefs.reminderLeadMin) },
    { icon: Volume2, label: "Sound", value: SOUND_LABEL[prefs.notificationSound] ?? prefs.notificationSound },
  ];
  return (
    <Card
      className="min-w-0 lg:col-start-1 lg:row-start-2"
      title="Delivery"
      icon={<Settings2 />}
      subtitle="How reminders reach you."
      action={
        <Link to="/app/settings?tab=notifications" className={buttonClass({ size: "sm" })}>
          Change
        </Link>
      }
    >
      <dl className="grid grid-cols-1 gap-x-8 gap-y-2.5 sm:grid-cols-2">
        {rows.map(({ icon: Icon, label, value }) => (
          <div key={label} className="flex items-center justify-between gap-3 text-sm">
            <dt className="flex items-center gap-2 text-muted">
              <Icon className="size-4" aria-hidden /> {label}
            </dt>
            <dd className={clsx("font-medium", value === "Off" && "text-muted")}>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-xs text-muted">
        Open <span className="font-medium text-ink">Settings → Notifications</span> to change these, send a test reminder or set up push on this device.
      </p>
    </Card>
  );
}
