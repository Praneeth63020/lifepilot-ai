import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Bell, CalendarDays, CheckSquare, Compass, Inbox, LayoutDashboard, LogOut, Menu, Settings, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import type { NotificationDTO } from "@lifepilot/shared";
import { api } from "../api";
import { useSession } from "../session";
import { NotificationWatcher } from "./NotificationWatcher";
import { Logo } from "./Logo";

const NAV = [
  { to: "/app", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/app/planner", label: "Planner", icon: Compass },
  { to: "/app/tasks", label: "Tasks", icon: CheckSquare },
  { to: "/app/calendar", label: "Calendar", icon: CalendarDays },
  { to: "/app/inbox", label: "Smart inbox", icon: Inbox },
  { to: "/app/notifications", label: "Notifications", icon: Bell },
  { to: "/app/settings", label: "Settings", icon: Settings },
];

export function DemoBanner() {
  const { config, me } = useSession();
  const demoData = me?.user.isDemo;
  if (!config?.demoMode && !demoData) return null;
  return (
    <div role="note" className="border-b border-warn/30 bg-warn/10 px-4 py-1.5 text-center text-xs text-warn">
      <strong>Demo mode</strong> — {demoData ? "this account shows synthetic emails and calendar events. " : ""}No real Gmail or Google Calendar account is connected
      {config?.aiProvider === "mock" ? "; AI features use the built-in rule-based engine." : "."}
    </div>
  );
}

function NavItems({ onNavigate, unseen }: { onNavigate?: () => void; unseen: number }) {
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {NAV.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          className={({ isActive }) =>
            clsx(
              "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              isActive ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-2 hover:text-ink",
            )
          }
        >
          <Icon className="size-4" aria-hidden />
          <span className="flex-1">{label}</span>
          {label === "Notifications" && unseen > 0 && (
            <span className="rounded-full bg-accent px-1.5 text-xs text-accent-ink" aria-label={`${unseen} unseen`}>
              {unseen}
            </span>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

export function AppLayout(): ReactNode {
  const { me, refresh } = useSession();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const unseen = useQuery({
    queryKey: ["notifications", "unseen"],
    queryFn: () => api.get<{ items: NotificationDTO[] }>("/notifications", { unseen: "true", limit: 20 }),
  });
  const count = unseen.data?.items.length ?? 0;
  const logout = async () => {
    await api.post("/auth/logout");
    await refresh();
    nav("/login");
  };
  const footer = (
    <div className="mt-auto border-t border-line pt-3">
      <p className="truncate px-3 text-sm font-medium">{me?.user.name}</p>
      <p className="truncate px-3 text-xs text-muted">{me?.user.email}</p>
      <button onClick={logout} className="mt-2 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted hover:bg-surface-2 hover:text-ink">
        <LogOut className="size-4" /> Sign out
      </button>
    </div>
  );

  return (
    <div className="flex min-h-screen flex-col">
      <DemoBanner />
      <NotificationWatcher />
      <div className="flex flex-1">
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-4 border-r border-line bg-surface p-4 lg:flex">
          <Logo />
          <NavItems unseen={count} />
          {footer}
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between border-b border-line bg-surface px-4 py-3 lg:hidden">
            <Logo />
            <button aria-label="Open menu" onClick={() => setOpen(true)} className="rounded-lg p-2 hover:bg-surface-2">
              <Menu className="size-5" />
            </button>
          </header>
          {open && (
            <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setOpen(false)}>
              <div className="fade-in flex h-full w-72 flex-col gap-4 bg-surface p-4" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                  <Logo />
                  <button aria-label="Close menu" onClick={() => setOpen(false)} className="rounded-lg p-2 hover:bg-surface-2">
                    <X className="size-5" />
                  </button>
                </div>
                <NavItems onNavigate={() => setOpen(false)} unseen={count} />
                {footer}
              </div>
            </div>
          )}
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
