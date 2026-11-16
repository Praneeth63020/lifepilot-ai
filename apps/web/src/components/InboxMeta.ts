import type { InsightDTO } from "@lifepilot/shared";

export type Category = InsightDTO["category"];

export const CATEGORY_LABEL: Record<Category, string> = {
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

export const CERTAINTY: Record<InsightDTO["deadlineCertainty"], { label: string; tone: "ok" | "accent" | "warn" | "neutral"; hint: string }> = {
  explicit: { label: "Stated in the email", tone: "ok", hint: "The email gives this date and time directly." },
  inferred: { label: "Worked out from the email's date — check it", tone: "accent", hint: "Calculated from words like “Friday” or “tomorrow” relative to when the email was sent." },
  ambiguous: { label: "Unclear — needs your confirmation", tone: "warn", hint: "The email mentions a deadline but not clearly enough to trust. Confirm it before planning around it." },
  none: { label: "", tone: "neutral", hint: "" },
};

export const STATUS_LABEL: Record<InsightDTO["status"], { text: string; tone: "accent" | "neutral" | "ok" }> = {
  new: { text: "Needs review", tone: "accent" },
  reviewed: { text: "Reviewed", tone: "neutral" },
  dismissed: { text: "Dismissed", tone: "neutral" },
  task_created: { text: "Task created", tone: "ok" },
};

export type Importance = "high" | "medium" | "low";
export function importanceOf(i: InsightDTO): Importance {
  if (i.category === "urgent" || i.importanceScore >= 75) return "high";
  if (i.importanceScore >= 50) return "medium";
  return "low";
}

export function categoryTone(c: Category): "danger" | "neutral" | "accent" | "violet" | "blue" | "ok" {
  if (c === "urgent") return "danger";
  if (c === "low_priority" || c === "informational") return "neutral";
  if (c === "meeting") return "violet";
  if (c === "travel" || c === "financial") return "blue";
  return "accent";
}

export function extractorName(extractor: string) {
  return extractor === "mock" ? "the built-in rule engine" : extractor;
}

/** Up to two initials for a sender avatar. */
export function senderInitials(i: InsightDTO) {
  const src = i.email.fromName?.trim() || i.email.fromAddress.split("@")[0] || "?";
  const parts = src.split(/[\s._-]+/).filter(Boolean);
  return (parts.length > 1 ? parts[0]![0]! + parts[1]![0]! : src.slice(0, 2)).toUpperCase();
}
