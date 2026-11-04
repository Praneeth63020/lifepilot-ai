import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import type { NotificationDTO } from "@lifepilot/shared";
import { api, errorMessage } from "../api";
import { playSound } from "../lib/sounds";
import { useToast } from "./toast";

/**
 * Polls for in-app notifications while the app is open. New ones show a toast with actions,
 * play the selected LifePilot sound (if the browser allows audio), and — when the tab is hidden
 * and permission was granted — a local browser notification.
 */
export function NotificationWatcher() {
  const toast = useToast();
  const qc = useQueryClient();
  const seen = useRef<Set<string> | null>(null);
  const q = useQuery({
    queryKey: ["notifications", "unseen"],
    queryFn: () => api.get<{ items: NotificationDTO[] }>("/notifications", { unseen: "true", limit: 20 }),
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
  });

  useEffect(() => {
    const items = q.data?.items;
    if (!items) return;
    if (!seen.current) {
      seen.current = new Set(items.map((n) => n.id)); // don't replay old ones on first load
      return;
    }
    const fresh = items.filter((n) => !seen.current!.has(n.id));
    for (const n of fresh.reverse()) {
      seen.current.add(n.id);
      void playSound(n.sound);
      if (document.hidden && "Notification" in window && Notification.permission === "granted") {
        try {
          new Notification(n.title, { body: n.body, icon: "/favicon.svg", tag: n.reminderId ?? n.id });
        } catch {
          /* some browsers only allow notifications from a service worker */
        }
      }
      const act = (fn: () => Promise<unknown>, ok: string) => () =>
        fn()
          .then(() => {
            toast({ title: ok, tone: "success" });
            qc.invalidateQueries();
          })
          .catch((e) => toast({ title: "Action failed", body: errorMessage(e), tone: "error" }));
      toast({
        title: n.title,
        body: n.body,
        tone: "info",
        actions: [
          ...(n.taskId ? [{ label: "Mark done", onClick: act(() => api.post(`/notifications/${n.id}/complete`), "Task completed") }] : []),
          ...(n.reminderId ? [{ label: "Snooze 15 min", onClick: act(() => api.post(`/notifications/${n.id}/snooze`, { minutes: 15 }), "Snoozed for 15 minutes") }] : []),
          { label: "Dismiss", onClick: act(() => api.post(`/notifications/${n.id}/dismiss`), "Dismissed") },
        ],
      });
    }
    if (fresh.length) qc.invalidateQueries({ queryKey: ["dashboard"] });
  }, [q.data, toast, qc]);

  return null;
}
