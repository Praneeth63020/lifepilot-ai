import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellOff, Clock, Trash2 } from "lucide-react";
import type { NotificationDTO, ReminderDTO } from "@lifepilot/shared";
import { api, errorMessage } from "../api";
import { useToast } from "../components/toast";
import { Badge, Button, Card, Empty, ErrorNote, PageHeader, PriorityBadge, Spinner } from "../components/ui";
import { fmtDateTime, relative } from "../lib/format";
import { useTz } from "../session";

const STATUS_LABEL: Record<NotificationDTO["status"], { text: string; tone: "ok" | "neutral" | "danger" | "warn" | "accent"; hint: string }> = {
  available: { text: "New", tone: "accent", hint: "Shown in LifePilot" },
  seen: { text: "Seen", tone: "neutral", hint: "You've seen it" },
  dismissed: { text: "Dismissed", tone: "neutral", hint: "Dismissed" },
  accepted: { text: "Sent to push service", tone: "ok", hint: "The browser's push service accepted it. Display on the device isn't confirmed." },
  pending: { text: "Sending", tone: "warn", hint: "In progress" },
  failed: { text: "Failed", tone: "danger", hint: "Could not be sent" },
  suppressed: { text: "Suppressed", tone: "neutral", hint: "Duplicate or limit reached" },
};

export function NotificationsPage() {
  const tz = useTz();
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: ["notifications", "all"], queryFn: () => api.get<{ items: NotificationDTO[] }>("/notifications", { limit: 100 }) });
  const upcoming = useQuery({ queryKey: ["reminders"], queryFn: () => api.get<{ items: ReminderDTO[] }>("/reminders") });
  const ok = (title: string) => () => {
    qc.invalidateQueries();
    toast({ title, tone: "success" });
  };
  const err = (e: unknown) => toast({ title: "Action failed", body: errorMessage(e), tone: "error" });
  const seenAll = useMutation({ mutationFn: () => api.post("/notifications/seen-all"), onSuccess: ok("All marked as seen"), onError: err });
  const act = useMutation({
    mutationFn: (v: { id: string; action: "dismiss" | "complete" | "snooze" }) =>
      api.post(`/notifications/${v.id}/${v.action}`, v.action === "snooze" ? { minutes: 60 } : {}),
    onSuccess: (_r, v) => ok(v.action === "snooze" ? "Snoozed for 1 hour" : v.action === "complete" ? "Task completed" : "Dismissed")(),
    onError: err,
  });
  const cancel = useMutation({ mutationFn: (id: string) => api.del(`/reminders/${id}`), onSuccess: ok("Reminder cancelled"), onError: err });
  const snoozeRem = useMutation({ mutationFn: (id: string) => api.post(`/reminders/${id}/snooze`, { minutes: 60 }), onSuccess: ok("Pushed back 1 hour"), onError: err });

  return (
    <div>
      <PageHeader title="Notifications" subtitle="Scheduled reminders and everything LifePilot has sent you." actions={<Button onClick={() => seenAll.mutate()} loading={seenAll.isPending}>Mark all seen</Button>} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title={<span className="flex items-center gap-1.5"><Clock className="size-4 text-accent" /> Scheduled</span>}>
          {upcoming.isLoading && <Spinner />}
          {upcoming.error && <ErrorNote error={upcoming.error} />}
          {upcoming.data?.items.length === 0 && <Empty icon={<BellOff className="size-6" />} title="No reminders scheduled">Add a due time to a task and LifePilot schedules a preparation and a due reminder.</Empty>}
          <ul className="flex flex-col divide-y divide-line">
            {upcoming.data?.items.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{r.title}</span>
                  <span className="text-xs text-muted">
                    {r.kind === "prep" ? "Heads-up" : r.kind === "due" ? "Due" : r.kind === "event" ? "Event prep" : "Custom"} · {fmtDateTime(r.remindAt, tz)} ({relative(r.remindAt)})
                    {r.snoozeCount > 0 && ` · snoozed ${r.snoozeCount}×`}
                  </span>
                </span>
                <span className="flex shrink-0 gap-1">
                  <Button size="sm" variant="ghost" onClick={() => snoozeRem.mutate(r.id)}>+1h</Button>
                  <Button size="sm" variant="ghost" aria-label="Cancel reminder" onClick={() => cancel.mutate(r.id)}><Trash2 className="size-4" /></Button>
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="History">
          {list.isLoading && <Spinner />}
          {list.error && <ErrorNote error={list.error} />}
          {list.data?.items.length === 0 && <Empty title="Nothing sent yet" />}
          <ul className="flex flex-col divide-y divide-line">
            {list.data?.items.map((n) => {
              const s = STATUS_LABEL[n.status];
              return (
                <li key={n.id} className="py-2.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-medium">{n.title}</span>
                    <PriorityBadge priority={n.priority} />
                    <Badge tone={s.tone} title={n.error ?? s.hint}>{n.channel === "web_push" ? "Push · " : ""}{s.text}</Badge>
                  </div>
                  <p className="text-xs text-muted">{n.body}</p>
                  <p className="text-xs text-muted">{fmtDateTime(n.createdAt, tz)}{n.error ? ` · ${n.error}` : ""}</p>
                  {n.channel === "in_app" && (n.status === "available" || n.status === "seen") && (
                    <div className="mt-1.5 flex gap-1">
                      {n.taskId && <Button size="sm" variant="ghost" onClick={() => act.mutate({ id: n.id, action: "complete" })}>Mark done</Button>}
                      {n.reminderId && <Button size="sm" variant="ghost" onClick={() => act.mutate({ id: n.id, action: "snooze" })}>Snooze 1h</Button>}
                      <Button size="sm" variant="ghost" onClick={() => act.mutate({ id: n.id, action: "dismiss" })}>Dismiss</Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
    </div>
  );
}
