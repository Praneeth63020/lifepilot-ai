import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import {
  Bell,
  CalendarDays,
  CheckSquare,
  ChevronsLeft,
  ChevronsRight,
  Compass,
  FolderKanban,
  Inbox,
  LayoutDashboard,
  LogOut,
  Menu as MenuIcon,
  Plus,
  Search,
  Settings,
  LifeBuoy,
  X,
} from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import type { NotificationDTO } from "@lifepilot/shared";
import { api } from "../api";
import { disablePush } from "../lib/push";
import { useSession, useTz } from "../session";
import { ErrorBoundary } from "./ErrorBoundary";
import { NotificationWatcher } from "./NotificationWatcher";
import { Logo } from "./Logo";
import { TaskFormModal } from "./TaskForm";
import { Avatar, Button, Menu } from "./ui";

const NAV = [
  { to: "/app", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/app/planner", label: "Planner", icon: Compass },
  { to: "/app/tasks", label: "Tasks", icon: CheckSquare },
  { to: "/app/projects", label: "Projects", icon: FolderKanban },
  { to: "/app/calendar", label: "Calendar", icon: CalendarDays },
  { to: "/app/inbox", label: "Smart inbox", icon: Inbox },
  { to: "/app/notifications", label: "Notifications", icon: Bell },
  { to: "/app/settings", label: "Settings", icon: Settings },
  { to: "/app/support", label: "Help & support", icon: LifeBuoy },
];

const COLLAPSE_KEY = "lp-sidebar-collapsed";

export function DemoBanner() {
  const { config, me } = useSession();
  const demoData = me?.user.isDemo;
  if (!config?.demoMode && !demoData) return null;
  return (
    <div role="note" className="border-b border-warn/25 bg-warn/10 px-4 py-1.5 text-center text-xs text-warn">
      <strong>Demo mode</strong>
      <span className="sm:hidden"> — {demoData ? "synthetic emails and events" : "no real Google account connected"}{config?.aiProvider === "mock" ? ", rule-based AI" : ""}.</span>
      <span className="hidden sm:inline">
        {" "}— {demoData ? "this account shows synthetic emails and calendar events. " : ""}No real Gmail or Google Calendar account is connected
        {config?.aiProvider === "mock" ? "; AI features use the built-in rule-based engine." : "."}
      </span>
    </div>
  );
}

function NavItems({ onNavigate, unseen, collapsed = false }: { onNavigate?: () => void; unseen: number; collapsed?: boolean }) {
  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {NAV.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          title={collapsed ? label : undefined}
          className={({ isActive }) =>
            clsx(
              "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
              collapsed && "justify-center px-0",
              isActive ? "bg-side-2 text-side-ink" : "text-side-muted hover:bg-side-2/60 hover:text-side-ink",
            )
          }
        >
          {({ isActive }) => (
            <>
              {isActive && <span aria-hidden className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-accent" />}
              <Icon className={clsx("size-[18px] shrink-0", isActive && "text-accent")} aria-hidden />
              <span className={clsx("flex-1", collapsed && "sr-only")}>{label}</span>
              {label === "Notifications" && unseen > 0 && (
                <span
                  className={clsx("rounded-full bg-accent px-1.5 text-xs font-semibold text-accent-ink", collapsed && "absolute right-1.5 top-1.5 min-w-4 px-1 text-[10px]")}
                  aria-label={`${unseen} unseen`}
                >
                  {unseen}
                </span>
              )}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

function greeting(tz: string) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(new Date()));
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

export function AppLayout(): ReactNode {
  const { me, startNewSession } = useSession();
  const tz = useTz();
  const nav = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [quickAdd, setQuickAdd] = useState(false);
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
    } catch {
      /* storage unavailable */
    }
  }, [collapsed]);
  // The drawer closes whenever the route changes.
  useEffect(() => setOpen(false), [pathname]);

  const unseen = useQuery({
    queryKey: ["notifications", "unseen"],
    queryFn: () => api.get<{ items: NotificationDTO[] }>("/notifications", { unseen: "true", limit: 20 }),
  });
  const count = unseen.data?.items.length ?? 0;
  const logout = async () => {
    // Stop this browser receiving the signed-out user's reminders (best effort).
    await disablePush().catch(() => undefined);
    await api.post("/auth/logout").catch(() => undefined);
    await startNewSession();
    nav("/login");
  };
  const submitSearch = (e: FormEvent) => {
    e.preventDefault();
    const q = search.trim();
    nav(q ? `/app/tasks?q=${encodeURIComponent(q)}` : "/app/tasks");
  };
  const name = me?.user.name ?? "";
  const firstName = name.split(/\s+/)[0] ?? "";
  const today = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric" }).format(new Date());

  const sidebarFooter = (compact: boolean) => (
    <div className="mt-auto border-t border-side-line pt-3">
      <div className={clsx("flex items-center gap-3 px-2", compact && "justify-center px-0")}>
        <Avatar name={name} />
        {!compact && (
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-side-ink">{name}</p>
            <p className="truncate text-xs text-side-muted">{me?.user.email}</p>
          </div>
        )}
      </div>
      <button
        onClick={logout}
        title={compact ? "Sign out" : undefined}
        className={clsx("mt-2 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-side-muted hover:bg-side-2/60 hover:text-side-ink", compact && "justify-center px-0")}
      >
        <LogOut className="size-4" aria-hidden /> <span className={clsx(compact && "sr-only")}>Sign out</span>
      </button>
    </div>
  );

  return (
    <div className="flex min-h-screen">
      <NotificationWatcher />
      {/* Desktop sidebar: charcoal, full height, collapsible to icons. */}
      <aside
        className={clsx(
          "sticky top-0 hidden h-screen shrink-0 flex-col gap-6 overflow-y-auto bg-side p-3 transition-[width] duration-200 lg:flex",
          collapsed ? "w-[76px]" : "w-64",
        )}
      >
        <div className={clsx("flex items-center pt-2", collapsed ? "justify-center" : "justify-between px-2")}>
          <Logo onDark compact={collapsed} />
        </div>
        <NavItems unseen={count} collapsed={collapsed} />
        <button
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-pressed={collapsed}
          className={clsx("flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-side-muted hover:bg-side-2/60 hover:text-side-ink", collapsed && "justify-center px-0")}
        >
          {collapsed ? <ChevronsRight className="size-4" aria-hidden /> : <ChevronsLeft className="size-4" aria-hidden />}
          <span className={clsx(collapsed && "sr-only")}>Collapse</span>
        </button>
        {sidebarFooter(collapsed)}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <DemoBanner />
        {/* Top header */}
        <header className="sticky top-0 z-20 border-b border-line bg-canvas/85 backdrop-blur supports-[backdrop-filter]:bg-canvas/75">
          <div className="flex h-16 w-full items-center gap-3 px-4 sm:px-6 lg:px-8 2xl:px-12">
            <button aria-label="Open menu" onClick={() => setOpen(true)} className="rounded-xl p-2 hover:bg-surface-2 lg:hidden">
              <MenuIcon className="size-5" />
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-base font-semibold sm:text-lg">
                {greeting(tz)}
                {firstName ? `, ${firstName}` : ""}
              </p>
              <p className="hidden truncate text-xs text-muted sm:block">{today}</p>
            </div>
            <form role="search" onSubmit={submitSearch} className="relative hidden md:block">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
              <input
                type="search"
                aria-label="Search tasks"
                placeholder="Search tasks…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-10 w-56 rounded-xl border border-line bg-surface pl-9 pr-3 text-sm placeholder:text-muted/70 focus:border-accent-strong focus:outline-none focus:ring-2 focus:ring-accent/30 xl:w-72"
              />
            </form>
            <Button variant="primary" onClick={() => setQuickAdd(true)} aria-label="Quick add task">
              <Plus className="size-4" aria-hidden /> <span className="hidden sm:inline">New task</span>
            </Button>
            <Link to="/app/notifications" aria-label={count ? `Notifications, ${count} unseen` : "Notifications"} className="relative grid size-10 place-items-center rounded-xl border border-line bg-surface hover:bg-surface-2">
              <Bell className="size-[18px]" aria-hidden />
              {count > 0 && <span aria-hidden className="absolute -right-1 -top-1 min-w-5 rounded-full bg-accent px-1 text-center text-[11px] font-semibold leading-5 text-accent-ink">{count}</span>}
            </Link>
            <Menu
              label="Account menu"
              trigger={<Avatar name={name} />}
              triggerClassName="rounded-full focus-visible:outline-offset-2"
              header={
                <>
                  <p className="truncate text-sm font-medium">{name}</p>
                  <p className="truncate text-xs text-muted">{me?.user.email}</p>
                </>
              }
              items={[
                { label: "Settings", icon: <Settings className="size-4" />, onSelect: () => nav("/app/settings") },
                { label: "Help & support", icon: <LifeBuoy className="size-4" />, onSelect: () => nav("/app/support") },
                { label: "Sign out", icon: <LogOut className="size-4" />, onSelect: () => void logout() },
              ]}
            />
          </div>
        </header>

        {/* Mobile drawer */}
        {open && (
          <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setOpen(false)}>
            <div role="dialog" aria-modal="true" aria-label="Navigation" className="fade-in flex h-full w-72 flex-col gap-6 overflow-y-auto bg-side p-3" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-2 pt-2">
                <Logo onDark />
                <button aria-label="Close menu" onClick={() => setOpen(false)} className="rounded-xl p-2 text-side-muted hover:bg-side-2 hover:text-side-ink">
                  <X className="size-5" />
                </button>
              </div>
              <form role="search" onSubmit={submitSearch} className="relative px-1 md:hidden">
                <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-side-muted" aria-hidden />
                <input
                  type="search"
                  aria-label="Search tasks"
                  placeholder="Search tasks…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-10 w-full rounded-xl border border-side-line bg-side-2 pl-9 pr-3 text-sm text-side-ink placeholder:text-side-muted focus:outline-none focus:ring-2 focus:ring-accent/40"
                />
              </form>
              <NavItems onNavigate={() => setOpen(false)} unseen={count} />
              {sidebarFooter(false)}
            </div>
          </div>
        )}

        <main className="w-full flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8 2xl:px-12">
          {/* A crash in one page keeps the navigation usable; navigating away clears it. */}
          <ErrorBoundary resetKey={pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
      {quickAdd && <TaskFormModal open onClose={() => setQuickAdd(false)} />}
    </div>
  );
}
