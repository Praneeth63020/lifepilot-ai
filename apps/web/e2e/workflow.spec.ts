import { expect, test, type Page } from "@playwright/test";

/** Formats "today + n days" as YYYY-MM-DD in Asia/Kolkata (the browser timezone used by the tests). */
function istDate(offsetDays: number) {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

async function signUp(page: Page) {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
  await page.goto("/register");
  await page.fill("#name", "E2E Tester");
  await page.fill("#email", email);
  await page.fill("#password", "e2e-password-123");
  await page.check("#terms");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  return email;
}

test("full demo workflow", async ({ page }) => {
  // 1. Sign up + onboarding with demo data
  await signUp(page);
  await page.getByRole("button", { name: "Continue" }).click();
  // Turn quiet hours off so test reminders are never deferred.
  await page.getByRole("switch", { name: "Quiet hours" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Load demo data" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByText("Demo mode", { exact: true })).toBeVisible();
  await expect(page.getByText("Gmail: demo data")).toBeVisible();

  // 2. Create a task with a due time tomorrow → prep + due reminders scheduled
  await page.goto("/app/tasks");
  await page.getByRole("button", { name: "New task" }).click();
  await page.fill("#t-title", "E2E write release notes");
  await page.fill("#t-est", "45");
  await page.fill("#t-dd", istDate(1));
  await page.fill("#t-dt", "16:00");
  await page.getByRole("dialog").getByRole("button", { name: "Add task", exact: true }).click();
  await expect(page.getByText("E2E write release notes")).toBeVisible();

  // 4. Reminder visible as scheduled
  await page.goto("/app/notifications");
  await expect(page.getByText("E2E write release notes")).toHaveCount(2); // heads-up + due

  // 3. Planner produces a plan for tomorrow containing the task, never over events
  await page.goto("/app/planner");
  await page.getByRole("button", { name: "Next day" }).click();
  await page.getByRole("button", { name: "Generate plan" }).first().click();
  const schedule = page.getByRole("list", { name: "Schedule" });
  await expect(schedule).toContainText("E2E write release notes");
  await expect(schedule).toContainText("Interview: Backend Engineer (Acme)");
  await expect(schedule).toContainText("Prepare: Interview");
  await page.getByRole("button", { name: "Accept" }).click();
  await expect(page.getByText("Accepted", { exact: true })).toBeVisible();

  // 5 + 6. Complete the task → reminders cancelled
  await page.goto("/app/tasks");
  await page.getByRole("button", { name: "Complete E2E write release notes" }).click();
  await expect(page.getByText("Done — reminders cancelled")).toBeVisible();
  await page.goto("/app/notifications");
  await expect(page.getByText("E2E write release notes")).toHaveCount(0);

  // 7 + 8. A demo email produces a proposed task; the user approves it (three-panel inbox: list → details)
  await page.goto("/app/inbox");
  const details = page.getByRole("region", { name: "Email details" });
  await page.getByRole("button", { name: /Assignment 3 — Distributed Systems/ }).click();
  await expect(details).toContainText("Stated in the email");
  await details.getByRole("button", { name: "Create task" }).click();
  await expect(page.locator("#a-e")).toHaveValue("240"); // estimate stated in the email
  await page.getByRole("dialog").getByRole("button", { name: "Create task" }).click();
  await expect(details).toContainText("Task created");
  // Ambiguous deadline requires a date (or explicit "no deadline")
  await page.getByRole("button", { name: /Q4 report draft/ }).click();
  await details.getByRole("button", { name: "Create task" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Create task" })).toBeDisabled();
  await dialog.getByLabel("No deadline").check();
  await expect(dialog.getByRole("button", { name: "Create task" })).toBeEnabled();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  // Prompt-injection email is flagged
  await page.getByRole("button", { name: /Action needed on your account/ }).click();
  await expect(details.getByText("This email contains instructions aimed at an AI assistant")).toBeVisible();

  // 9. A calendar conflict produces alternative times
  await page.goto("/app/calendar");
  // The demo conflict is tomorrow. Use the day view and step forward: in the Monday–Sunday week
  // view, "tomorrow" is in next week whenever the test runs on a Sunday.
  await page.getByRole("tab", { name: "day" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "suggest new times" }).first().click();
  const evDialog = page.getByRole("dialog");
  await expect(evDialog.getByText("Alternative times")).toBeVisible();
  await expect(evDialog.locator("li").first()).toBeVisible();
  await expect(evDialog.getByText("won't change it")).toBeVisible();
  await evDialog.getByRole("button", { name: "Close" }).click();

  // 10. Disconnecting stops sync (Sync now disappears; status changes)
  await page.goto("/app/settings");
  await page.getByRole("tab", { name: "Connections" }).click();
  page.once("dialog", (d) => d.accept());
  const gmailCard = page.locator("section").filter({ hasText: "Gmail" }).first();
  await gmailCard.getByRole("button", { name: "Disconnect" }).click();
  await expect(gmailCard.getByText("disconnected")).toBeVisible();
  await expect(gmailCard.getByRole("button", { name: "Sync now" })).toHaveCount(0);
});

test("unauthenticated users are sent to sign in, and bad passwords are rejected", async ({ page }) => {
  await page.goto("/app/tasks");
  await expect(page).toHaveURL(/\/login/);
  await page.fill("#email", "nobody@example.com");
  await page.fill("#password", "wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toContainText("Incorrect email or password");
});

test("projects: create, validate, assign a task, track progress, and move between project and tasks", async ({ page }) => {
  await signUp(page);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Load demo data" }).click();
  await expect(page).toHaveURL(/\/app$/);

  await page.getByRole("link", { name: "Projects" }).first().click();
  await expect(page.getByText("No projects yet")).toBeVisible();
  await page.getByRole("button", { name: "New project" }).click();
  await page.fill("#p-name", "Job search");
  await page.getByRole("dialog").getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("link", { name: "Job search" })).toBeVisible();

  // Duplicate names are caught while typing.
  await page.getByRole("button", { name: "New project" }).click();
  await page.fill("#p-name", "job SEARCH");
  await expect(page.getByText('You already have a project called "Job search".')).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Create project" })).toBeDisabled();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();

  // Assign a task due later this week (demo data), then the card shows progress and the next deadline.
  await page.goto("/app/tasks");
  await page.getByRole("button", { name: "Edit Submit passport renewal form" }).click();
  await page.selectOption("#t-proj", { label: "Job search" });
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goto("/app/projects");
  await expect(page.getByText("0 of 1 done")).toBeVisible();
  await expect(page.getByText(/Next: Submit passport renewal form/)).toBeVisible();

  // Project → its tasks (filtered, with the project header) and back.
  await page.getByRole("link", { name: "View tasks" }).click();
  await expect(page).toHaveURL(/\/app\/tasks\?project=/);
  await expect(page.getByRole("heading", { name: "Job search" })).toBeVisible();
  await expect(page.getByText("Submit passport renewal form", { exact: true })).toBeVisible();
  await expect(page.getByText("Weekly grocery order")).toHaveCount(0);

  // Less common task actions live in the per-task menu; Escape closes it.
  await page.getByRole("button", { name: "More actions for Submit passport renewal form" }).click();
  await expect(page.getByRole("menuitem", { name: "Remind me…" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
});

test("support and password recovery: reachable from the website, sign-in and the app", async ({ page }) => {
  // Website footer → Contact support.
  await page.goto("/");
  await page.getByRole("contentinfo").getByRole("link", { name: "Contact support" }).click();
  await expect(page).toHaveURL(/\/support$/);
  await expect(page.getByRole("heading", { name: "How can we help?" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Contact LifePilot support" })).toBeVisible();

  // Sign-in → Forgot password? keeps the email typed so far.
  await page.goto("/login");
  await page.fill("#email", "someone@example.com");
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(page.getByRole("heading", { name: "Forgot your password?" })).toBeVisible();
  await expect(page.locator("#email")).toHaveValue("someone@example.com");

  // A made-up, expired or used reset link explains itself instead of showing the form.
  await page.goto(`/reset-password?token=${"x".repeat(43)}`);
  await expect(page.getByRole("heading", { name: "This link has expired" })).toBeVisible();
  await expect(page.locator("#pw")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Request a new link" })).toHaveAttribute("href", "/forgot-password");

  // Inside the app: Help & support in the sidebar.
  await signUp(page);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Load demo data" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page.getByRole("link", { name: "Help & support" }).first().click();
  await expect(page).toHaveURL(/\/app\/support$/);
  await expect(page.getByRole("heading", { name: "Help & support" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Report a bug" })).toBeVisible();
});
