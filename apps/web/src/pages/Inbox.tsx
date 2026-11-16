import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import {
  Archive,
  ArrowDownCircle,
  Briefcase,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  Inbox as InboxIcon,
  Info,
  ListChecks,
  MailCheck,
  MailX,
  Mails,
  Plane,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import type { ConnectionDTO, InsightDTO } from "@lifepilot/shared";
import { api, errorMessage } from "../api";
import { InboxApproveModal } from "../components/InboxApproveModal";
import { InboxDetail } from "../components/InboxDetail";
import { CATEGORY_LABEL, importanceOf, senderInitials, type Category } from "../components/InboxMeta";
import { useToast } from "../components/toast";
import { Button, Empty, ErrorNote, Input, PageHeader, Select, Spinner, buttonClass, cardClass } from "../components/ui";
import { fmtDate, relative } from "../lib/format";
import { useSession, useTz } from "../session";
import { SyncStatus } from "./Dashboard";

export { CATEGORY_LABEL };

type StatusView = "open" | "reviewed" | "dismissed" | "all";
type View = "all" | "needs_action" | Exclude<Category, "urgent" | "requires_action">;

/** Left-rail views. "Needs action" groups the two action categories; the rest map 1:1 to a category. */
const VIEWS: { id: View; label: string; icon: LucideIcon; match: (i: InsightDTO) => boolean }[] = [
  { id: "all", label: "All", icon: Mails, match: () => true },
  { id: "needs_action", label: "Needs action", icon: CircleAlert, match: (i) => i.category === "urgent" || i.category === "requires_action" },
  { id: "deadline", label: "Deadlines", icon: CalendarClock, match: (i) => i.category === "deadline" },
  { id: "meeting", label: "Meetings & invites", icon: CalendarDays, match: (i) => i.category === "meeting" },
  { id: "work_education", label: "Work & education", icon: Briefcase, match: (i) => i.category === "work_education" },
  { id: "financial", label: "Financial", icon: Wallet, match: (i) => i.category === "financial" },
  { id: "travel", label: "Travel & bookings", icon: Plane, match: (i) => i.category === "travel" },
  { id: "informational", label: "Informational", icon: Info, match: (i) => i.category === "informational" },
  { id: "low_priority", label: "Low priority", icon: ArrowDownCircle, match: (i) => i.category === "low_priority" },
];

const STATUS_VIEWS: { id: StatusView; label: string; icon: LucideIcon }[] = [
  { id: "open", label: "Needs review", icon: InboxIcon },
  { id: "reviewed", label: "Reviewed", icon: MailCheck },
  { id: "dismissed", label: "Dismissed", icon: MailX },
  { id: "all", label: "All statuses", icon: Archive },
];

const statusMatch = (s: StatusView, i: InsightDTO) =>
  s === "all" || (s === "open" ? i.status === "new" || i.status === "task_created" : i.status === s);

/** Responsive filter button: a chip on small screens, a full-width row in the desktop rail. */
function FilterButton({ active, label, count, icon: Icon, onClick, dim }: { active: boolean; label: string; count?: number; icon: LucideIcon; onClick: () => void; dim?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={clsx(
        dim && !active ? "hidden xl:inline-flex xl:opacity-60" : "inline-flex",
        "shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm transition-colors xl:w-full xl:rounded-xl xl:border-transparent xl:px-2.5 xl:py-2",
        active ? "border-accent bg-accent-soft font-medium text-ink xl:border-transparent" : "border-line text-muted hover:bg-surface-2 hover:text-ink",
      )}
    >
      <Icon className={clsx("hidden size-4 shrink-0 xl:block", active ? "text-accent-strong" : "")} aria-hidden />
      <span className="xl:flex-1 xl:text-left">{label}</span>
      {count !== undefined && (
        <span className={clsx("rounded-full px-1.5 text-xs tabular-nums", active ? "bg-accent text-accent-ink" : "bg-surface-2 text-muted")}>{count}</span>
      )}
    </button>
  );
}

export function InboxPage() {
  const tz = useTz();
  const { config } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState<StatusView>("open");
  const [view, setView] = useState<View>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"importance" | "newest">("importance");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [approving, setApproving] = useState<InsightDTO | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const q = useQuery({ queryKey: ["insights", status], queryFn: () => api.get<{ items: InsightDTO[] }>("/insights", { status, limit: 200 }) });
  // Counts for the status views come from one unfiltered read.
  const everything = useQuery({ queryKey: ["insights", "all"], queryFn: () => api.get<{ items: InsightDTO[] }>("/insights", { status: "all", limit: 200 }) });
  const conns = useQuery({ queryKey: ["integrations"], queryFn: () => api.get<{ items: ConnectionDTO[] }>("/integrations") });
  const gmail = conns.data?.items.find((c) => c.product === "gmail");

  const patch = useMutation({
    mutationFn: (v: { id: string; body: Record<string, unknown> }) => api.patch(`/insights/${v.id}`, v.body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["insights"] }),
    onError: (e) => toast({ title: "Couldn't update", body: errorMessage(e), tone: "error" }),
  });
  const sync = useMutation({
    mutationFn: () => api.post("/integrations/gmail/sync"),
    onSuccess: () => {
      toast({ title: "Sync queued", body: "New emails will appear shortly.", tone: "info" });
      setTimeout(() => qc.invalidateQueries(), 3000);
    },
    onError: (e) => toast({ title: "Couldn't sync", body: errorMessage(e), tone: "error" }),
  });
  const demo = useMutation({
    mutationFn: () => api.post<{ loaded: { emails: number; events: number } }>("/integrations/demo"),
    onSuccess: (r) => {
      qc.invalidateQueries();
      toast({ title: "Demo data loaded", body: `${r.loaded.emails} new emails, ${r.loaded.events} new events (synthetic).`, tone: "success" });
    },
    onError: (e) => toast({ title: "Couldn't load demo data", body: errorMessage(e), tone: "error" }),
  });

  const all = q.data?.items ?? [];
  const viewCounts = useMemo(() => Object.fromEntries(VIEWS.map((v) => [v.id, all.filter(v.match).length])) as Record<View, number>, [all]);
  const statusCounts = useMemo(() => {
    const items = everything.data?.items ?? [];
    return Object.fromEntries(STATUS_VIEWS.map((s) => [s.id, items.filter((i) => statusMatch(s.id, i)).length])) as Record<StatusView, number>;
  }, [everything.data]);

  const visible = useMemo(() => {
    const match = VIEWS.find((v) => v.id === view)!.match;
    const needle = search.trim().toLowerCase();
    const list = all.filter(
      (i) =>
        match(i) &&
        (!needle || [i.email.subject, i.email.fromName ?? "", i.email.fromAddress, i.summary].some((s) => s.toLowerCase().includes(needle))),
    );
    return sort === "newest" ? [...list].sort((a, b) => b.email.receivedAt.localeCompare(a.email.receivedAt)) : list;
  }, [all, view, search, sort]);

  const selected = visible.find((i) => i.id === selectedId) ?? visible[0] ?? null;

  const select = (i: InsightDTO, openDetail: boolean) => {
    setSelectedId(i.id);
    if (openDetail) {
      setShowDetail(true);
      // On phones the details replace the list; start at the top of them.
      if (window.matchMedia("(max-width: 1023px)").matches) window.scrollTo({ top: 0 });
    }
  };

  const onListKey = (e: KeyboardEvent<HTMLUListElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key) || !visible.length) return;
    e.preventDefault();
    // Move from the focused row (it can differ from the selected one after a mouse click elsewhere).
    const focusedId = (document.activeElement as HTMLElement | null)?.dataset.insight ?? selected?.id;
    const idx = visible.findIndex((i) => i.id === focusedId);
    const next =
      e.key === "Home" ? 0 : e.key === "End" ? visible.length - 1 : e.key === "ArrowDown" ? Math.min(visible.length - 1, idx + 1) : Math.max(0, idx - 1);
    const target = visible[next]!;
    setSelectedId(target.id);
    listRef.current?.querySelector<HTMLButtonElement>(`[data-insight="${target.id}"]`)?.focus();
  };

  const setInsightStatus = (i: InsightDTO, next: "reviewed" | "dismissed" | "new") => {
    // When the email leaves the current view, move on to its neighbour instead of jumping to the top.
    const idx = visible.findIndex((v) => v.id === i.id);
    const neighbour = visible[idx + 1] ?? visible[idx - 1];
    patch.mutate(
      { id: i.id, body: { status: next } },
      {
        onSuccess: () => {
          const stays = statusMatch(status, { ...i, status: next });
          if (!stays && neighbour) setSelectedId(neighbour.id);
          if (next === "dismissed") toast({ title: "Dismissed", body: "Find it under Dismissed if you need it again.", tone: "info" });
        },
      },
    );
  };

  const noEmailConnected = !gmail || gmail.status === "not_connected" || gmail.status === "disconnected" || gmail.status === "revoked";
  const nothingAtAll = everything.data && everything.data.items.length === 0;
  const activeView = VIEWS.find((v) => v.id === view)!;

  return (
    <div>
      <PageHeader
        title="Smart inbox"
        subtitle="LifePilot never sends, deletes, forwards or replies to email. Classifications are suggestions — correct them any time."
      />

      {(q.isLoading || everything.isLoading) && <Spinner label="Loading emails" />}
      {q.error && <ErrorNote error={q.error} onRetry={() => q.refetch()} />}

      {nothingAtAll && noEmailConnected ? (
        <NoEmailState demoMode={Boolean(config?.demoMode)} loading={demo.isPending} onLoadDemo={() => demo.mutate()} />
      ) : (
        q.data && (
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(280px,320px)_minmax(0,1fr)] xl:grid-cols-[232px_minmax(320px,400px)_minmax(0,1fr)] xl:gap-5">
            {/* Filters: a top bar on tablets / small laptops, a left rail on wide screens. */}
            <aside aria-label="Inbox filters" className={clsx("min-w-0 flex-col gap-3 lg:col-span-2 xl:sticky xl:top-20 xl:col-span-1 xl:max-h-[calc(100vh-6rem)] xl:gap-5 xl:overflow-y-auto", showDetail ? "hidden lg:flex" : "flex")}>
              <div className={clsx(cardClass, "flex flex-wrap items-center justify-between gap-3 p-3 xl:flex-col xl:items-stretch xl:p-4")}>
                <div className="min-w-0">
                  <p className="mb-1.5 hidden text-xs font-semibold uppercase tracking-[0.08em] text-muted xl:block">Email sync</p>
                  {conns.data && <SyncStatus connections={conns.data.items.filter((c) => c.product === "gmail")} />}
                </div>
                {gmail?.status === "active" ? (
                  <Button size="sm" onClick={() => sync.mutate()} loading={sync.isPending}>
                    <RefreshCw className="size-4" aria-hidden /> Sync now
                  </Button>
                ) : (
                  <Link to="/app/settings" className={buttonClass({ size: "sm" })}>
                    Connect Gmail
                  </Link>
                )}
              </div>

              <div className="min-w-0 xl:px-1">
                <p className="mb-1.5 hidden px-2.5 text-xs font-semibold uppercase tracking-[0.08em] text-muted xl:block">Status</p>
                <div role="group" aria-label="Status filter" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 xl:mx-0 xl:flex-col xl:gap-0.5 xl:overflow-visible xl:px-0 xl:pb-0">
                  {STATUS_VIEWS.map((s) => (
                    <FilterButton key={s.id} active={status === s.id} label={s.label} icon={s.icon} count={everything.data ? statusCounts[s.id] : undefined} onClick={() => setStatus(s.id)} />
                  ))}
                </div>
              </div>

              <div className="min-w-0 xl:px-1">
                <p className="mb-1.5 hidden px-2.5 text-xs font-semibold uppercase tracking-[0.08em] text-muted xl:block">Categories</p>
                <div role="group" aria-label="Category filter" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 xl:mx-0 xl:flex-col xl:gap-0.5 xl:overflow-visible xl:px-0 xl:pb-0">
                  {VIEWS.map((v) => (
                    <FilterButton key={v.id} active={view === v.id} label={v.label} icon={v.icon} count={viewCounts[v.id]} dim={v.id !== "all" && viewCounts[v.id] === 0} onClick={() => setView(v.id)} />
                  ))}
                </div>
              </div>
            </aside>

            {/* Email list */}
            <section
              aria-label="Emails"
              className={clsx(cardClass, "min-w-0 overflow-hidden lg:sticky lg:top-20 lg:flex lg:max-h-[calc(100vh-6rem)] lg:flex-col", showDetail && "hidden lg:flex")}
            >
              <div className="flex flex-col gap-2 border-b border-line p-3">
                <div className="flex items-center justify-between gap-2 px-1">
                  <h2 className="text-[15px] font-semibold">
                    {activeView.label} <span className="font-normal text-muted">· {visible.length}</span>
                  </h2>
                  <Select aria-label="Sort emails" className="h-8 w-auto text-xs" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
                    <option value="importance">Most important</option>
                    <option value="newest">Newest</option>
                  </Select>
                </div>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
                  <Input type="search" aria-label="Search emails" placeholder="Search sender, subject or summary" className="h-9 pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
              </div>
              {visible.length === 0 ? (
                <Empty icon={<InboxIcon />} title={search ? "No matching emails" : all.length ? "Nothing in this view" : "Nothing to review"}>
                  {search
                    ? "Try a different search."
                    : all.length
                      ? "Pick another category on the left."
                      : gmail?.status === "active" && !gmail.lastSyncAt
                        ? "The first sync is still running — new emails will appear here shortly."
                        : status === "open"
                          ? "You're all caught up. Reviewed and dismissed emails are under their own views."
                          : "No emails with this status."}
                </Empty>
              ) : (
                <ul ref={listRef} aria-label="Email list" onKeyDown={onListKey} className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
                  {visible.map((i) => (
                    <li key={i.id}>
                      <InboxListItem insight={i} tz={tz} selected={selected?.id === i.id} onSelect={() => select(i, true)} />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Details */}
            {selected ? (
              <InboxDetail
                id="inbox-detail"
                insight={selected}
                tz={tz}
                busy={patch.isPending}
                className={clsx("lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto", !showDetail && "hidden lg:block")}
                onBack={() => setShowDetail(false)}
                onCreateTask={() => setApproving(selected)}
                onSetStatus={(s) => setInsightStatus(selected, s)}
                onSetCategory={(c) => patch.mutate({ id: selected.id, body: { userCategory: c === selected.aiCategory ? null : c } })}
              />
            ) : (
              <section aria-label="Email details" className={clsx(cardClass, "hidden lg:block")}>
                <Empty icon={<Sparkles />} title="No email selected">
                  Pick an email to see LifePilot's summary, the deadline it found and the task it suggests.
                </Empty>
              </section>
            )}
          </div>
        )
      )}

      {approving && <InboxApproveModal insight={approving} tz={tz} onClose={() => setApproving(null)} />}
    </div>
  );
}

function InboxListItem({ insight: i, tz, selected, onSelect }: { insight: InsightDTO; tz: string; selected: boolean; onSelect: () => void }) {
  const importance = importanceOf(i);
  const unread = i.status === "new" && !i.taskId;
  const overdue = i.deadlineAt ? new Date(i.deadlineAt).getTime() < Date.now() : false;
  return (
    <button
      type="button"
      data-insight={i.id}
      aria-current={selected ? "true" : undefined}
      aria-controls="inbox-detail"
      tabIndex={selected ? 0 : -1}
      onClick={onSelect}
      className={clsx(
        "relative flex w-full gap-3 px-4 py-3 text-left transition-colors focus-visible:outline-offset-[-2px]",
        selected ? "bg-accent-soft/70" : "hover:bg-surface-2/70",
        i.status === "dismissed" && "opacity-70",
      )}
    >
      {/* Importance stripe */}
      <span
        aria-hidden
        className={clsx("absolute inset-y-2 left-0 w-1 rounded-r-full", importance === "high" ? "bg-danger" : importance === "medium" ? "bg-accent" : "bg-transparent", selected && importance === "low" && "bg-line")}
      />
      <span aria-hidden className={clsx("mt-0.5 grid size-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold", i.suspicious ? "bg-danger/10 text-danger" : "bg-surface-2 text-ink")}>
        {senderInitials(i)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className={clsx("truncate text-sm", unread ? "font-semibold text-ink" : "text-muted")}>{i.email.fromName || i.email.fromAddress}</span>
          <time dateTime={i.email.receivedAt} className="shrink-0 text-xs text-muted">{relative(i.email.receivedAt)}</time>
        </span>
        <span className={clsx("mt-0.5 block text-sm leading-snug", unread ? "font-semibold" : "font-medium")}>
          {unread && <span aria-hidden className="mr-1.5 inline-block size-2 rounded-full bg-accent align-middle" />}
          {i.email.subject || "(no subject)"}
        </span>
        <span className="mt-0.5 line-clamp-1 text-xs text-muted">{i.summary}</span>
        <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
          {importance === "high" && <span className="sr-only">High importance.</span>}
          {i.suspicious && (
            <span className="inline-flex items-center gap-1 rounded-full bg-danger/10 px-1.5 py-0.5 font-medium text-danger">
              <ShieldAlert className="size-3" aria-hidden /> Suspicious
            </span>
          )}
          {i.deadlineAt ? (
            <span
              className={clsx(
                "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-medium",
                overdue ? "bg-danger/10 text-danger" : i.deadlineCertainty === "ambiguous" ? "bg-warn/15 text-warn" : i.deadlineCertainty === "inferred" ? "bg-accent-soft text-accent-strong" : "bg-surface-2 text-ink",
              )}
            >
              <CalendarClock className="size-3" aria-hidden /> Due {fmtDate(i.deadlineAt, tz)}
            </span>
          ) : (
            i.deadlineCertainty === "ambiguous" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-warn/15 px-1.5 py-0.5 font-medium text-warn">
                <CalendarClock className="size-3" aria-hidden /> Deadline unclear
              </span>
            )
          )}
          {i.taskId && (
            <span className="inline-flex items-center gap-1 font-medium text-ok">
              <CheckCircle2 className="size-3.5" aria-hidden /> Task added
            </span>
          )}
          <span className="text-muted">{CATEGORY_LABEL[i.category]}</span>
        </span>
      </span>
    </button>
  );
}

function NoEmailState({ demoMode, loading, onLoadDemo }: { demoMode: boolean; loading: boolean; onLoadDemo: () => void }) {
  const points: { icon: LucideIcon; title: string; body: string }[] = [
    { icon: ListChecks, title: "Finds what needs doing", body: "Each email is summarised, sorted into a category and checked for an action you need to take." },
    { icon: CalendarClock, title: "Catches deadlines", body: "Dates are pulled out with a note of how certain they are, so unclear ones get confirmed — never guessed." },
    { icon: Sparkles, title: "Suggests tasks, you decide", body: "Nothing becomes a task until you approve it. Estimates and due times feed the planner and reminders." },
    { icon: ShieldAlert, title: "Read-only and careful", body: "LifePilot never sends, deletes or replies. Emails that try to instruct an AI are flagged as possible phishing." },
  ];
  return (
    <div className={clsx(cardClass, "grid gap-8 p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:p-10")}>
      <div>
        <span className="grid size-12 place-items-center rounded-2xl bg-accent text-accent-ink" aria-hidden>
          <InboxIcon className="size-6" />
        </span>
        <h2 className="mt-4 font-display text-2xl font-semibold tracking-tight">No email connected</h2>
        <p className="mt-2 max-w-md text-sm text-muted">
          Connect Gmail and LifePilot turns your inbox into a short list of things to act on. Tasks and planning work without it.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          {demoMode && (
            <Button variant="primary" loading={loading} onClick={onLoadDemo}>
              Load demo data
            </Button>
          )}
          <Link to="/app/settings" className={buttonClass({ variant: demoMode ? "secondary" : "primary" })}>
            Connect Gmail in Settings
          </Link>
        </div>
        {demoMode && <p className="mt-3 text-xs text-muted">Demo data is synthetic and labelled as demo everywhere.</p>}
      </div>
      <ul className="grid gap-4 sm:grid-cols-2">
        {points.map(({ icon: Icon, title, body }) => (
          <li key={title} className="rounded-2xl bg-surface-2 p-4">
            <Icon className="size-5 text-accent-strong" aria-hidden />
            <p className="mt-2 text-sm font-semibold">{title}</p>
            <p className="mt-1 text-sm text-muted">{body}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
