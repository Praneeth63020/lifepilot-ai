import { Router } from "express";
import rateLimit from "express-rate-limit";
import { and, eq, ne } from "drizzle-orm";
import { sessions, userPreferences, users } from "@lifepilot/db";
import { AppError, audit, getPrefs, type CoreContext } from "@lifepilot/core";
import {
  loginSchema,
  registerSchema,
  requestResetSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from "@lifepilot/shared";
import {
  consumeAuthToken,
  createSession,
  destroySession,
  findUserByEmail,
  getDummyHash,
  hashPassword,
  issueAuthToken,
  requireUser,
  uid,
  verifyPassword,
} from "../auth.js";
import { parse } from "../http.js";
import { prefsDTO, userDTO } from "../serialize.js";

export function authRoutes(ctx: CoreContext): Router {
  const r = Router();
  const strict = rateLimit({
    windowMs: 15 * 60_000,
    limit: ctx.config.env === "test" ? 1000 : 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: { code: "rate_limited", message: "Too many attempts. Try again in a few minutes." } },
  });

  async function sendVerification(userId: string, email: string) {
    const token = await issueAuthToken(ctx, userId, "verify_email");
    await ctx.mailer.send({
      to: email,
      subject: "Verify your LifePilot email",
      text: `Confirm your email address: ${ctx.config.webUrl}/verify-email?token=${token}\n\nThis link expires in 48 hours.`,
    });
  }

  r.post("/register", strict, async (req, res) => {
    const input = parse(registerSchema, req.body);
    if (await findUserByEmail(ctx, input.email)) {
      throw new AppError(409, "email_taken", "An account with this email already exists");
    }
    const [user] = await ctx.db
      .insert(users)
      .values({ email: input.email, name: input.name, passwordHash: await hashPassword(input.password) })
      .returning();
    await ctx.db.insert(userPreferences).values({ userId: user!.id, timezone: input.timezone ?? "UTC" });
    await sendVerification(user!.id, user!.email);
    await createSession(ctx, req, res, user!.id);
    await audit(ctx, user!.id, "auth.registered", "user", user!.id, undefined, req.ip);
    res.status(201).json({ user: userDTO(user!), preferences: prefsDTO(await getPrefs(ctx, user!.id)) });
  });

  r.post("/login", strict, async (req, res) => {
    const input = parse(loginSchema, req.body);
    const user = await findUserByEmail(ctx, input.email);
    const ok = user ? await verifyPassword(user.passwordHash, input.password) : (await verifyPassword(await getDummyHash(), input.password), false);
    if (!user || !ok) {
      await audit(ctx, user?.id ?? null, "auth.login_failed", "user", user?.id, { email: input.email }, req.ip);
      throw new AppError(401, "invalid_credentials", "Incorrect email or password");
    }
    await createSession(ctx, req, res, user.id);
    await audit(ctx, user.id, "auth.login", "user", user.id, undefined, req.ip);
    res.json({ user: userDTO(user), preferences: prefsDTO(await getPrefs(ctx, user.id)) });
  });

  r.post("/logout", async (req, res) => {
    await destroySession(ctx, req, res);
    res.status(204).end();
  });

  r.get("/me", requireUser, async (req, res) => {
    const user = await ctx.db.query.users.findFirst({ where: eq(users.id, uid(req)) });
    if (!user) throw new AppError(401, "unauthenticated", "Please sign in");
    res.json({ user: userDTO(user), preferences: prefsDTO(await getPrefs(ctx, user.id)) });
  });

  r.post("/verify-email", strict, async (req, res) => {
    const { token } = parse(verifyEmailSchema, req.body);
    const userId = await consumeAuthToken(ctx, token, "verify_email");
    await ctx.db.update(users).set({ emailVerifiedAt: ctx.now() }).where(eq(users.id, userId));
    res.json({ ok: true });
  });

  r.post("/resend-verification", requireUser, strict, async (req, res) => {
    const user = await ctx.db.query.users.findFirst({ where: eq(users.id, uid(req)) });
    if (user && !user.emailVerifiedAt) await sendVerification(user.id, user.email);
    res.json({ ok: true });
  });

  // Always 200 so the endpoint can't be used to discover which emails have accounts.
  r.post("/request-password-reset", strict, async (req, res) => {
    const { email } = parse(requestResetSchema, req.body);
    const user = await findUserByEmail(ctx, email);
    if (user) {
      const token = await issueAuthToken(ctx, user.id, "reset_password");
      await ctx.mailer.send({
        to: user.email,
        subject: "Reset your LifePilot password",
        text: `Reset your password: ${ctx.config.webUrl}/reset-password?token=${token}\n\nThis link expires in 1 hour. If you didn't ask for this, ignore this email.`,
      });
      await audit(ctx, user.id, "auth.reset_requested", "user", user.id, undefined, req.ip);
    }
    res.json({ ok: true });
  });

  r.post("/reset-password", strict, async (req, res) => {
    const { token, password } = parse(resetPasswordSchema, req.body);
    const userId = await consumeAuthToken(ctx, token, "reset_password");
    await ctx.db.update(users).set({ passwordHash: await hashPassword(password) }).where(eq(users.id, userId));
    // Sign out everywhere after a password reset.
    await ctx.db.delete(sessions).where(eq(sessions.userId, userId));
    await audit(ctx, userId, "auth.password_reset", "user", userId, undefined, req.ip);
    res.json({ ok: true });
  });

  r.get("/sessions", requireUser, async (req, res) => {
    const rows = await ctx.db.query.sessions.findMany({ where: eq(sessions.userId, uid(req)) });
    res.json({
      items: rows.map((s) => ({
        id: s.id.slice(0, 16),
        current: s.id === req.sessionId,
        userAgent: s.userAgent,
        createdAt: s.createdAt.toISOString(),
        lastSeenAt: s.lastSeenAt.toISOString(),
      })),
    });
  });

  r.post("/sessions/revoke-others", requireUser, async (req, res) => {
    await ctx.db.delete(sessions).where(and(eq(sessions.userId, uid(req)), ne(sessions.id, req.sessionId!)));
    res.json({ ok: true });
  });

  return r;
}
