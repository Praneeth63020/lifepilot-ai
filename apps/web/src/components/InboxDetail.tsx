import clsx from "clsx";
import {
  ArrowLeft,
  ArrowRight,
  ArrowRightCircle,
  CalendarClock,
  CheckCheck,
  CheckCircle2,
  ExternalLink,
  HelpCircle,
  ListPlus,
  Mail,
  Quote,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  Timer,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { InsightDTO } from "@lifepilot/shared";
import { fmtDateTime, minutesLabel, relative } from "../lib/format";
import { CATEGORY_LABEL, CERTAINTY, STATUS_LABEL, categoryTone, extractorName, importanceOf, senderInitials, type Category } from "./InboxMeta";
import { Badge, Button, ProgressBar, Select, buttonClass, cardClass } from "./ui";

function Section({ icon, label, children, className }: { icon: ReactNode; label: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-muted">
        <span aria-hidden className="[&>svg]:size-3.5">{icon}</span>
        {label}
      </h3>
      {children}
    </div>
  );
}

export function InboxDetail({
  insight: i,
  tz,
  busy,
  onCreateTask,
  onSetStatus,
  onSetCategory,
  onBack,
  className,
  id,
}: {
  insight: InsightDTO;
  tz: string;
  busy: boolean;
  onCreateTask: () => void;
  onSetStatus: (status: "reviewed" | "dismissed" | "new") => void;
  onSetCategory: (category: Category) => void;
  onBack: () => void;
  className?: string;
  id?: string;
}) {
  const importance = importanceOf(i);
  const overdue = i.deadlineAt ? new Date(i.deadlineAt).getTime() < Date.now() : false;
  const status = i.taskId ? STATUS_LABEL.task_created : STATUS_LABEL[i.status];
  const showAction = i.requiredAction && i.requiredAction !== i.summary;

  return (
    <section id={id} aria-label="Email details" className={clsx(cardClass, "@container min-w-0 overflow-hidden", className)}>
      {/* Phones and tablets: details replace the list, so offer a way back. */}
      <div className="border-b border-line px-3 py-2 lg:hidden">
        <Button size="sm" variant="ghost" onClick={onBack}>
          <ArrowLeft className="size-4" aria-hidden /> Back to list
        </Button>
      </div>

      <header className="border-b border-line p-4 sm:p-6">
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <Badge tone={categoryTone(i.category)}>{CATEGORY_LABEL[i.category]}</Badge>
          <Badge tone={status.tone}>{status.text}</Badge>
          {importance === "high" && <Badge tone="danger">High importance</Badge>}
          {i.email.source === "demo" && <Badge tone="warn">Demo email</Badge>}
        </div>
        <h2 className="break-words font-display text-xl font-semibold leading-snug tracking-tight sm:text-2xl">{i.email.subject || "(no subject)"}</h2>
        <div className="mt-4 flex items-start gap-3">
          <span
            aria-hidden
            className={clsx("grid size-10 shrink-0 place-items-center rounded-full text-sm font-semibold", i.suspicious ? "bg-danger/10 text-danger" : "bg-surface-2 text-ink")}
          >
            {senderInitials(i)}
          </span>
          <div className="min-w-0 flex-1 @lg:flex @lg:items-start @lg:justify-between @lg:gap-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold">{i.email.fromName || i.email.fromAddress}</p>
              {/* Always show the real address: look-alike domains are how phishing is spotted. */}
              <p className="break-all font-mono text-xs text-muted" title="Sender address">
                &lt;{i.email.fromAddress}&gt;
              </p>
            </div>
            <p className="mt-1.5 shrink-0 text-xs text-muted @lg:mt-0 @lg:text-right">
              <time dateTime={i.email.receivedAt} className="font-medium text-ink @lg:block">{fmtDateTime(i.email.receivedAt, tz)}</time>
              <span className="@lg:hidden"> · </span>
              {relative(i.email.receivedAt)}
            </p>
          </div>
        </div>
      </header>

      {i.suspicious && (
        <div role="note" className="flex gap-3 border-b border-danger/30 bg-danger/10 px-4 py-3 text-danger sm:px-6">
          <ShieldAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
          <div className="text-sm">
            <p className="font-semibold">This email contains instructions aimed at an AI assistant. LifePilot ignored them and took no action. Treat it as possible phishing.</p>
            <p className="mt-1">Check the sender address above carefully, and don't click links or share details unless you're sure it's genuine.</p>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface-2/50 px-4 py-3 sm:px-6">
        {i.taskId ? (
          <Link to="/app/tasks" className="inline-flex items-center gap-1.5 rounded-xl bg-ok/15 px-3 py-1.5 text-sm font-medium text-ok hover:bg-ok/20">
            <CheckCircle2 className="size-4" aria-hidden /> Task created <span className="text-xs font-normal">· view in Tasks</span>
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        ) : (
          <Button size="sm" variant="primary" disabled={i.status === "dismissed"} title={i.status === "dismissed" ? "Restore this email to create a task from it" : undefined} onClick={onCreateTask}>
            <ListPlus className="size-4" aria-hidden /> Create task
          </Button>
        )}
        {i.status === "new" && (
          <Button size="sm" disabled={busy} onClick={() => onSetStatus("reviewed")}>
            <CheckCheck className="size-4" aria-hidden /> Mark reviewed
          </Button>
        )}
        {i.status !== "dismissed" && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onSetStatus("dismissed")}>
            <X className="size-4" aria-hidden /> Dismiss
          </Button>
        )}
        {(i.status === "reviewed" || i.status === "dismissed") && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onSetStatus("new")} title="Move back to Needs review">
            <RotateCcw className="size-4" aria-hidden /> Restore
          </Button>
        )}
        {i.email.webLink && (
          <a href={i.email.webLink} target="_blank" rel="noreferrer noopener" className={buttonClass({ variant: "ghost", size: "sm", className: "@xl:ml-auto" })}>
            Open original <ExternalLink className="size-3.5" aria-hidden />
          </a>
        )}
      </div>

      <div className="flex flex-col gap-6 p-4 sm:p-6">
        <Section icon={<Sparkles />} label="AI summary">
          <p className="text-[15px] leading-relaxed">{i.summary}</p>
        </Section>

        <div className={clsx("grid gap-4", showAction && "@xl:grid-cols-2")}>
          <Section icon={<HelpCircle />} label="Why it matters">
            <p className="text-sm leading-relaxed">{i.whyItMatters}</p>
          </Section>
          {showAction && (
            <Section icon={<ArrowRightCircle />} label="To do">
              <p className="text-sm leading-relaxed">{i.requiredAction}</p>
            </Section>
          )}
        </div>

        <Section icon={<CalendarClock />} label="Deadline">
          {i.deadlineCertainty === "none" ? (
            <p className="text-sm text-muted">No deadline found in this email.</p>
          ) : (
            <div className={clsx("rounded-xl border p-4", i.deadlineCertainty === "ambiguous" ? "border-warn/30 bg-warn/10" : "border-line bg-surface-2")}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <p className="text-base font-semibold">{i.deadlineAt ? `Due ${fmtDateTime(i.deadlineAt, tz)}` : "Deadline not clear"}</p>
                {i.deadlineAt && <span className={clsx("text-sm", overdue ? "font-medium text-danger" : "text-muted")}>{overdue ? `passed ${relative(i.deadlineAt)}` : relative(i.deadlineAt)}</span>}
              </div>
              <div className="mt-2">
                <Badge tone={CERTAINTY[i.deadlineCertainty].tone} title={CERTAINTY[i.deadlineCertainty].hint}>{CERTAINTY[i.deadlineCertainty].label}</Badge>
              </div>
              {i.deadlineText && (
                <blockquote className="mt-3 flex gap-2 border-l-2 border-line pl-3 text-sm text-muted">
                  <Quote className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  <span>“{i.deadlineText}”</span>
                </blockquote>
              )}
            </div>
          )}
          {i.clarificationQuestion && (
            <p className="mt-3 flex gap-2 rounded-xl bg-warn/10 px-3 py-2.5 text-sm text-warn">
              <HelpCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                <span className="font-semibold">Question for you: </span>
                {i.clarificationQuestion}
              </span>
            </p>
          )}
        </Section>

        {!i.taskId && i.status !== "dismissed" && (i.proposedTaskTitle || i.proposedEstimateMin) && (
          <Section icon={<ListPlus />} label="Suggested task">
            <div className="rounded-xl border border-dashed border-line p-4">
              <p className="text-sm font-semibold">{i.proposedTaskTitle ?? i.email.subject}</p>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                <span className="inline-flex items-center gap-1">
                  <Timer className="size-3.5" aria-hidden />
                  {i.proposedEstimateMin ? `About ${minutesLabel(i.proposedEstimateMin)} (from the email)` : "No time estimate in the email"}
                </span>
                {i.deadlineAt && (
                  <span className="inline-flex items-center gap-1">
                    <CalendarClock className="size-3.5" aria-hidden /> {fmtDateTime(i.deadlineAt, tz)}
                  </span>
                )}
              </p>
              <p className="mt-2 text-xs text-muted">Nothing is added until you choose Create task — you can edit everything first.</p>
            </div>
          </Section>
        )}

        {i.email.snippet && (
          <Section icon={<Mail />} label="From the email">
            <p className="whitespace-pre-line break-words rounded-xl bg-surface-2 px-4 py-3 text-sm leading-relaxed text-muted">{i.email.snippet}</p>
          </Section>
        )}

        <div className="grid gap-4 border-t border-line pt-5 @xl:grid-cols-2">
          <div>
            <label htmlFor="inbox-category" className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.08em] text-muted">
              Category
            </label>
            <Select id="inbox-category" aria-label="Correct category" title="Wrong category? Correct it here." className="h-9" value={i.category} disabled={busy} onChange={(e) => onSetCategory(e.target.value as Category)}>
              {(Object.keys(CATEGORY_LABEL) as Category[]).map((c) => (
                <option key={c} value={c}>
                  {c === i.aiCategory ? `${CATEGORY_LABEL[c]} (AI)` : CATEGORY_LABEL[c]}
                </option>
              ))}
            </Select>
            <p className="mt-1 text-xs text-muted">{i.category !== i.aiCategory ? `You corrected this from ${CATEGORY_LABEL[i.aiCategory]}.` : "Wrong? Correct it — your choice is kept."}</p>
          </div>
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-muted">Analysis</p>
            <div className="flex items-center gap-3">
              <ProgressBar value={i.confidence * 100} label="Classifier confidence" tone="ink" className="flex-1" />
              <span className="text-sm font-medium tabular-nums">{Math.round(i.confidence * 100)}% sure</span>
            </div>
            <p className="mt-1.5 text-xs text-muted">
              Analysed by {extractorName(i.extractor)} · importance {i.importanceScore}/100
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
