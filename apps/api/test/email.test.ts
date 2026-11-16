import net from "node:net";
import supertest from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ConfigError,
  createLogger,
  createMailer,
  loadConfig,
  passwordChangedEmail,
  passwordResetEmail,
  verificationEmail,
} from "@lifepilot/core";
import { createApp } from "../src/app.js";
import { FIXED_NOW, closeDb, makeCtx, resetDb, signUp } from "./helpers.js";

afterAll(closeDb);
beforeEach(resetDb);

const SMTP_PASSWORD = "super-secret-smtp-password";

/**
 * A minimal SMTP server on localhost: enough of the protocol for nodemailer to log in and deliver.
 * Messages are kept in memory; nothing leaves the machine. No STARTTLS is offered, which also lets
 * a test check that a mailer requiring TLS refuses to send in the clear.
 */
async function fakeSmtp() {
  const messages: { from: string; to: string[]; data: string }[] = [];
  const server = net.createServer((sock) => {
    let mode: "cmd" | "data" = "cmd";
    let buf = "";
    let cur = { from: "", to: [] as string[], data: "" };
    sock.write("220 fake.smtp.test ESMTP\r\n");
    sock.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      let i: number;
      while ((i = buf.indexOf("\r\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (mode === "data") {
          if (line === ".") {
            messages.push(cur);
            cur = { from: "", to: [], data: "" };
            mode = "cmd";
            sock.write("250 OK queued\r\n");
          } else cur.data += (line.startsWith("..") ? line.slice(1) : line) + "\r\n";
          continue;
        }
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === "EHLO" || cmd === "HELO") sock.write("250-fake.smtp.test\r\n250 AUTH PLAIN LOGIN\r\n");
        else if (cmd === "AUTH") sock.write("235 Authentication successful\r\n");
        else if (cmd === "MAIL") (cur.from = line), sock.write("250 OK\r\n");
        else if (cmd === "RCPT") (cur.to.push(line), sock.write("250 OK\r\n"));
        else if (cmd === "DATA") (mode = "data"), sock.write("354 End data with <CR><LF>.<CR><LF>\r\n");
        else if (cmd === "QUIT") (sock.write("221 Bye\r\n"), sock.end());
        else sock.write("250 OK\r\n");
      }
    });
    sock.on("error", () => undefined);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  return {
    messages,
    url: `smtp://lifepilot:${SMTP_PASSWORD}@127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Undo quoted-printable soft line breaks and escapes so the message text can be searched. */
const decodeQP = (s: string) => s.replace(/=\r\n/g, "").replace(/=([0-9A-F]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));

async function waitFor(check: () => boolean, ms = 3000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 10));
  }
}

const tokenIn = (s: string) => /token=([\w-]+)/.exec(decodeQP(s))![1]!;

describe("email templates", () => {
  const brand = { webUrl: "https://app.lifepilot.test", supportEmail: "support@lifepilot.test" };

  it("password reset: branded HTML with a button, the link as text, expiry, support and a plain-text version", () => {
    const m = passwordResetEmail({ ...brand, link: "https://app.lifepilot.test/reset-password?token=abc&x=1", expiresMinutes: 60 });
    expect(m.subject).toBe("Reset your LifePilot AI password");
    expect(m.html).toContain("Reset password</a>");
    expect(m.html).toContain('href="https://app.lifepilot.test/reset-password?token=abc&amp;x=1"'); // escaped in HTML
    expect(m.html).toContain("valid for 60 minutes and can only be used once");
    expect(m.html).toContain("If you didn&#39;t request this change, you can safely ignore this email.");
    expect(m.html).toContain("mailto:support@lifepilot.test");
    expect(m.text).toContain("Reset password: https://app.lifepilot.test/reset-password?token=abc&x=1");
    expect(m.text).toContain("support@lifepilot.test");
    expect(m.text).not.toMatch(/<[a-z]/i);
  });

  it("verification and password-changed emails share the layout", () => {
    const v = verificationEmail({ ...brand, link: "https://app.lifepilot.test/verify-email?token=t", expiresHours: 48 });
    expect(v.subject).toBe("Verify your LifePilot AI email address");
    expect(v.html).toContain("Verify email</a>");
    expect(v.html).toContain("valid for 48 hours");
    const c = passwordChangedEmail({ ...brand, when: "2 November 2026 at 09:00 IST", resetUrl: "https://app.lifepilot.test/forgot-password" });
    expect(c.subject).toBe("Your LifePilot AI password was changed");
    expect(c.text).toContain("2 November 2026 at 09:00 IST");
    expect(c.text).toContain("https://app.lifepilot.test/forgot-password");
    expect(c.html).not.toContain("token=");
  });

  it("escapes every value and leaves out the support line when no address is configured", () => {
    const m = passwordResetEmail({ webUrl: "https://x.test", supportEmail: null, link: 'https://x.test/r?token=a"><script>alert(1)</script>', expiresMinutes: 60 });
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&lt;script&gt;");
    expect(m.html).not.toContain("mailto:");
    expect(m.text).not.toContain("Questions?");
  });
});

describe("SMTP delivery", () => {
  let smtp: Awaited<ReturnType<typeof fakeSmtp>>;
  beforeEach(async () => {
    smtp = await fakeSmtp();
  });
  afterEach(() => smtp.close());

  it("sends HTML with a plain-text alternative, the configured sender and Reply-To", async () => {
    const mailer = createMailer(smtp.url, { from: "LifePilot AI <no-reply@lifepilot.test>", replyTo: "support@lifepilot.test" }, createLogger("silent", "t"));
    expect(await mailer.verify!()).toBe(true);
    const m = verificationEmail({ webUrl: "https://app.lifepilot.test", supportEmail: "support@lifepilot.test", link: "https://app.lifepilot.test/verify-email?token=abc", expiresHours: 48 });
    await mailer.send({ to: "customer@example.com", ...m });
    expect(smtp.messages).toHaveLength(1);
    const msg = smtp.messages[0]!;
    expect(msg.from).toContain("no-reply@lifepilot.test");
    expect(msg.to[0]).toContain("customer@example.com");
    expect(msg.data).toMatch(/^From: LifePilot AI <no-reply@lifepilot\.test>/m);
    expect(msg.data).toMatch(/^Reply-To: support@lifepilot\.test/m);
    expect(msg.data).toMatch(/^Subject: Verify your LifePilot AI email address/m);
    expect(msg.data).toContain("multipart/alternative");
    expect(msg.data).toContain("Content-Type: text/plain");
    expect(msg.data).toContain("Content-Type: text/html");
  });

  it("refuses to send in the clear when TLS is required (production)", async () => {
    const mailer = createMailer(smtp.url, { from: "no-reply@lifepilot.test", requireTLS: true }, createLogger("silent", "t"));
    await expect(mailer.send({ to: "c@example.com", subject: "s", text: "t" })).rejects.toThrow();
    expect(smtp.messages).toHaveLength(0);
  });

  it("delivers the whole reset journey by SMTP, and nothing secret reaches the logs", async () => {
    const lines: string[] = [];
    const logger = createLogger("debug", "test", { write: (s: string) => void lines.push(s) });
    const h = makeCtx({ supportEmail: "support@lifepilot.test" });
    const ctx = { ...h.ctx, logger, mailer: createMailer(smtp.url, { from: "LifePilot AI <no-reply@lifepilot.test>", replyTo: "support@lifepilot.test" }, logger) };
    const app = createApp(ctx, { requestLogging: true });

    // Registration: a verification email.
    await signUp(app, "journey@example.com");
    await waitFor(() => smtp.messages.length === 1);
    expect(decodeQP(smtp.messages[0]!.data)).toContain("http://localhost:5173/verify-email?token=");

    // Forgot password: a reset email whose link is on WEB_URL.
    const anon = supertest.agent(app).set("x-lifepilot-csrf", "1");
    expect((await anon.post("/api/v1/auth/request-password-reset").send({ email: "journey@example.com" }).expect(200)).body).toEqual({ ok: true });
    await waitFor(() => smtp.messages.length === 2);
    const reset = decodeQP(smtp.messages[1]!.data);
    expect(reset).toMatch(/^Subject: Reset your LifePilot AI password/m);
    expect(reset).toContain("http://localhost:5173/reset-password?token=");
    const token = tokenIn(reset);

    // The page can check the link before showing the form.
    expect((await anon.post("/api/v1/auth/reset-password/check").send({ token }).expect(200)).body).toEqual({ valid: true });
    await anon.post("/api/v1/auth/reset-password").send({ token, password: "a-brand-new-password" }).expect(200);
    expect((await anon.post("/api/v1/auth/reset-password/check").send({ token }).expect(200)).body).toEqual({ valid: false });

    // A "your password was changed" notice follows, with no link token in it.
    await waitFor(() => smtp.messages.length === 3);
    const changed = decodeQP(smtp.messages[2]!.data);
    expect(changed).toMatch(/^Subject: Your LifePilot AI password was changed/m);
    expect(changed).not.toContain("token=");

    await anon.post("/api/v1/auth/login").send({ email: "journey@example.com", password: "correct-horse-battery" }).expect(401); // old password
    await anon.post("/api/v1/auth/login").send({ email: "journey@example.com", password: "a-brand-new-password" }).expect(200);

    const log = lines.join("\n");
    expect(log).toContain('"purpose":"reset_password"'); // deliveries are logged…
    expect(log).not.toContain(token); // …but never the token,
    expect(log).not.toContain("reset-password?token"); // the link,
    expect(log).not.toContain("a-brand-new-password"); // a password,
    expect(log).not.toContain(SMTP_PASSWORD); // or the SMTP credentials.
  });
});

describe("when the SMTP server is unavailable", () => {
  it("accounts are still created, reset answers don't change, and logs hold no secrets", async () => {
    // Nothing listens on this port: every send fails with "connection refused".
    const dead = net.createServer();
    await new Promise<void>((r) => dead.listen(0, "127.0.0.1", r));
    const port = (dead.address() as net.AddressInfo).port;
    await new Promise<void>((r) => dead.close(() => r()));

    const lines: string[] = [];
    const logger = createLogger("debug", "test", { write: (s: string) => void lines.push(s) });
    const h = makeCtx();
    const ctx = { ...h.ctx, logger, mailer: createMailer(`smtp://u:${SMTP_PASSWORD}@127.0.0.1:${port}`, { from: "no-reply@lifepilot.test" }, logger) };
    const app = createApp(ctx);

    const agent = supertest.agent(app).set("x-lifepilot-csrf", "1");
    const reg = await agent.post("/api/v1/auth/register").send({ email: "down@example.com", password: "correct-horse-battery", name: "D" }).expect(201);
    expect(reg.body.verificationSent).toBe(false);

    const anon = supertest.agent(app).set("x-lifepilot-csrf", "1");
    const real = await anon.post("/api/v1/auth/request-password-reset").send({ email: "down@example.com" });
    const ghost = await anon.post("/api/v1/auth/request-password-reset").send({ email: "nobody@example.com" });
    expect([real.status, ghost.status]).toEqual([200, 200]);
    expect(real.body).toEqual(ghost.body);

    await waitFor(() => lines.filter((l) => l.includes("Sending email failed")).length === 2);
    const log = lines.join("\n");
    expect(log).toContain("ECONNREFUSED");
    expect(log).not.toContain(SMTP_PASSWORD);
    expect(log).not.toContain("token=");
  });
});

