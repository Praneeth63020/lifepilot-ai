import { describe, expect, it } from "vitest";
import { decrypt, encrypt, mapGoogleEvent, parseFrom, parseGmailMessage, pkceChallenge } from "../src/index.js";

const b64 = (s: string) => Buffer.from(s).toString("base64url");

describe("Gmail message parsing", () => {
  it("prefers text/plain, records ids for dedup, and truncates the body", () => {
    const long = "x".repeat(10_000);
    const p = parseGmailMessage({
      id: "abc",
      threadId: "t1",
      internalDate: "1793000000000",
      labelIds: ["INBOX"],
      payload: {
        mimeType: "multipart/alternative",
        headers: [
          { name: "Subject", value: "Hello" },
          { name: "From", value: '"Jane Doe" <Jane@Example.com>' },
        ],
        parts: [
          { mimeType: "text/html", body: { data: b64("<p>html</p>") } },
          { mimeType: "text/plain", body: { data: b64(`plain ${long}`) } },
        ],
      },
    });
    expect(p.providerMessageId).toBe("abc");
    expect(p.threadId).toBe("t1");
    expect(p.fromAddress).toBe("jane@example.com");
    expect(p.fromName).toBe("Jane Doe");
    expect(p.bodyExcerpt.startsWith("plain")).toBe(true);
    expect(p.bodyExcerpt.length).toBe(4000);
  });

  it("falls back to stripped HTML", () => {
    const p = parseGmailMessage({ id: "1", threadId: "1", payload: { mimeType: "text/html", body: { data: b64("<style>x{}</style><p>Pay by <b>Friday</b></p>") } } });
    expect(p.bodyExcerpt).toBe("Pay by Friday");
    expect(parseFrom("plain@example.com")).toEqual({ address: "plain@example.com", name: null });
  });
});

describe("Google Calendar mapping", () => {
  it("maps timed events with offsets to UTC", () => {
    const e = mapGoogleEvent({ id: "e1", summary: "Sync", start: { dateTime: "2026-11-02T15:00:00+05:30" }, end: { dateTime: "2026-11-02T16:00:00+05:30" } }, "UTC")!;
    expect(e.startAt.toISOString()).toBe("2026-11-02T09:30:00.000Z");
    expect(e.allDay).toBe(false);
  });

  it("maps all-day events to local midnights across DST", () => {
    const e = mapGoogleEvent({ id: "e2", start: { date: "2026-11-01" }, end: { date: "2026-11-02" } }, "America/New_York")!;
    expect(e.allDay).toBe(true);
    expect(e.startAt.toISOString()).toBe("2026-11-01T04:00:00.000Z"); // EDT midnight
    expect(e.endAt.toISOString()).toBe("2026-11-02T05:00:00.000Z"); // EST midnight (25h day)
    expect(e.title).toBe("(no title)");
  });

  it("keeps recurring instance ids", () => {
    const e = mapGoogleEvent({ id: "e3_20261102", recurringEventId: "e3", start: { dateTime: "2026-11-02T10:00:00Z" }, end: { dateTime: "2026-11-02T11:00:00Z" } }, "UTC")!;
    expect(e.recurringEventId).toBe("e3");
  });
});

describe("crypto", () => {
  it("round-trips AES-GCM and detects tampering", () => {
    const key = Buffer.alloc(32, 1);
    const c = encrypt("refresh-token", key);
    expect(decrypt(c, key)).toBe("refresh-token");
    const parts = c.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decrypt(parts.join("."), key)).toThrow();
  });

  it("computes RFC 7636 S256 challenges", () => {
    // Test vector from RFC 7636 Appendix B.
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
});
