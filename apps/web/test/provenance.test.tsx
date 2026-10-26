// A-03 T053 (G-C4): `<Provenance/>` is the Atlas § 8 provenance line (body-small,
// on-surface-variant, leading `description` icon). For a permit row it shows the source URL as
// a link, the capture time, the table CID (full value in `data-cid` and `title`, middle-truncated
// text, copy button) and the run ID (FR-003, TC-021). A null source URL shows the Missing-reason
// label, never a blank. The generic form renders any children on the same line (Runs card).
// Red run (before T055): `Cannot find module '../src/components/Provenance'`.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MISSING_REASON_LABELS } from "@countylens/shared";
import { CidDisplay, truncateCid } from "../src/components/CidDisplay";
import { Provenance, formatUtc } from "../src/components/Provenance";

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

/** A syntactically valid, obviously synthetic base32 CIDv1 (contract `isCidV1`). */
const TABLE_CID = "bafkreitableparttestcid".padEnd(59, "a");
const SOURCE_URL = "https://source.test/resource/TEST-0001.json";
const CAPTURED_AT = "2026-10-20T14:02:05.000Z";

describe("Provenance: the permit row line (plan § Atlas element map → Row provenance)", () => {
  it("shows the source URL as a link, the capture time, the table CID and the run", () => {
    const { container } = render(
      <Provenance
        sourceUrl={SOURCE_URL}
        capturedAt={CAPTURED_AT}
        tableCid={TABLE_CID}
        runId="test-run"
      />,
    );
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe(SOURCE_URL);
    expect(link.textContent).toBe(SOURCE_URL);

    const time = container.querySelector("time");
    expect(time?.getAttribute("datetime")).toBe(CAPTURED_AT);
    expect(time?.textContent).toBe(formatUtc(CAPTURED_AT));

    const cid = container.querySelector("[data-cid]");
    expect(cid?.getAttribute("data-cid")).toBe(TABLE_CID);
    expect(cid?.getAttribute("title")).toBe(TABLE_CID);

    const text = container.textContent?.replace(/\s+/g, " ") ?? "";
    expect(text).toContain("Source:");
    expect(text).toContain(`collected ${formatUtc(CAPTURED_AT)} UTC`);
    expect(text).toContain(`table ${truncateCid(TABLE_CID)}`);
    expect(text).toContain("run test-run");

    const icon = container.querySelector(".material-symbols-rounded");
    expect(icon?.getAttribute("data-icon")).toBe("description");
    expect(icon?.textContent).toBe("");
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
  });

  it("shows the Missing-reason label when the source URL is absent, never a blank", () => {
    const { container } = render(
      <Provenance
        sourceUrl={null}
        sourceUrlMissing={{ field: "source_url", reason: "not_in_export" }}
        capturedAt={CAPTURED_AT}
        tableCid={TABLE_CID}
        runId="test-run"
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(MISSING_REASON_LABELS.not_in_export)).toBeTruthy();
    expect(container.textContent).toContain("run test-run");
  });

  it("renders any children on the same § 8 line (the Runs card form)", () => {
    const { container } = render(<Provenance>Index: this site (/runs/index.json)</Provenance>);
    expect(container.textContent).toContain("Index: this site (/runs/index.json)");
    expect(container.querySelector(".material-symbols-rounded")?.getAttribute("data-icon")).toBe(
      "description",
    );
  });
});

describe("CidDisplay (plan § Atlas element map → CID display)", () => {
  it("truncates to the first 4 characters, an ellipsis and the last 4", () => {
    expect(truncateCid("bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi")).toBe(
      "bafy…bzdi",
    );
    expect(truncateCid(TABLE_CID)).toBe(`bafk…${TABLE_CID.slice(-4)}`);
  });

  it("keeps the full CID in data-cid and title, shows the truncated text in the mono face, and copies the full value", () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const { container } = render(<CidDisplay cid={TABLE_CID} />);
    const root = container.querySelector("[data-cid]");
    expect(root?.getAttribute("data-cid")).toBe(TABLE_CID);
    expect(root?.getAttribute("title")).toBe(TABLE_CID);
    const code = container.querySelector("code");
    expect(code?.textContent).toBe(truncateCid(TABLE_CID));
    const button = within(container).getByRole("button", { name: /copy/i });
    fireEvent.click(button);
    expect(writeText).toHaveBeenCalledWith(TABLE_CID);
  });
});

describe("formatUtc", () => {
  it("renders an ISO instant as a UTC calendar time without the T and Z", () => {
    expect(formatUtc("2026-10-20T14:02:05Z")).toBe("2026-10-20 14:02:05");
    expect(formatUtc("2026-10-20T14:02:05.123Z")).toBe("2026-10-20 14:02:05");
  });
});