describe("reset and verification links", () => {
  it("reset links expire after an hour", async () => {
    const { app, mailer, setNow } = makeCtx();
    await signUp(app, "late@example.com");
    const anon = supertest.agent(app).set("x-lifepilot-csrf", "1");
    await anon.post("/api/v1/auth/request-password-reset").send({ email: "late@example.com" }).expect(200);
    const token = tokenIn(mailer.outbox.at(-1)!.text);
    setNow(new Date(FIXED_NOW.getTime() + 61 * 60_000));
    expect((await anon.post("/api/v1/auth/reset-password/check").send({ token })).body).toEqual({ valid: false });
    expect((await anon.post("/api/v1/auth/reset-password").send({ token, password: "too-late-password" }).expect(400)).body.error.code).toBe("invalid_token");
    await anon.post("/api/v1/auth/login").send({ email: "late@example.com", password: "correct-horse-battery" }).expect(200);
  });

  it("checking a link never uses it up, and a made-up link is simply invalid", async () => {
    const { app, mailer } = makeCtx();
    await signUp(app, "peek@example.com");
    const anon = supertest.agent(app).set("x-lifepilot-csrf", "1");
    await anon.post("/api/v1/auth/request-password-reset").send({ email: "peek@example.com" }).expect(200);
    const token = tokenIn(mailer.outbox.at(-1)!.text);
    for (let i = 0; i < 3; i++) expect((await anon.post("/api/v1/auth/reset-password/check").send({ token })).body.valid).toBe(true);
    expect((await anon.post("/api/v1/auth/reset-password/check").send({ token: "x".repeat(43) })).body.valid).toBe(false);
    await anon.post("/api/v1/auth/reset-password").send({ token, password: "still-works-12" }).expect(200);
  });

  it("verification links work once and expire after 48 hours", async () => {
    const { app, mailer, setNow } = makeCtx();
    const { agent } = await signUp(app, "verify@example.com");
    const first = mailer.outbox.at(-1)!;
    expect(first.subject).toBe("Verify your LifePilot AI email address");
    expect(first.html).toContain("Verify email</a>");
    const token = tokenIn(first.text);
    await agent.post("/api/v1/auth/verify-email").send({ token }).expect(200);
    await agent.post("/api/v1/auth/verify-email").send({ token }).expect(400); // reused

    const other = await signUp(app, "slow@example.com");
    const stale = tokenIn(mailer.outbox.at(-1)!.text);
    setNow(new Date(FIXED_NOW.getTime() + 49 * 3600_000));
    await other.agent.post("/api/v1/auth/verify-email").send({ token: stale }).expect(400); // expired
  });

  it("development without SMTP never logs the email, its link or its token", async () => {
    const lines: string[] = [];
    const logger = createLogger("debug", "test", { write: (s: string) => void lines.push(s) });
    const h = makeCtx({ env: "development" });
    const mailer = createMailer(undefined, { from: "no-reply@lifepilot.test" }, logger);
    const app = createApp({ ...h.ctx, logger, mailer });
    await signUp(app, "devlog@example.com");
    const res = await supertest(app).post("/api/v1/auth/request-password-reset").set("x-lifepilot-csrf", "1").send({ email: "devlog@example.com" }).expect(200);
    const token = new URL(res.body.devMail.link).searchParams.get("token")!;
    const log = lines.join("\n");
    expect(log).toContain("email not sent (development only)");
    expect(log).not.toContain(token);
    expect(log).not.toContain("token=");
  });
});

