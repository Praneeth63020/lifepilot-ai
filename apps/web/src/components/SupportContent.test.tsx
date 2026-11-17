import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfigDTO } from "@lifepilot/shared";
import { SupportContactCard, SupportTopics } from "./SupportContent";

let config: Partial<AppConfigDTO> | null = null;
vi.mock("../session", () => ({ useSession: () => ({ config, me: null, loading: false }) }));

afterEach(cleanup);
const renderIn = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("support contact", () => {
  beforeEach(() => {
    config = null;
  });

  it("shows the configured support address as a mail link, with the reply time only when set", () => {
    config = { supportEmail: "support@lifepilot.test", supportResponseTime: null };
    const { unmount } = renderIn(<SupportContactCard />);
    const link = screen.getByTestId("support-email");
    expect(link).toHaveTextContent("support@lifepilot.test");
    expect(link.getAttribute("href")).toMatch(/^mailto:support@lifepilot\.test\?subject=/);
    expect(screen.queryByText(/We usually reply/)).toBeNull();
    unmount();

    config = { supportEmail: "support@lifepilot.test", supportResponseTime: "within 2 business days" };
    renderIn(<SupportContactCard />);
    expect(screen.getByText("We usually reply within 2 business days.")).toBeInTheDocument();
  });

  it("never invents an address when none is configured", () => {
    config = { supportEmail: null, supportResponseTime: null };
    renderIn(
      <>
        <SupportContactCard />
        <SupportTopics />
      </>,
    );
    expect(screen.getByText(/A support email address is coming soon/)).toBeInTheDocument();
    expect(document.querySelector('a[href^="mailto:"]')).toBeNull();
  });

  it("points people to self-service password reset before support", () => {
    config = { supportEmail: "support@lifepilot.test", supportResponseTime: null };
    renderIn(<SupportTopics />);
    expect(screen.getByRole("link", { name: "reset it here" })).toHaveAttribute("href", "/forgot-password");
    expect(screen.getAllByRole("link", { name: /Email us about this/ })[0]!.getAttribute("href")).toContain("subject=Account%20help");
  });
});
