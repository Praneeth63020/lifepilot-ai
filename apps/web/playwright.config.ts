import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against a running stack (API + worker + web, DEMO_MODE=true):
 *   pnpm dev   # in another terminal
 *   pnpm test:e2e
 * Set PW_CHROMIUM_PATH to use a preinstalled Chromium instead of `npx playwright install chromium`.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173",
    timezoneId: "Asia/Kolkata",
    trace: "retain-on-failure",
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
