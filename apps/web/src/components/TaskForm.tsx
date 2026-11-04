import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { Priority, TaskDTO } from "@lifepilot/shared";
import { api, errorMessage } from "../api";
import { isoToZoned, localISODate, zonedToISO } from "../lib/format";
import { useTz } from "../session";
import { useToast } from "./toast";
import { Button, ErrorNote, Field, Input, Modal, Select, Textarea } from "./ui";

export function TaskFormModal({ open, onClose, task }: { open: boolean; onClose: () => void; task?: TaskDTO | null }) {
  const tz = useTz();
  const qc = useQueryClient();
  const toast = useToast();
  const due = task?.dueAt ? isoToZoned(task.dueAt, tz) : null;
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [priority, setPriority] = useState<Priority>(task?.priority ?? "medium");
  const [dueDate, setDueDate] = useState(due?.date ?? "");
  const [dueTime, setDueTime] = useState(due?.time ?? "17:00");
  const [estimate, setEstimate] = useState(task?.estimateMin ? String(task.estimateMin) : "");
  const [tags, setTags] = useState(task?.tags.join(", ") ?? "");
  const [recurrence, setRecurrence] = useState(task?.recurrence ?? "none");
  const [subtasks, setSubtasks] = useState("");

  const m = useMutation({
    mutationFn: async () => {
      const body = {
        title: title.trim(),
        description: description.trim() || null,
        priority,
        dueAt: dueDate ? zonedToISO(dueDate, dueTime || "23:59", tz) : null,
        estimateMin: estimate ? Number(estimate) : null,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        recurrence,
        ...(task ? {} : { subtasks: subtasks.split("\n").map((s) => s.trim()).filter(Boolean) }),
      };
      return task ? api.patch<TaskDTO>(`/tasks/${task.id}`, body) : api.post<TaskDTO>("/tasks", body);
    },
    onSuccess: () => {
      qc.invalidateQueries();
      toast({ title: task ? "Task updated" : "Task added", tone: "success" });
      onClose();
    },
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={task ? "Edit task" : "New task"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={m.isPending} disabled={!title.trim()} onClick={() => m.mutate()}>
            {task ? "Save" : "Add task"}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) m.mutate();
        }}
      >
        {m.error && <ErrorNote error={new Error(errorMessage(m.error))} />}
        <Field label="Title" htmlFor="t-title">
          <Input id="t-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs doing?" />
        </Field>
        <Field label="Notes" htmlFor="t-desc">
          <Textarea id="t-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Priority" htmlFor="t-pri">
            <Select id="t-pri" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </Select>
          </Field>
          <Field label="Estimate (minutes)" htmlFor="t-est" hint="Helps the planner fit it in.">
            <Input id="t-est" type="number" min={5} max={1440} step={5} value={estimate} onChange={(e) => setEstimate(e.target.value)} />
          </Field>
          <Field label="Due date" htmlFor="t-dd">
            <Input id="t-dd" type="date" value={dueDate} min={task ? undefined : localISODate(new Date(), tz)} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
          <Field label="Due time" htmlFor="t-dt">
            <Input id="t-dt" type="time" value={dueTime} disabled={!dueDate} onChange={(e) => setDueTime(e.target.value)} />
          </Field>
          <Field label="Tags" htmlFor="t-tags" hint="Comma separated">
            <Input id="t-tags" value={tags} onChange={(e) => setTags(e.target.value)} />
          </Field>
          <Field label="Repeats" htmlFor="t-rec">
            <Select id="t-rec" value={recurrence} onChange={(e) => setRecurrence(e.target.value as TaskDTO["recurrence"])} disabled={!dueDate}>
              <option value="none">Never</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </Select>
          </Field>
        </div>
        {!task && (
          <Field label="Subtasks" htmlFor="t-sub" hint="One per line">
            <Textarea id="t-sub" value={subtasks} onChange={(e) => setSubtasks(e.target.value)} />
          </Field>
        )}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
