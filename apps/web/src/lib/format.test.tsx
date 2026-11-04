import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PriorityBadge } from "../components/ui";
import { isoToZoned, localISODate, zonedToISO } from "./format";

describe("timezone input conversion", () => {
  it("round-trips wall time in Asia/Kolkata", () => {
    const iso = zonedToISO("2026-11-02", "17:00", "Asia/Kolkata");
    expect(iso).toBe("2026-11-02T11:30:00.000Z");
    expect(isoToZoned(iso, "Asia/Kolkata")).toEqual({ date: "2026-11-02", time: "17:00" });
  });

  it("handles DST in New York", () => {
    expect(zonedToISO("2026-03-08", "09:00", "America/New_York")).toBe("2026-03-08T13:00:00.000Z");
    expect(zonedToISO("2026-03-07", "09:00", "America/New_York")).toBe("2026-03-07T14:00:00.000Z");
    expect(localISODate(new Date("2026-11-02T03:00:00Z"), "America/Los_Angeles")).toBe("2026-11-01");
  });
});

describe("PriorityBadge", () => {
  it("renders an accessible label", () => {
    render(<PriorityBadge priority="urgent" />);
    expect(screen.getByTitle("urgent priority")).toHaveTextContent("urgent");
  });
});
