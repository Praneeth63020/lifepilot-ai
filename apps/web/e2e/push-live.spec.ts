/**
 * OPT-IN live web-push check against the real push service (Chrome → Google FCM).
 * Skipped unless LIVE_PUSH=1. Needs VAPID keys in .env and a running stack:
 *   LIVE_PUSH=1 E2E_BASE_URL=http://localhost:5173 PW_CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *     pnpm --filter @lifepilot/web exec playwright test e2e/push-live.spec.ts
 * Add HEADED=1 to watch Chrome and see the system notification banner.
 * Prints only the push service host, never the subscription endpoint (it contains a device token).
 */
import { chromium, expect, test } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:5173";
test.skip(process.env.LIVE_PUSH !== "1", "Live push check is opt-in: set LIVE_PUSH=1");

test("live web push in desktop Chrome", async () => {
  test.setTimeout(300_000);
  const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), "lp-push-")), {
    executablePath: process.env.PW_CHROMIUM_PATH,
    headless: process.env.HEADED !== "1",
    baseURL: BASE,
  });
  await ctx.grantPermissions(["notifications"], { origin: BASE });
  const page = await ctx.newPage();
  console.log("Chrome version:", ctx.browser()?.version() ?? (await page.evaluate(() => navigator.userAgent)).match(/Chrome\/[\d.]+/)?.[0]);

  await page.goto("/register");
  await page.fill("#name", "Push Tester");
  await page.fill("#email", `push-${Date.now()}@example.com`);
  await page.fill("#password", "push-password-123");
  await page.check("#terms");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("switch", { name: "Quiet hours" }).click(); // the test must not be deferred
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Load demo data" }).click();
  await expect(page).toHaveURL(/\/app$/);

  console.log("1. permission:", await page.evaluate(() => Notification.permission));
  await page.goto("/app/settings");
  await page.getByRole("tab", { name: "Notifications" }).click();
  await page.getByRole("switch", { name: "Browser push notifications" }).click();
  await expect(page.getByRole("switch", { name: "Browser push notifications" })).toHaveAttribute("aria-checked", "true", { timeout: 30_000 });
  const sw = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration("/sw.js");
    const sub = await reg?.pushManager.getSubscription();
    return { registered: Boolean(reg?.active), subscribed: Boolean(sub), pushHost: sub ? new URL(sub.endpoint).host : null };
  });
  console.log("2-4. service worker active:", sw.registered, "| browser subscription:", sw.subscribed, "| push service:", sw.pushHost);
  const subs = await page.request.get("/api/v1/push/subscriptions");
  console.log("5. stored by backend:", (await subs.json()).count, "subscription(s)");

  await page.getByRole("button", { name: "Send a test reminder" }).click();
  await expect(page.getByText("Test reminder scheduled")).toBeVisible();
  const scheduledAt = Date.now();
  await page.close(); // tab closed; the browser keeps running, as it does for a real user
  console.log("6. tab closed; waiting for delivery…");

  let shown: { title: string; body: string; url?: string }[] = [];
  const check = await ctx.newPage();
  await check.goto("/"); // same origin, no app tab needed for the service worker to act
  for (let i = 0; i < 24 && shown.length === 0; i++) {
    await check.waitForTimeout(5_000);
    shown = await check.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const ns = (await reg?.getNotifications()) ?? [];
      return ns.map((n) => ({ title: n.title, body: n.body, url: (n.data as { url?: string } | null)?.url }));
    });
  }
  console.log(`   displayed by the service worker after ~${Math.round((Date.now() - scheduledAt) / 1000)}s:`, JSON.stringify(shown));
  await check.close();

  const app = await ctx.newPage();
  await app.goto("/app/notifications");
  const list = (await (await app.request.get("/api/v1/notifications?limit=10")).json()).items as { channel: string; status: string; title: string }[];
  console.log("   delivery records:", JSON.stringify(list.map((n) => ({ channel: n.channel, status: n.status, title: n.title }))));

  await app.goto("/app/settings");
  await app.getByRole("tab", { name: "Notifications" }).click();
  await app.getByRole("switch", { name: "Browser push notifications" }).click();
  await expect(app.getByRole("switch", { name: "Browser push notifications" })).toHaveAttribute("aria-checked", "false", { timeout: 30_000 });
  const after = await (await app.request.get("/api/v1/push/subscriptions")).json();
  const stillSubscribed = await app.evaluate(async () => Boolean(await (await navigator.serviceWorker.getRegistration("/sw.js"))?.pushManager.getSubscription()));
  console.log("7-8. after disabling: backend", after.count, "subscription(s); browser subscribed:", stillSubscribed);
  await ctx.close();
});
