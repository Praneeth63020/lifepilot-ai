/**
 * Seeds a demo account with synthetic data (never real credentials).
 *   pnpm db:seed   →   demo@lifepilot.local / demo-password-123
 */
import { eq } from "drizzle-orm";
import { userPreferences, users } from "@lifepilot/db";
import { ConfigError, connectDemo, createCoreContext, loadConfig, loadDemoData } from "@lifepilot/core";
import { hashPassword } from "../auth.js";

const DEMO_EMAIL = "demo@lifepilot.local";
const DEMO_PASSWORD = "demo-password-123";

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
  if (config.isProd) throw new Error("Refusing to seed demo data in production");
  const { ctx, close } = createCoreContext({ ...config, demoMode: true }, "seed");
  try {
    let user = await ctx.db.query.users.findFirst({ where: eq(users.email, DEMO_EMAIL) });
    if (!user) {
      [user] = await ctx.db
        .insert(users)
        .values({ email: DEMO_EMAIL, name: "Demo User", passwordHash: await hashPassword(DEMO_PASSWORD), emailVerifiedAt: new Date() })
        .returning();
      await ctx.db.insert(userPreferences).values({
        userId: user!.id,
        timezone: process.env.SEED_TIMEZONE ?? "Asia/Kolkata",
        onboardingCompletedAt: new Date(),
      });
    }
    await connectDemo(ctx, user!.id, "gmail");
    await connectDemo(ctx, user!.id, "calendar");
    const loaded = await loadDemoData(ctx, user!.id);
    console.log(`Demo account ready: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`, loaded);
  } finally {
    await close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
