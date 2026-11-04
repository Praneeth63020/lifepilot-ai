import type {
  CalendarEventDTO,
  DailyPlanDTO,
  InsightDTO,
  NotificationDTO,
  PreferencesDTO,
  ReminderDTO,
  TaskDTO,
  UserDTO,
} from "@lifepilot/shared";
import type { FullPlan, Prefs, TaskWithSubtasks } from "@lifepilot/core";
import type { calendarEvents, emailInsights, notifications, reminders, syncedEmails, users } from "@lifepilot/db";

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export function userDTO(u: typeof users.$inferSelect): UserDTO {
  return { id: u.id, email: u.email, name: u.name, emailVerified: Boolean(u.emailVerifiedAt), isDemo: u.isDemo, createdAt: u.createdAt.toISOString() };
}

export function prefsDTO(p: Prefs): PreferencesDTO & { importantSenders: string[] } {
  return {
    timezone: p.timezone,
    locale: p.locale,
    workStartMin: p.workStartMin,
    workEndMin: p.workEndMin,
    sleepStartMin: p.sleepStartMin,
    sleepEndMin: p.sleepEndMin,
    quietHoursEnabled: p.quietHoursEnabled,
    quietStartMin: p.quietStartMin,
    quietEndMin: p.quietEndMin,
    reminderLeadMin: p.reminderLeadMin,
    maxRemindersPerTask: p.maxRemindersPerTask,
    notificationSound: p.notificationSound,
    escalateSounds: p.escalateSounds,
    inAppEnabled: p.inAppEnabled,
    webPushEnabled: p.webPushEnabled,
    dailyPlanningMin: p.dailyPlanningMin,
    focusBlockMin: p.focusBlockMin,
    breakMin: p.breakMin,
    bufferMin: p.bufferMin,
    aiEnabled: p.aiEnabled,
    theme: p.theme,
    onboardingCompleted: Boolean(p.onboardingCompletedAt),
    importantSenders: p.importantSenders,
  };
}

export function taskDTO(t: TaskWithSubtasks): TaskDTO {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    status: t.status,
    priority: t.priority,
    dueAt: iso(t.dueAt),
    estimateMin: t.estimateMin,
    category: t.category,
    tags: t.tags,
    projectId: t.projectId,
    sourceType: t.sourceType,
    sourceId: t.sourceId,
    recurrence: t.recurrence,
    dependsOnTaskId: t.dependsOnTaskId,
    snoozedUntil: iso(t.snoozedUntil),
    completedAt: iso(t.completedAt),
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    subtasks: t.subtasks.map((s) => ({ id: s.id, title: s.title, done: s.done, position: s.position })),
  };
}

export function eventDTO(e: typeof calendarEvents.$inferSelect): CalendarEventDTO {
  return {
    id: e.id,
    source: e.source,
    title: e.title,
    description: e.description,
    location: e.location,
    startAt: e.startAt.toISOString(),
    endAt: e.endAt.toISOString(),
    allDay: e.allDay,
    status: e.status,
    needsPrep: e.needsPrep,
    prepMin: e.prepMin,
    htmlLink: e.htmlLink,
    readOnly: e.source !== "local",
  };
}

export function insightDTO(
  i: typeof emailInsights.$inferSelect,
  e: typeof syncedEmails.$inferSelect,
  provider: "google" | "demo",
  taskId: string | null,
): InsightDTO {
  return {
    id: i.id,
    email: {
      id: e.id,
      subject: e.subject,
      fromAddress: e.fromAddress,
      fromName: e.fromName,
      receivedAt: e.receivedAt.toISOString(),
      snippet: e.snippet,
      webLink: e.webLink,
      source: provider,
    },
    category: i.userCategory ?? i.category,
    aiCategory: i.category,
    importanceScore: i.importanceScore,
    summary: i.summary,
    whyItMatters: i.whyItMatters,
    requiredAction: i.requiredAction,
    deadlineAt: iso(i.deadlineAt),
    deadlineText: i.deadlineText,
    deadlineCertainty: i.deadlineCertainty,
    clarificationQuestion: i.clarificationQuestion,
    confidence: i.confidence,
    suspicious: i.suspicious,
    proposedTaskTitle: i.proposedTaskTitle,
    proposedEstimateMin: i.proposedEstimateMin,
    extractor: i.extractor,
    status: i.status,
    taskId,
  };
}

export function planDTO(p: FullPlan): DailyPlanDTO {
  return {
    id: p.id,
    date: p.date,
    status: p.status,
    generator: p.generator,
    generatedAt: p.generatedAt.toISOString(),
    items: p.items.map((i) => ({
      id: i.id,
      kind: i.kind,
      title: i.title,
      startAt: i.startAt.toISOString(),
      endAt: i.endAt.toISOString(),
      taskId: i.taskId,
      eventId: i.eventId,
      reason: i.reason,
      isFact: i.isFact,
    })),
    ...p.details,
  };
}

export function reminderDTO(r: typeof reminders.$inferSelect, title: string): ReminderDTO {
  return {
    id: r.id,
    taskId: r.taskId,
    eventId: r.eventId,
    kind: r.kind,
    remindAt: r.remindAt.toISOString(),
    status: r.status,
    priority: r.priority,
    note: r.note,
    snoozeCount: r.snoozeCount,
    title,
  };
}

export function notificationDTO(n: typeof notifications.$inferSelect): NotificationDTO {
  return {
    id: n.id,
    reminderId: n.reminderId,
    taskId: n.taskId,
    eventId: n.eventId,
    type: n.type,
    title: n.title,
    body: n.body,
    priority: n.priority,
    sound: n.sound,
    channel: n.channel,
    status: n.status,
    error: n.error,
    createdAt: n.createdAt.toISOString(),
    deliveredAt: iso(n.deliveredAt),
    seenAt: iso(n.seenAt),
  };
}
