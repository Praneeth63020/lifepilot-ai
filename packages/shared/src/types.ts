/** JSON shapes returned by the API (dates are ISO-8601 strings in UTC). */
import type { DeadlineCertainty, EmailCategory } from "./extraction.js";
import type { Priority } from "./planner.js";

export type Sound = "daily_chime" | "priority_alert" | "deadline_alert" | "none";

export interface AppConfigDTO {
  demoMode: boolean;
  googleConfigured: boolean;
  aiProvider: "mock" | "openai";
  webPushPublicKey: string | null;
  mailConfigured: boolean;
}

export interface UserDTO {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  isDemo: boolean;
  createdAt: string;
}

export interface PreferencesDTO {
  timezone: string;
  locale: string;
  workStartMin: number;
  workEndMin: number;
  sleepStartMin: number;
  sleepEndMin: number;
  quietHoursEnabled: boolean;
  quietStartMin: number;
  quietEndMin: number;
  reminderLeadMin: number;
  maxRemindersPerTask: number;
  notificationSound: Sound;
  escalateSounds: boolean;
  inAppEnabled: boolean;
  webPushEnabled: boolean;
  dailyPlanningMin: number;
  focusBlockMin: number;
  breakMin: number;
  bufferMin: number;
  aiEnabled: boolean;
  theme: "system" | "light" | "dark";
  onboardingCompleted: boolean;
  importantSenders: string[];
}

export interface MeDTO {
  user: UserDTO;
  preferences: PreferencesDTO;
}

export interface SubtaskDTO {
  id: string;
  title: string;
  done: boolean;
  position: number;
}

export interface TaskDTO {
  id: string;
  title: string;
  description: string | null;
  status: "open" | "done";
  priority: Priority;
  dueAt: string | null;
  estimateMin: number | null;
  category: string | null;
  tags: string[];
  projectId: string | null;
  sourceType: "manual" | "email" | "calendar" | "chat";
  sourceId: string | null;
  recurrence: "none" | "daily" | "weekly" | "monthly";
  dependsOnTaskId: string | null;
  snoozedUntil: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  subtasks: SubtaskDTO[];
}

export interface ProjectDTO {
  id: string;
  name: string;
  color: string | null;
}

export interface CalendarEventDTO {
  id: string;
  source: "google" | "local" | "demo";
  title: string;
  description: string | null;
  location: string | null;
  startAt: string;
  endAt: string;
  allDay: boolean;
  status: string;
  needsPrep: boolean;
  prepMin: number;
  htmlLink: string | null;
  /** Imported Google events are read-only in this release. */
  readOnly: boolean;
}

export interface ConflictDTO {
  a: { id: string; title: string };
  b: { id: string; title: string };
  overlapStart: string;
  overlapEnd: string;
  overlapMinutes: number;
}

export interface InsightDTO {
  id: string;
  email: {
    id: string;
    subject: string;
    fromAddress: string;
    fromName: string | null;
    receivedAt: string;
    snippet: string;
    webLink: string | null;
    source: "google" | "demo";
  };
  category: EmailCategory;
  aiCategory: EmailCategory;
  importanceScore: number;
  summary: string;
  whyItMatters: string;
  requiredAction: string | null;
  deadlineAt: string | null;
  deadlineText: string | null;
  deadlineCertainty: DeadlineCertainty;
  clarificationQuestion: string | null;
  confidence: number;
  suspicious: boolean;
  proposedTaskTitle: string | null;
  proposedEstimateMin: number | null;
  extractor: string;
  status: "new" | "reviewed" | "dismissed" | "task_created";
  taskId: string | null;
}

export interface PlanItemDTO {
  id: string;
  kind: "task" | "event" | "prep" | "break";
  title: string;
  startAt: string;
  endAt: string;
  taskId: string | null;
  eventId: string | null;
  reason: string | null;
  isFact: boolean;
}

export interface PlanRefDTO {
  taskId: string;
  title: string;
  reason: string;
}

export interface DailyPlanDTO {
  id: string;
  date: string;
  status: "proposed" | "accepted" | "rejected" | "superseded";
  generator: string;
  generatedAt: string;
  items: PlanItemDTO[];
  topTasks: PlanRefDTO[];
  unscheduled: PlanRefDTO[];
  postponable: PlanRefDTO[];
  deadlines: { taskId: string; title: string; dueAt: string; overdue: boolean }[];
  warnings: string[];
  stats: { freeMinutes: number; scheduledTaskMinutes: number; requiredTodayMinutes: number };
  changes?: { taskId: string; title: string; change: "added" | "moved" | "removed"; from?: string; to?: string }[];
}

export interface ReminderDTO {
  id: string;
  taskId: string | null;
  eventId: string | null;
  kind: "prep" | "due" | "event" | "custom";
  remindAt: string;
  status: "scheduled" | "fired" | "cancelled";
  priority: Priority;
  note: string | null;
  snoozeCount: number;
  title: string;
}

export interface NotificationDTO {
  id: string;
  reminderId: string | null;
  taskId: string | null;
  eventId: string | null;
  type: string;
  title: string;
  body: string;
  priority: Priority;
  sound: Sound;
  channel: "in_app" | "web_push";
  status: "pending" | "available" | "accepted" | "failed" | "suppressed" | "seen" | "dismissed";
  error: string | null;
  createdAt: string;
  deliveredAt: string | null;
  seenAt: string | null;
}

export interface ConnectionDTO {
  product: "gmail" | "calendar";
  provider: "google" | "demo" | null;
  status: "active" | "error" | "revoked" | "disconnected" | "not_connected";
  externalEmail: string | null;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  scopes: string[];
  available: boolean;
  unavailableReason: string | null;
}

export interface DashboardDTO {
  now: string;
  date: string;
  timezone: string;
  progress: { completedToday: number; dueToday: number; openTotal: number };
  topTasks: PlanRefDTO[];
  dueToday: TaskDTO[];
  upcomingEvents: CalendarEventDTO[];
  importantEmails: InsightDTO[];
  deadlines: { taskId: string; title: string; dueAt: string; overdue: boolean }[];
  recentNotifications: NotificationDTO[];
  plan: DailyPlanDTO | null;
  recommendations: string[];
  connections: ConnectionDTO[];
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}
