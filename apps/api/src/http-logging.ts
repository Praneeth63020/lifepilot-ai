/**
 * Request-log hygiene. Query strings can carry one-time credentials: the Google OAuth callback
 * receives `code` and `state`, and other flows may pass tokens. They are replaced before logging.
 */
const SENSITIVE_QUERY_KEYS = ["code", "state", "token", "access_token", "refresh_token", "id_token", "password"];
const QUERY_RX = new RegExp(`([?&](?:${SENSITIVE_QUERY_KEYS.join("|")})=)[^&#]*`, "gi");

export function redactUrl(url: string | undefined): string | undefined {
  return url?.replace(QUERY_RX, "$1[redacted]");
}

/** pino-http `req` serializer: receives the standard serialized request and scrubs it. */
export function serializeRequest<T extends { url?: string; query?: Record<string, unknown> }>(req: T): T {
  const query = req.query ? { ...req.query } : undefined;
  if (query) for (const k of Object.keys(query)) if (SENSITIVE_QUERY_KEYS.includes(k.toLowerCase())) query[k] = "[redacted]";
  return { ...req, url: redactUrl(req.url), ...(query ? { query } : {}) };
}
