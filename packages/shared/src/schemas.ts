import { z } from "zod";
import { EMAIL_CATEGORIES } from "./extraction.js";
import { isValidTimezone } from "./time.js";

export const prioritySchema = z.enum(["low", "medium", "high", "urgent"]);
export const soundSchema = z.enum(["daily_chime", "priority_alert", "deadline_alert", "none"]);
export const emailCategorySchema = z.enum(EMAIL_CATEGORIES);
const minuteOfDay = z.number().int().min(0).max(24 * 60 - 1);
const isoDateTime = z.iso.datetime({ offset: true });
const isoDate = z.iso.date();

export const registerSchema = z.object({
  email: z.email().max(254).transform((s) => s.toLowerCase().trim()),
  password: z.string().min(10, "Use at least 10 characters").max(200),
  name: z.string().trim().min(1).max(100),
  timezone: z.string().refine(isValidTimezone, "Unknown timezone").optional(),
});

export const loginSchema = z.object({
  email: z.email().transform((s) => s.toLowerCase().trim()),
  password: z.string().min(1).max(200),
});

export const requestResetSchema = z.object({ email: z.email().transform((s) => s.toLowerCase().trim()) });
export const resetPasswordSchema = z.object({ token: z.string().min(20).max(200), password: registerSchema.shape.password });
export const verifyEmailSchema = z.object({ token: z.string().min(20).max(200) });

export const preferencesSchema = z
  .object({
    timezone: z.string().refine(isValidTimezone, "Unknown timezone"),
    locale: z.string().min(2).max(20),
    workStartMin: minuteOfDay,
    workEndMin: minuteOfDay,
    sleepStartMin: minuteOfDay,
    sleepEndMin: minuteOfDay,
    quietHoursEnabled: z.boolean(),
    quietStartMin: minuteOfDay,
    quietEndMin: minuteOfDay,
    reminderLeadMin: z.number().int().min(0).max(7 * 24 * 60),
    maxRemindersPerTask: z.number().int().min(0).max(10),
    notificationSound: soundSchema,
    escalateSounds: z.boolean(),
    inAppEnabled: z.boolean(),
    webPushEnabled: z.boolean(),
    dailyPlanningMin: minuteOfDay,
    focusBlockMin: z.number().int().min(25).max(240),
    breakMin: z.number().int().min(0).max(60),
    bufferMin: z.number().int().min(0).max(60),
    aiEnabled: z.boolean(),
    theme: z.enum(["system", "light", "dark"]),
    onboardingCompleted: z.boolean(),
    importantSenders: z.array(z.string().trim().toLowerCase().min(3).max(254)).max(100),
  })
  .partial()
  .refine((p) => p.workStartMin === undefined || p.workEndMin === undefined || p.workStartMin < p.workEndMin, {
    message: "Work start must be before work end",
    path: ["workEndMin"],
  });

export const taskCreateSchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().max(5000).nullish(),
  priority: prioritySchema.default("medium"),
  dueAt: isoDateTime.nullish(),
  estimateMin: z.number().int().min(5).max(24 * 60).nullish(),
  category: z.string().trim().max(60).nullish(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  projectId: z.uuid().nullish(),
  recurrence: z.enum(["none", "daily", "weekly", "monthly"]).default("none"),
  dependsOnTaskId: z.uuid().nullish(),
  subtasks: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
});

export const taskUpdateSchema = taskCreateSchema
  .omit({ subtasks: true })
  .partial()
  .extend({ snoozedUntil: isoDateTime.nullish() });

export const taskListQuerySchema = z.object({
  status: z.enum(["open", "done", "all"]).default("open"),
  q: z.string().max(200).optional(),
  priority: prioritySchema.optional(),
  projectId: z.uuid().optional(),
  tag: z.string().max(40).optional(),
  dueBefore: isoDateTime.optional(),
  sort: z.enum(["due", "priority", "created"]).default("due"),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export const subtaskCreateSchema = z.object({ title: z.string().trim().min(1).max(200) });
export const subtaskUpdateSchema = z.object({ title: z.string().trim().min(1).max(200).optional(), done: z.boolean().optional() });
export const projectCreateSchema = z.object({ name: z.string().trim().min(1).max(100), color: z.string().max(20).nullish() });

export const eventCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    description: z.string().max(5000).nullish(),
    location: z.string().max(300).nullish(),
    startAt: isoDateTime,
    endAt: isoDateTime,
    allDay: z.boolean().default(false),
    needsPrep: z.boolean().default(false),
    prepMin: z.number().int().min(5).max(240).default(15),
  })
  .refine((e) => new Date(e.endAt) > new Date(e.startAt), { message: "End must be after start", path: ["endAt"] });

export const eventUpdateSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  description: z.string().max(5000).nullish(),
  location: z.string().max(300).nullish(),
  startAt: isoDateTime.optional(),
  endAt: isoDateTime.optional(),
  needsPrep: z.boolean().optional(),
  prepMin: z.number().int().min(5).max(240).optional(),
});

export const eventRangeQuerySchema = z.object({ from: isoDateTime, to: isoDateTime });

export const reminderCreateSchema = z
  .object({
    taskId: z.uuid().optional(),
    eventId: z.uuid().optional(),
    remindAt: isoDateTime,
    note: z.string().max(300).optional(),
  })
  .refine((r) => r.taskId || r.eventId || r.note, { message: "A reminder needs a task, an event, or a note" });

export const snoozeSchema = z.object({ minutes: z.number().int().min(5).max(24 * 60) });

export const planGenerateSchema = z.object({ date: isoDate.optional() });
export const planItemsUpdateSchema = z.object({
  items: z
    .array(z.object({ id: z.uuid(), startAt: isoDateTime, endAt: isoDateTime }))
    .max(200),
});

export const insightUpdateSchema = z.object({
  status: z.enum(["reviewed", "dismissed", "new"]).optional(),
  userCategory: emailCategorySchema.nullish(),
});

export const insightToTaskSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  dueAt: isoDateTime.nullish(),
  estimateMin: z.number().int().min(5).max(24 * 60).nullish(),
  priority: prioritySchema.optional(),
});

export const pushSubscriptionSchema = z.object({
  endpoint: z.url().max(2000),
  keys: z.object({ p256dh: z.string().min(10).max(500), auth: z.string().min(5).max(200) }),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type TaskCreateInput = z.infer<typeof taskCreateSchema>;
export type TaskUpdateInput = z.infer<typeof taskUpdateSchema>;
export type PreferencesInput = z.infer<typeof preferencesSchema>;
export type EventCreateInput = z.infer<typeof eventCreateSchema>;
