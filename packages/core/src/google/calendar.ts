/** Google Calendar API (read-only). Docs: https://developers.google.com/calendar/api/v3/reference */
import { DateTime } from "luxon";
import type { FetchLike } from "../context.js";
import { googleGet } from "./client.js";

const BASE = "https://www.googleapis.com/calendar/v3";

export interface GCalEvent {
  id: string;
  status?: "confirmed" | "tentative" | "cancelled";
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  recurringEventId?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  transparency?: "opaque" | "transparent";
}

export interface MappedEvent {
  providerEventId: string;
  recurringEventId: string | null;
  title: string;
  description: string | null;
  location: string | null;
  startAt: Date;
  endAt: Date;
  allDay: boolean;
  timezone: string | null;
  status: string;
  htmlLink: string | null;
}

/**
 * Timed events carry an RFC3339 offset and map directly to UTC instants.
 * All-day events ("date") are interpreted as local midnights in the calendar's timezone
 * (falling back to the user's), so they render on the right day across DST.
 */
export function mapGoogleEvent(ev: GCalEvent, fallbackTz: string): MappedEvent | null {
  if (!ev.start || !ev.end) return null;
  const allDay = Boolean(ev.start.date && !ev.start.dateTime);
  const tz = ev.start.timeZone ?? fallbackTz;
  let startAt: Date;
  let endAt: Date;
  if (allDay) {
    startAt = DateTime.fromISO(ev.start.date!, { zone: tz }).startOf("day").toJSDate();
    endAt = DateTime.fromISO(ev.end.date!, { zone: tz }).startOf("day").toJSDate();
  } else {
    startAt = new Date(ev.start.dateTime!);
    endAt = new Date(ev.end.dateTime!);
  }
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) return null;
  return {
    providerEventId: ev.id,
    recurringEventId: ev.recurringEventId ?? null,
    title: (ev.summary ?? "(no title)").slice(0, 500),
    description: ev.description?.slice(0, 2000) ?? null,
    location: ev.location?.slice(0, 300) ?? null,
    startAt,
    endAt,
    allDay,
    timezone: ev.start.timeZone ?? null,
    status: ev.status ?? "confirmed",
    htmlLink: ev.htmlLink ?? null,
  };
}

/** Primary-calendar events in [timeMin, timeMax], recurring series expanded into instances. */
export async function listEvents(fetchFn: FetchLike, token: string, timeMin: Date, timeMax: Date, max = 2500): Promise<{ items: GCalEvent[]; timeZone?: string }> {
  const items: GCalEvent[] = [];
  let pageToken: string | undefined;
  let timeZone: string | undefined;
  do {
    const u = new URL(`${BASE}/calendars/primary/events`);
    u.searchParams.set("singleEvents", "true");
    u.searchParams.set("orderBy", "startTime");
    u.searchParams.set("showDeleted", "false");
    u.searchParams.set("timeMin", timeMin.toISOString());
    u.searchParams.set("timeMax", timeMax.toISOString());
    u.searchParams.set("maxResults", "250");
    if (pageToken) u.searchParams.set("pageToken", pageToken);
    const page = await googleGet<{ items?: GCalEvent[]; nextPageToken?: string; timeZone?: string }>(fetchFn, u.toString(), token);
    items.push(...(page.items ?? []));
    timeZone ??= page.timeZone;
    pageToken = page.nextPageToken;
  } while (pageToken && items.length < max);
  return { items, timeZone };
}

export async function getPrimaryCalendar(fetchFn: FetchLike, token: string) {
  return googleGet<{ id: string; timeZone?: string }>(fetchFn, `${BASE}/calendars/primary`, token);
}
