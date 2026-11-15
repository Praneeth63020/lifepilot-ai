import { act, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it } from "vitest";
import { ToastProvider, useToast } from "./toast";

function ShowReminderToast() {
  const toast = useToast();
  useEffect(() => {
    toast({ title: "Due now: Pay rent", tone: "info", actions: [{ label: "Snooze 15 min", onClick: () => {} }, { label: "Dismiss", onClick: () => {} }] });
  }, [toast]);
  return null;
}

describe("toasts", () => {
  it("keeps the close button distinct from a 'Dismiss' action", async () => {
    await act(async () => {
      render(
        <ToastProvider>
          <ShowReminderToast />
        </ToastProvider>,
      );
    });
    // Two buttons named "Dismiss" (one closing the toast, one dismissing the notification) were
    // indistinguishable for keyboard and screen-reader users.
    expect(screen.getAllByRole("button", { name: "Dismiss" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Close message" })).toBeInTheDocument();
  });
});
