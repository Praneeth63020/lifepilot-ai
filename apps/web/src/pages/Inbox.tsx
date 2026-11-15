import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { AlertTriangle, ArrowRightCircle, CalendarClock, CheckCheck, ExternalLink, ListPlus, RefreshCw, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { ConnectionDTO, InsightDTO, Priority } from "@lifepilot/shared";
import { api, errorMessage } from "../api";
import { useToast } from "../components/toast";
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, buttonClass } from "../components/ui";
import { fmtDateTime, isoToZoned, relative, zonedToISO } from "../lib/format";
import { useTz } from "../session";
import { SyncStatus } from "./Dashboard";

export const CATEGORY_LABEL: Record<InsightDTO["category"], string> = {
  urgent: "Urgent",
  requires_action: "Requires action",
  deadline: "Deadlines",
  meeting: "Meetings & invites",
  work_education: "Work & education",
  financial: "Financial",
  travel: "Travel & bookings",
  informational: "Informational",
  low_priority: "Low priority",
};

const CERTAINTY: Record<InsightDTO["deadlineCertainty"], { label: string; tone: "ok" | "accent" | "warn" | "neutral" }> = {
  explicit: { label: "Stated in the email", tone: "ok" },
  inferred: { label: "Worked out from the email's date — check it", tone: "accent" },
  ambiguous: { label: "Unclear — needs your confirmation", tone: "warn" },
  none: { label: "", tone: "neutral" },
};

