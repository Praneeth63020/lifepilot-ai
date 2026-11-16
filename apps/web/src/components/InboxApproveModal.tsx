import { useMutation, useQueryClient } from "@tanstack/react-query";
import { HelpCircle } from "lucide-react";
import { useState } from "react";
import type { InsightDTO, Priority } from "@lifepilot/shared";
import { api, errorMessage } from "../api";
import { isoToZoned, zonedToISO } from "../lib/format";
import { useToast } from "./toast";
import { Button, ErrorNote, Field, Input, Modal, Select } from "./ui";

/** Turn an email insight into a task. Ambiguous deadlines need a date, or an explicit "No deadline". */
export function InboxApproveModal({ insight, tz, onClose }: { insight: InsightDTO; tz: string; onClose: () => void }) {
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
    <Modal
      open
      onClose={onClose}
      title="Create task from email"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={m.isPending} disabled={!title.trim() || needsDate} onClick={() => m.mutate()}>
            Create task
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {m.error && <ErrorNote error={new Error(errorMessage(m.error))} />}
        <p className="break-words rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
          From <span className="font-medium text-ink">{insight.email.subject || "(no subject)"}</span>
        </p>
        {insight.clarificationQuestion && (
          <p className="flex gap-2 rounded-lg bg-warn/10 p-2.5 text-sm text-warn">
            <HelpCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {insight.clarificationQuestion}
          </p>
        )}
        <Field label="Title" htmlFor="a-t">
          <Input id="a-t" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Due date" htmlFor="a-d" hint={insight.deadlineCertainty === "explicit" ? "From the email" : insight.deadlineCertainty === "inferred" ? "Worked out — please check" : needsDate ? "Pick a date, or tick “No deadline”" : undefined}>
            <Input id="a-d" type="date" value={date} disabled={noDeadline} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Due time" htmlFor="a-tm">
            <Input id="a-tm" type="time" value={time} disabled={noDeadline || !date} onChange={(e) => setTime(e.target.value)} />
          </Field>
          <Field label="Estimate (minutes)" htmlFor="a-e" hint={insight.proposedEstimateMin ? "The email mentions this" : "Not stated in the email — your guess helps planning"}>
            <Input id="a-e" type="number" min={5} step={5} value={estimate} onChange={(e) => setEstimate(e.target.value)} />
          </Field>
          <Field label="Priority" htmlFor="a-p">
            <Select id="a-p" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </Select>
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={noDeadline} onChange={(e) => setNoDeadline(e.target.checked)} className="size-4 accent-[var(--lp-accent)]" /> No deadline
        </label>
      </div>
    </Modal>
  );
}
