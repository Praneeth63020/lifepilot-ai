import nodemailer from "nodemailer";
import type { Logger } from "./logger.js";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  readonly configured: boolean;
  send(msg: MailMessage): Promise<void>;
}

/**
 * SMTP mailer when SMTP_URL is set. Otherwise (development only) the message, including
 * any link, is written to the API log so verification/reset flows can be exercised locally.
 * Config validation refuses to start in production without SMTP_URL.
 */
export function createMailer(smtpUrl: string | undefined, from: string, logger: Logger): Mailer & { outbox: MailMessage[] } {
  const outbox: MailMessage[] = [];
  if (!smtpUrl) {
    return {
      configured: false,
      outbox,
      async send(msg) {
        outbox.push(msg);
        if (outbox.length > 50) outbox.shift();
        logger.warn({ to: msg.to, subject: msg.subject, devMailText: msg.text }, "SMTP not configured — email logged instead of sent (dev only)");
      },
    };
  }
  const transport = nodemailer.createTransport(smtpUrl);
  return {
    configured: true,
    outbox,
    async send(msg) {
      await transport.sendMail({ from, to: msg.to, subject: msg.subject, text: msg.text });
    },
  };
}
