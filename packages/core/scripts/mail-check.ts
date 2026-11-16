/**
 * Checks the email setup without printing any secret.
 *
 *   pnpm mail:check                          # SET/MISSING report + SMTP login check (sends nothing)
 *   pnpm mail:check --send-to you@domain.com # also sends ONE test email to that address
 *
 * Only the SMTP host, port and TLS mode are shown; the username and password never are.
 */
import { loadConfig } from "../src/config.js";
import { createLogger } from "../src/logger.js";
import { createMailer, describeMailError } from "../src/mailer.js";
import { smtpTestEmail } from "../src/email-templates.js";

const flag = process.argv.indexOf("--send-to");
const sendTo = flag >= 0 ? process.argv[flag + 1] : undefined;

async function main() {
  const config = loadConfig();
  const show = (name: string, value: unknown) => console.log(`${name.padEnd(22)} ${value ? "SET" : "MISSING"}`);
  show("SMTP_URL", config.smtpUrl);
  show("MAIL_FROM", process.env.MAIL_FROM);
  show("MAIL_REPLY_TO", process.env.MAIL_REPLY_TO);
  show("SUPPORT_EMAIL", config.supportEmail);
  show("SUPPORT_RESPONSE_TIME", config.supportResponseTime);
  console.log(`Replies go to          ${config.mailReplyTo ? "the support/reply-to address" : "nowhere set (no Reply-To header)"}`);
  if (/@example\.(com|org|net)>?$/i.test(config.mailFrom)) console.log("Warning: MAIL_FROM still uses the example.com placeholder.");

  if (!config.smtpUrl) {
    console.log("\nNo SMTP_URL: emails are not sent (development only). Nothing to check.");
    return;
  }
  const u = new URL(config.smtpUrl);
  const tls = u.protocol === "smtps:" ? "TLS (smtps)" : config.isProd ? "STARTTLS required" : "STARTTLS if offered";
  console.log(`\nSMTP server            ${u.hostname}:${u.port || (u.protocol === "smtps:" ? 465 : 587)} · ${tls}`);

  const logger = createLogger("error", "mail-check"); // prints the SMTP error code and reply on failure, never credentials
  const mailer = createMailer(config.smtpUrl, { from: config.mailFrom, replyTo: config.mailReplyTo, requireTLS: config.isProd }, logger);
  const ok = await mailer.verify!();
  console.log(`SMTP login             ${ok ? "OK" : "FAILED"}`);
  if (!ok) {
    process.exitCode = 1;
    return;
  }
  if (!sendTo) {
    console.log("\nNo test email sent. Add --send-to <address> to send one.");
    return;
  }
  try {
    await mailer.send({ to: sendTo, ...smtpTestEmail({ webUrl: config.webUrl, supportEmail: config.supportEmail }) });
    console.log(`\nTest email accepted by the SMTP server for ${sendTo}. Check that inbox (and spam).`);
  } catch (err) {
    console.log("\nSending failed:", describeMailError(err));
    process.exitCode = 1;
  }
}

void main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