export function InboxPage() {
  const tz = useTz();
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState<"open" | "reviewed" | "dismissed" | "all">("open");
  const [category, setCategory] = useState<InsightDTO["category"] | "">("");
  const [approving, setApproving] = useState<InsightDTO | null>(null);
  const q = useQuery({ queryKey: ["insights", status], queryFn: () => api.get<{ items: InsightDTO[] }>("/insights", { status }) });
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

  const items = (q.data?.items ?? []).filter((i) => !category || i.category === category);
  const counts = (q.data?.items ?? []).reduce<Record<string, number>>((m, i) => ((m[i.category] = (m[i.category] ?? 0) + 1), m), {});

  return (
    <div>
      <PageHeader
        title="Smart inbox"
        subtitle="LifePilot never sends, deletes, forwards or replies to email. Classifications are suggestions — correct them any time."
        actions={gmail?.status === "active" && <Button onClick={() => sync.mutate()} loading={sync.isPending}><RefreshCw className="size-4" /> Sync now</Button>}
      />
      {conns.data && <div className="mb-4"><SyncStatus connections={conns.data.items.filter((c) => c.product === "gmail")} /></div>}

      <div className="mb-4 flex flex-wrap gap-2">
        <Select aria-label="Status" className="w-auto" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="open">Needs review</option>
          <option value="reviewed">Reviewed</option>
          <option value="dismissed">Dismissed</option>
          <option value="all">All</option>
        </Select>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Category filter">
          <button onClick={() => setCategory("")} className={clsx("rounded-full border px-3 py-1 text-xs", !category ? "border-accent bg-accent-soft text-accent" : "border-line text-muted")}>All</button>
          {(Object.keys(CATEGORY_LABEL) as InsightDTO["category"][]).filter((c) => counts[c]).map((c) => (
            <button key={c} onClick={() => setCategory(c)} className={clsx("rounded-full border px-3 py-1 text-xs", category === c ? "border-accent bg-accent-soft text-accent" : "border-line text-muted")}>
              {CATEGORY_LABEL[c]} · {counts[c]}
            </button>
          ))}
        </div>
      </div>

      {q.isLoading && <Spinner label="Loading emails" />}
      {q.error && <ErrorNote error={q.error} onRetry={() => q.refetch()} />}
      {q.data && items.length === 0 && (
        <Card>
          {gmail?.status === "not_connected" || !gmail ? (
            <Empty title="No email connected" action={<Link to="/app/settings" className={buttonClass()}>Connect Gmail or load demo data</Link>}>Tasks and planning work without it.</Empty>
          ) : (
            <Empty title="Nothing to review" />
          )}
        </Card>
      )}

      <ul className="flex flex-col gap-3">
        {items.map((i) => (
          <li key={i.id}>
            <Card className={clsx(i.suspicious && "border-danger/50", i.status === "dismissed" && "opacity-70")}>
              {i.suspicious && (
                <p className="mb-3 flex gap-2 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  This email contains instructions aimed at an AI assistant. LifePilot ignored them and took no action. Treat it as possible phishing.
                </p>
              )}
              {/* Phones: badges sit under the subject so it gets the full width. */}
              <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold leading-snug">{i.email.subject || "(no subject)"}</h3>
                  {/* Always show the real address: look-alike domains are how phishing is spotted. */}
                  <p className="mt-0.5 break-words text-xs text-muted">
                    {i.email.fromName ? `${i.email.fromName} <${i.email.fromAddress}>` : i.email.fromAddress} · {relative(i.email.receivedAt)}
                    {i.email.source === "demo" && " · demo email"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Badge tone={i.category === "urgent" ? "danger" : i.category === "low_priority" ? "neutral" : "accent"}>{CATEGORY_LABEL[i.category]}</Badge>
                  <Badge title={`How confident the classifier is. Analysed by ${i.extractor === "mock" ? "the built-in rule engine" : i.extractor}.`}>{Math.round(i.confidence * 100)}% sure</Badge>
                </div>
              </div>

              <p className="mt-3 text-sm">{i.summary}</p>
              {i.requiredAction && i.requiredAction !== i.summary && (
                <p className="mt-1.5 flex gap-1.5 text-sm"><ArrowRightCircle className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden /><span><span className="font-medium">To do:</span> {i.requiredAction}</span></p>
              )}
              {i.deadlineCertainty !== "none" && (
                <div className={clsx("mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-3 py-2 text-sm", i.deadlineCertainty === "ambiguous" ? "bg-warn/10" : "bg-surface-2")}>
                  <CalendarClock className="size-4 shrink-0 text-muted" aria-hidden />
                  <span className="font-medium">{i.deadlineAt ? `Due ${fmtDateTime(i.deadlineAt, tz)}` : "Deadline not clear"}</span>
                  {i.deadlineText && <span className="text-xs text-muted">(“{i.deadlineText}”)</span>}
                  <Badge tone={CERTAINTY[i.deadlineCertainty].tone}>{CERTAINTY[i.deadlineCertainty].label}</Badge>
                </div>
              )}
              <p className="mt-2 text-xs text-muted"><span className="font-medium">Why it matters:</span> {i.whyItMatters}</p>

              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
                {i.taskId ? (
                  <Link to="/app/tasks"><Badge tone="ok"><CheckCheck className="size-3" /> Task created</Badge></Link>
                ) : (
                  <Button size="sm" variant="primary" disabled={i.status === "dismissed"} onClick={() => setApproving(i)}><ListPlus className="size-4" /> Create task</Button>
                )}
                {i.status === "new" && <Button size="sm" onClick={() => patch.mutate({ id: i.id, body: { status: "reviewed" } })}><CheckCheck className="size-4" /> Mark reviewed</Button>}
                {i.status !== "dismissed" && <Button size="sm" variant="ghost" onClick={() => patch.mutate({ id: i.id, body: { status: "dismissed" } })}><X className="size-4" /> Dismiss</Button>}
                <div className="ml-auto flex items-center gap-2">
                  <Select aria-label="Correct category" title="Wrong category? Correct it here." className="h-8 w-auto text-xs" value={i.category} onChange={(e) => patch.mutate({ id: i.id, body: { userCategory: e.target.value === i.aiCategory ? null : e.target.value } })}>
                    {(Object.keys(CATEGORY_LABEL) as InsightDTO["category"][]).map((c) => <option key={c} value={c}>{c === i.aiCategory ? `${CATEGORY_LABEL[c]} (AI)` : CATEGORY_LABEL[c]}</option>)}
                  </Select>
                  {i.email.webLink && (
                    <a href={i.email.webLink} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-xs text-accent">Open <ExternalLink className="size-3" /></a>
                  )}
                </div>
              </div>
            </Card>
          </li>
        ))}
      </ul>

      {approving && <ApproveModal insight={approving} tz={tz} onClose={() => setApproving(null)} />}
    </div>
  );
}

function ApproveModal({ insight, tz, onClose }: { insight: InsightDTO; tz: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const pre = insight.deadlineAt ? isoToZoned(insight.deadlineAt, tz) : null;
  const [title, setTitle] = useState(insight.proposedTaskTitle ?? insight.email.subject);
  const [date, setDate] = useState(pre?.date ?? "");
  const [time, setTime] = useState(pre?.time ?? "17:00");
  const [noDeadline, setNoDeadline] = useState(false);
  const [estimate, setEstimate] = useState(insight.proposedEstimateMin ? String(insight.proposedEstimateMin) : "");
  const [priority, setPriority] = useState<Priority>(insight.category === "urgent" ? "urgent" : insight.importanceScore >= 60 ? "high" : "medium");
  const needsDate = insight.deadlineCertainty === "ambiguous" && !noDeadline && !date;
  const m = useMutation({
    mutationFn: () =>
      api.post(`/insights/${insight.id}/task`, {
        title,
        dueAt: noDeadline ? null : date ? zonedToISO(date, time, tz) : null,
        estimateMin: estimate ? Number(estimate) : null,
        priority,
      }),
    onSuccess: () => {
      qc.invalidateQueries();
      toast({ title: "Task created from email", body: "Reminders were scheduled if it has a due time.", tone: "success" });
      onClose();
    },
  });
  return (
    <Modal open onClose={onClose} title="Create task from email" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={m.isPending} disabled={!title.trim() || needsDate} onClick={() => m.mutate()}>Create task</Button></>}>
      <div className="flex flex-col gap-3">
        {m.error && <ErrorNote error={new Error(errorMessage(m.error))} />}
        {insight.clarificationQuestion && <p className="rounded-lg bg-warn/10 p-2 text-sm text-warn">{insight.clarificationQuestion}</p>}
        <Field label="Title" htmlFor="a-t"><Input id="a-t" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Due date" htmlFor="a-d" hint={insight.deadlineCertainty === "explicit" ? "From the email" : insight.deadlineCertainty === "inferred" ? "Worked out — please check" : undefined}>
            <Input id="a-d" type="date" value={date} disabled={noDeadline} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Due time" htmlFor="a-tm"><Input id="a-tm" type="time" value={time} disabled={noDeadline || !date} onChange={(e) => setTime(e.target.value)} /></Field>
          <Field label="Estimate (minutes)" htmlFor="a-e" hint={insight.proposedEstimateMin ? "The email mentions this" : "Not stated in the email — your guess helps planning"}>
            <Input id="a-e" type="number" min={5} step={5} value={estimate} onChange={(e) => setEstimate(e.target.value)} />
          </Field>
          <Field label="Priority" htmlFor="a-p">
            <Select id="a-p" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
              <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option>
            </Select>
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={noDeadline} onChange={(e) => setNoDeadline(e.target.checked)} className="accent-[var(--lp-accent)]" /> No deadline
        </label>
      </div>
    </Modal>
  );
}
