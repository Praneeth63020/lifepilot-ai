import nodemailer, { type Transporter } from "nodemailer";
import type { Logger } from "./logger.js";

export interface MailMessage {
  to: string;
  subject: string;
  /** Plain-text version; always sent, for clients that don't show HTML. */
  text: string;
  html?: string;
}

export interface Mailer {
  readonly configured: boolean;
  send(msg: MailMessage): Promise<void>;
  /** Checks the SMTP connection and login without sending anything. */
  verify?(): Promise<boolean>;
}

export interface MailerOptions {
  /** "LifePilot AI <no-reply@yourdomain.com>" */
  from: string;
  /** Where customer replies go (the support inbox). */
  replyTo?: string | null;
  /** Refuse to send unless the connection is encrypted (TLS, or STARTTLS on smtp://). */
  requireTLS?: boolean;
}

/** A mailer on any nodemailer transport. Used for SMTP, and directly by tests with an in-memory transport. */
export function createTransportMailer(transport: Transporter, opts: MailerOptions, logger: Logger): Mailer {
  return {
    configured: true,
    async send(msg) {
      await transport.sendMail({
        from: opts.from,
        ...(opts.replyTo ? { replyTo: opts.replyTo } : {}),
        to: msg.to,
        subject: msg.subject,
        text: msg.text,
        ...(msg.html ? { html: msg.html } : {}),
      });
    },
    async verify() {
      try {
        await transport.verify();
        return true;
      } catch (err) {
        logger.error({ err: describeMailError(err) }, "SMTP connection check failed");
        return false;
      }
    },
  };
}

/**
 * SMTP mailer when SMTP_URL is set (any standard SMTP provider). Without it (development only;
 * config refuses to start in production) nothing is sent: the message goes to an in-memory outbox,
 * and the API can hand reset/verification links straight to a page opened on the same machine.
 * Neither mode ever writes the message body, and so never a link or token, to the logs.
 */
export function createMailer(smtpUrl: string | undefined, opts: MailerOptions, logger: Logger): Mailer & { outbox: MailMessage[] } {
  const outbox: MailMessage[] = [];
  if (!smtpUrl) {
    return {
      configured: false,
      outbox,
      async send(msg) {
        outbox.push(msg);
        if (outbox.length > 50) outbox.shift();
        logger.warn({ subject: msg.subject }, "SMTP_URL not set — email not sent (development only)");
      },
    };
  }
  const transport = nodemailer.createTransport({
    url: smtpUrl,
    requireTLS: opts.requireTLS ?? false,
    // Fail fast instead of holding a request open on an unreachable server.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return { ...createTransportMailer(transport, opts, logger), outbox };
}

/** Error details that are safe to log: SMTP codes and the server's reply, never credentials. */
export function describeMailError(err: unknown) {
  if (!(err instanceof Error)) return { message: String(err) };
  const e = err as Error & { code?: string; responseCode?: number; command?: string };
  return { message: e.message, code: e.code, responseCode: e.responseCode, command: e.command };
}