describe("mail and support configuration", () => {
  const base = {
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://x@localhost/x",
    SESSION_SECRET: "test-session-secret-test-session-secret-123",
    TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    SMTP_URL: "",
    MAIL_FROM: "LifePilot AI <no-reply@lifepilot.test>",
    MAIL_REPLY_TO: "",
    SUPPORT_EMAIL: "",
    SUPPORT_RESPONSE_TIME: "",
  };

  it("replies go to the support address unless MAIL_REPLY_TO says otherwise", () => {
    expect(loadConfig({ ...base, SUPPORT_EMAIL: "support@lifepilot.test" }).mailReplyTo).toBe("support@lifepilot.test");
    expect(loadConfig({ ...base, SUPPORT_EMAIL: "support@lifepilot.test", MAIL_REPLY_TO: "help@lifepilot.test" }).mailReplyTo).toBe("help@lifepilot.test");
    expect(loadConfig(base).mailReplyTo).toBeNull();
    expect(loadConfig(base).supportEmail).toBeNull();
  });

  it("rejects a sender that could inject mail headers, and an invalid support address", () => {
    expect(() => loadConfig({ ...base, MAIL_FROM: "LifePilot <a@b.test>\r\nBcc: victim@example.com" })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, SUPPORT_EMAIL: "not-an-email" })).toThrow(ConfigError);
  });

  it("production needs SMTP, a real sender domain and https links", () => {
    const prod = { ...base, NODE_ENV: "production", API_URL: "https://api.lifepilot.test", WEB_URL: "https://lifepilot.test" };
    expect(() => loadConfig({ ...prod, SMTP_URL: "" })).toThrow(/SMTP_URL is required/);
    expect(() => loadConfig({ ...prod, SMTP_URL: "smtps://u:p@smtp.test:465", MAIL_FROM: "LifePilot <no-reply@example.com>" })).toThrow(/example\.com placeholder/);
    expect(() => loadConfig({ ...prod, SMTP_URL: "https://smtp.test" })).toThrow(/smtps:\/\/ or smtp:\/\//);
    expect(loadConfig({ ...prod, SMTP_URL: "smtps://u:p@smtp.test:465" }).isProd).toBe(true);
  });

  it("the public config shows the support address and reply time, never mail credentials", async () => {
    const h = makeCtx({ supportEmail: "support@lifepilot.test" });
    const ctx = { ...h.ctx, config: { ...h.ctx.config, supportResponseTime: "within 2 business days", smtpUrl: `smtps://u:${SMTP_PASSWORD}@smtp.test:465` } };
    const res = await supertest(createApp(ctx)).get("/api/v1/config").expect(200);
    expect(res.body.supportEmail).toBe("support@lifepilot.test");
    expect(res.body.supportResponseTime).toBe("within 2 business days");
    expect(JSON.stringify(res.body)).not.toContain(SMTP_PASSWORD);
  });
});
