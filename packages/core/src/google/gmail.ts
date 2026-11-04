/** Gmail API (read-only). Docs: https://developers.google.com/gmail/api/reference/rest */
import type { FetchLike } from "../context.js";
import { GoogleApiError, googleGet } from "./client.js";

const BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
export const BODY_EXCERPT_MAX = 4000;

interface Header {
  name: string;
  value: string;
}
export interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: Header[];
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
}
export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  historyId?: string;
  payload?: GmailPart;
}

export interface ParsedEmail {
  providerMessageId: string;
  threadId: string;
  subject: string;
  fromAddress: string;
  fromName: string | null;
  receivedAt: Date;
  snippet: string;
  bodyExcerpt: string;
  labels: string[];
  webLink: string;
}

function decodeB64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function findPart(part: GmailPart | undefined, mime: string): GmailPart | undefined {
  if (!part) return undefined;
  if (part.mimeType === mime && part.body?.data && !part.filename) return part;
  for (const p of part.parts ?? []) {
    const hit = findPart(p, mime);
    if (hit) return hit;
  }
  return undefined;
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

export function parseFrom(value: string): { address: string; name: string | null } {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(value);
  if (m) return { name: m[1]!.trim() || null, address: m[2]!.trim().toLowerCase() };
  return { name: null, address: value.trim().toLowerCase() };
}

/** Convert a Gmail message (format=full) to what we store. Only a truncated plain-text excerpt is kept. */
export function parseGmailMessage(msg: GmailMessage): ParsedEmail {
  const headers = msg.payload?.headers ?? [];
  const h = (n: string) => headers.find((x) => x.name.toLowerCase() === n)?.value ?? "";
  const plain = findPart(msg.payload, "text/plain");
  const html = plain ? undefined : findPart(msg.payload, "text/html");
  let body = "";
  if (plain?.body?.data) body = decodeB64Url(plain.body.data);
  else if (html?.body?.data) body = htmlToText(decodeB64Url(html.body.data));
  else if (msg.payload?.body?.data) body = decodeB64Url(msg.payload.body.data);
  const from = parseFrom(h("from"));
  const received = msg.internalDate ? new Date(Number(msg.internalDate)) : new Date(h("date") || Date.now());
  return {
    providerMessageId: msg.id,
    threadId: msg.threadId,
    subject: h("subject").slice(0, 500),
    fromAddress: from.address.slice(0, 320),
    fromName: from.name?.slice(0, 200) ?? null,
    receivedAt: Number.isNaN(received.getTime()) ? new Date() : received,
    snippet: (msg.snippet ?? "").slice(0, 500),
    bodyExcerpt: body.replace(/\r/g, "").slice(0, BODY_EXCERPT_MAX),
    labels: msg.labelIds ?? [],
    webLink: `https://mail.google.com/mail/u/0/#all/${msg.id}`,
  };
}

export async function getProfile(fetchFn: FetchLike, token: string) {
  return googleGet<{ emailAddress: string; historyId: string }>(fetchFn, `${BASE}/profile`, token);
}

/**
 * IDs of recent messages. Not limited to unread: an already-read email can still hold a deadline.
 * Promotions/social are excluded server-side; the importance scorer handles the rest.
 */
export async function listRecentMessageIds(fetchFn: FetchLike, token: string, windowDays: number, max = 200): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  const q = `newer_than:${windowDays}d -category:promotions -category:social -in:chats`;
  do {
    const u = new URL(`${BASE}/messages`);
    u.searchParams.set("q", q);
    u.searchParams.set("maxResults", String(Math.min(100, max - ids.length)));
    if (pageToken) u.searchParams.set("pageToken", pageToken);
    const page = await googleGet<{ messages?: { id: string }[]; nextPageToken?: string }>(fetchFn, u.toString(), token);
    ids.push(...(page.messages ?? []).map((m) => m.id));
    pageToken = page.nextPageToken;
  } while (pageToken && ids.length < max);
  return ids;
}

/** Incremental: IDs added since `startHistoryId`. Returns null if the history id is too old (→ full sync). */
export async function listAddedSince(fetchFn: FetchLike, token: string, startHistoryId: string): Promise<{ ids: string[]; historyId: string } | null> {
  const ids = new Set<string>();
  let pageToken: string | undefined;
  let latest = startHistoryId;
  try {
    do {
      const u = new URL(`${BASE}/history`);
      u.searchParams.set("startHistoryId", startHistoryId);
      u.searchParams.set("historyTypes", "messageAdded");
      u.searchParams.set("maxResults", "500");
      if (pageToken) u.searchParams.set("pageToken", pageToken);
      const page = await googleGet<{
        history?: { messagesAdded?: { message: { id: string; labelIds?: string[] } }[] }[];
        historyId?: string;
        nextPageToken?: string;
      }>(fetchFn, u.toString(), token);
      for (const h of page.history ?? []) {
        for (const m of h.messagesAdded ?? []) {
          const labels = m.message.labelIds ?? [];
          if (labels.includes("CATEGORY_PROMOTIONS") || labels.includes("CATEGORY_SOCIAL") || labels.includes("CHAT")) continue;
          ids.add(m.message.id);
        }
      }
      if (page.historyId) latest = page.historyId;
      pageToken = page.nextPageToken;
    } while (pageToken);
  } catch (err) {
    if (err instanceof GoogleApiError && err.status === 404) return null;
    throw err;
  }
  return { ids: [...ids], historyId: latest };
}

export async function getMessage(fetchFn: FetchLike, token: string, id: string): Promise<GmailMessage> {
  return googleGet<GmailMessage>(fetchFn, `${BASE}/messages/${encodeURIComponent(id)}?format=full`, token);
}
