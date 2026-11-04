import pino, { type Logger } from "pino";

/** Structured JSON logger with secrets and personal content redacted. */
export function createLogger(level: string, name: string): Logger {
  return pino({
    name,
    level,
    redact: {
      paths: [
        "req.headers.cookie",
        "req.headers.authorization",
        "res.headers['set-cookie']",
        "*.password",
        "*.passwordHash",
        "*.accessToken",
        "*.refreshToken",
        "*.access_token",
        "*.refresh_token",
        "*.code_verifier",
        "*.client_secret",
        "*.token",
        "*.bodyExcerpt",
        "*.body",
      ],
      censor: "[redacted]",
    },
  });
}

export type { Logger };
