// A-13 follow-up: ErrorBanner takes a string (A-03) or a ReactNode message, so the run pages
// share it instead of a copy. The fixed texts render exactly.
import { RUNS_TEXTS } from "@countylens/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ErrorBanner } from "../src/components/ErrorBanner";
import { runErrorNode } from "../src/routes/Runs.shared";

afterEach(cleanup);

describe("ErrorBanner", () => {
  it("renders a string message as before", () => {
    render(<ErrorBanner message="Something failed" />);
    expect(screen.getByRole("alert").textContent).toContain("Something failed");
  });

  it("renders a node message with the run error wording exactly", () => {
    const { rerender } = render(
      <ErrorBanner message={runErrorNode({ kind: "index", reason: "HTTP 404" })} />,
    );
    expect(screen.getByRole("alert").querySelector("[data-error-text]")?.textContent).toBe(
      RUNS_TEXTS.indexUnavailable("HTTP 404"),
    );
    rerender(
      <ErrorBanner
        message={runErrorNode({ kind: "manifest", cid: "bafkreiabc", reason: "not JSON" })}
      />,
    );
    expect(screen.getByRole("alert").querySelector("[data-error-text]")?.textContent).toBe(
      RUNS_TEXTS.manifestUnavailable("bafkreiabc", "not JSON"),
    );
  });
});
