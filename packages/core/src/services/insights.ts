/**
 * Anticipation engine: turns synced emails into reviewed, de-duplicated proposals.
 * Rules:
 *  - one insight per email (unique index) → re-syncing never duplicates
 *  - a task is only created when the USER approves an insight
 *  - ambiguous deadlines require the user to pick a date (or explicitly choose none)
 *  - suspicious emails are never acted on automatically and are flagged in the UI
 *  - a later email in the same thread with a different deadline is surfaced as a possible change,
 *    never applied silently
 */
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { emailInsights, syncedEmails, tasks } from "@lifepilot/db";
import { formatLocalDateTime, type Priority } from "@lifepilot/shared";
import { AppError, badRequest, notFound, type CoreContext } from "../context.js";
import { getPrefs } from "./prefs.js";
import { MockExtractor } from "../ai/extractor.js";

const localExtractor = new MockExtractor();
import { createTask } from "./tasks.js";

type EmailRow = typeof syncedEmails.$inferSelect;

export async function processEmails(ctx: CoreContext, userId: string, emailIds?: string[]): Promise<number> {
  const prefs = await getPrefs(ctx, userId);
  const pending = await ctx.db
    .select({ email: syncedEmails })
    .from(syncedEmails)
    .leftJoin(emailInsights, eq(emailInsights.emailId, syncedEmails.id))
    .where(
      and(
        eq(syncedEmails.userId, userId),
        isNull(emailInsights.id),
        emailIds?.length ? inArray(syncedEmails.id, emailIds) : undefined,
      ),
    );
  // "AI email analysis" off → never send email content to a model; use the local rule engine.
  const extractorImpl = prefs.aiEnabled ? ctx.extractor : localExtractor;
  let created = 0;
  for (const { email } of pending) {
    const { result, extractor } = await extractorImpl.extract(
      { subject: email.subject, body: email.bodyExcerpt || email.snippet, fromAddress: email.fromAddress, fromName: email.fromName, receivedAt: email.receivedAt },
      { timezone: prefs.timezone, importantSenders: prefs.importantSenders },
    );
    let why = result.whyItMatters;
    let category = result.category;
    const change = await detectDeadlineChange(ctx, userId, email, result.deadline.deadlineAt, prefs.timezone);
    if (change) {
      why = `${change} ${why}`;
      if (category !== "urgent") category = "deadline";
    }
    const [row] = await ctx.db
      .insert(emailInsights)
      .values({
        userId,
        emailId: email.id,
        category,
        importanceScore: result.importanceScore,
        summary: result.summary,
        whyItMatters: why,
        requiredAction: result.requiredAction,
        deadlineAt: result.deadline.deadlineAt,
        deadlineText: result.deadline.deadlineText,
        deadlineCertainty: result.deadline.certainty,
        clarificationQuestion: result.deadline.question,
        confidence: result.confidence,
        suspicious: result.suspicious,
        proposedTaskTitle: result.proposedTaskTitle,
        proposedEstimateMin: result.proposedEstimateMin,
        extractor,
        // Pure noise doesn't need review.
        status: category === "low_priority" && !result.suspicious ? "reviewed" : "new",
      })
      .onConflictDoNothing()
      .returning();
    if (row) created++;
  }
  return created;
}

async function detectDeadlineChange(ctx: CoreContext, userId: string, email: EmailRow, newDeadline: Date | null, tz: string): Promise<string | null> {
  if (!email.threadId || !newDeadline) return null;
  const siblings = await ctx.db
    .select({ id: syncedEmails.id })
    .from(syncedEmails)
    .where(and(eq(syncedEmails.userId, userId), eq(syncedEmails.threadId, email.threadId), ne(syncedEmails.id, email.id)));
  if (!siblings.length) return null;
  const related = await ctx.db.query.tasks.findFirst({
    where: and(eq(tasks.userId, userId), eq(tasks.sourceType, "email"), inArray(tasks.sourceId, siblings.map((s) => s.id))),
  });
  if (!related || related.status === "done") return null;
  if (related.dueAt && related.dueAt.getTime() === newDeadline.getTime()) return null;
  const was = related.dueAt ? formatLocalDateTime(related.dueAt, tz) : "no due date";
  return `Possible deadline change for your task "${related.title}" (currently ${was}; this email says ${formatLocalDateTime(newDeadline, tz)}). Review before updating.`;
}

export async function getInsight(ctx: CoreContext, userId: string, insightId: string) {
  const row = await ctx.db
    .select({ insight: emailInsights, email: syncedEmails })
    .from(emailInsights)
    .innerJoin(syncedEmails, eq(syncedEmails.id, emailInsights.emailId))
    .where(and(eq(emailInsights.id, insightId), eq(emailInsights.userId, userId)))
    .limit(1);
  if (!row[0]) throw notFound("Email insight");
  return row[0];
}

/**
 * User approves an insight → task. Idempotent on (user, 'email', emailId).
 * `dueAt === undefined` means "use the extracted deadline"; `null` means "no deadline".
 */
export async function approveInsight(
  ctx: CoreContext,
  userId: string,
  insightId: string,
  input: { title?: string; dueAt?: string | null; estimateMin?: number | null; priority?: Priority },
) {
  const { insight, email } = await getInsight(ctx, userId, insightId);
  if (insight.status === "dismissed") throw badRequest("This email was dismissed");
  let dueAt: string | null;
  if (input.dueAt !== undefined) {
    dueAt = input.dueAt;
  } else if (insight.deadlineCertainty === "ambiguous") {
    throw new AppError(422, "clarification_required", insight.clarificationQuestion ?? "Please confirm the deadline", {
      question: insight.clarificationQuestion,
    });
  } else {
    dueAt = insight.deadlineAt?.toISOString() ?? null;
  }
  const priority: Priority =
    input.priority ?? (insight.category === "urgent" ? "urgent" : insight.importanceScore >= 60 ? "high" : "medium");
  const { task, created } = await createTask(
    ctx,
    userId,
    {
      title: input.title ?? insight.proposedTaskTitle ?? email.subject ?? "Follow up on email",
      description: [insight.requiredAction, `From: ${email.fromName ?? email.fromAddress}`, insight.deadlineText ? `Email said: "${insight.deadlineText}"` : null]
        .filter(Boolean)
        .join("\n"),
      priority,
      dueAt,
      estimateMin: input.estimateMin ?? insight.proposedEstimateMin ?? null,
      tags: ["email"],
      recurrence: "none",
    },
    { sourceType: "email", sourceId: email.id },
  );
  await ctx.db.update(emailInsights).set({ status: "task_created" }).where(eq(emailInsights.id, insight.id));
  return { task, created };
}
