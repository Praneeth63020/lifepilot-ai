import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { useTabs } from "./ui";

const IDS = ["General", "Notifications", "Security"] as const;
function Demo() {
  const [tab, setTab] = useState<(typeof IDS)[number]>("General");
  const t = useTabs("demo", IDS, tab, setTab);
  return (
    <>
      <div role="tablist" aria-label="Sections">
        {IDS.map((id) => <button key={id} {...t.tabProps(id)}>{id}</button>)}
      </div>
      <div {...t.panelProps}>{tab} content</div>
    </>
  );
}

describe("useTabs", () => {
  it("links tabs to their panel and supports arrow keys, Home and End", () => {
    render(<Demo />);
    const general = screen.getByRole("tab", { name: "General" });
    expect(general).toHaveAttribute("aria-selected", "true");
    expect(general).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: "Security" })).toHaveAttribute("tabindex", "-1"); // one Tab stop
    const panel = screen.getByRole("tabpanel");
    expect(general).toHaveAttribute("aria-controls", panel.id);
    expect(panel).toHaveAttribute("aria-labelledby", general.id);

    fireEvent.keyDown(general, { key: "ArrowRight" });
    const notifications = screen.getByRole("tab", { name: "Notifications" });
    expect(notifications).toHaveAttribute("aria-selected", "true");
    expect(notifications).toHaveFocus();
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Notifications content");

    fireEvent.keyDown(notifications, { key: "End" });
    expect(screen.getByRole("tab", { name: "Security" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("tab", { name: "Security" }), { key: "ArrowRight" }); // wraps
    expect(screen.getByRole("tab", { name: "General" })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(screen.getByRole("tab", { name: "General" }), { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "Security" })).toHaveAttribute("aria-selected", "true");
  });
});
