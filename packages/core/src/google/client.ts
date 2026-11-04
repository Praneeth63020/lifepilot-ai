/**
 * Minimal Google OAuth 2.0 + REST client over fetch (injectable for tests).
 * Endpoints are Google's documented public endpoints; nothing here runs unless
 * GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI are configured.
 */
import type { FetchLike } from "../context.js";

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type: string;
}

/** The refresh token is invalid/revoked — the user must reconnect. */
export class GoogleAuthRevokedError extends Error {}
export class GoogleApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function buildAuthUrl(cfg: GoogleOAuthConfig, p: { state: string; codeChallenge: string; scopes: string[]; loginHint?: string }): string {
  const u = new URL(GOOGLE_AUTH_URL);
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("redirect_uri", cfg.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", p.scopes.join(" "));
  u.searchParams.set("state", p.state);
  u.searchParams.set("code_challenge", p.codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("access_type", "offline"); // request a refresh token
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("include_granted_scopes", "false");
  if (p.loginHint) u.searchParams.set("login_hint", p.loginHint);
  return u.toString();
}

async function tokenRequest(fetchFn: FetchLike, params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetchFn(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    if (json.error === "invalid_grant") throw new GoogleAuthRevokedError("Google access was revoked or expired");
    throw new GoogleApiError(res.status, `Token endpoint error: ${String(json.error ?? res.status)}`);
  }
  return json as unknown as TokenResponse;
}

export function exchangeCode(fetchFn: FetchLike, cfg: GoogleOAuthConfig, code: string, codeVerifier: string) {
  return tokenRequest(fetchFn, {
    code,
    code_verifier: codeVerifier,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: cfg.redirectUri,
    grant_type: "authorization_code",
  });
}

export function refreshAccessToken(fetchFn: FetchLike, cfg: GoogleOAuthConfig, refreshToken: string) {
  return tokenRequest(fetchFn, {
    refresh_token: refreshToken,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: "refresh_token",
  });
}

export async function revokeToken(fetchFn: FetchLike, token: string): Promise<boolean> {
  const res = await fetchFn(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
  return res.ok;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET a Google API JSON resource with retry on 429/5xx (exponential backoff, honours Retry-After). */
export async function googleGet<T>(fetchFn: FetchLike, url: string, accessToken: string, opts: { retries?: number; baseDelayMs?: number } = {}): Promise<T> {
  const retries = opts.retries ?? 4;
  const base = opts.baseDelayMs ?? 500;
  for (let attempt = 0; ; attempt++) {
    const res = await fetchFn(url, { headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" } });
    if (res.ok) return (await res.json()) as T;
    if (res.status === 401) throw new GoogleAuthRevokedError("Access token rejected");
    const retryable = res.status === 429 || res.status >= 500 || res.status === 403 && /rateLimit/i.test(await res.clone().text());
    if (!retryable || attempt >= retries) {
      const text = await res.text().catch(() => "");
      throw new GoogleApiError(res.status, `Google API ${res.status}: ${text.slice(0, 200)}`);
    }
    const retryAfter = Number(res.headers.get("retry-after"));
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : base * 2 ** attempt);
  }
}
