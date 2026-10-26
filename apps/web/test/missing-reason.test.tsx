// A-03 T053 (G-C4): `<MissingReason/>` renders the approved label of a `{field, reason}` entry
// as visible text (FR-003, FR-005, FR-011; plan § "Atlas element map" → Missing-reason element:
// the § 8 Not-available pill extended so the reason is readable without hover, TC-022). It never
// renders a blank, "—", "N/A" or the raw code, and the contractor `source_missing` override
// applies (D-2). Red run (before T055): `Cannot find module '../src/components/MissingReason'`.
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MISSING_REASONS, type MissingReason as Reason } from "@countylens/contract";
import {
  CONTRACTOR_NOT_PRINTED_LABEL,
  MISSING_REASON_LABELS,
  missingLabel,
} from "@countylens/shared";
import { MissingReason } from "../src/components/MissingReason";

afterEach(() => {
  document.body.innerHTML = "";
});

const BLANKS = ["", "—", "-", "N/A", "n/a", "null", "undefined", "NaN"];

describe("MissingReason (plan § Atlas element map → Missing-reason element)", () => {
  it.each(MISSING_REASONS)("renders the approved label of %s as visible text", (reason: Reason) => {
    const field = "some_field";
    const { container } = render(<MissingReason field={field} reason={reason} />);
    const pill = container.firstElementChild;
    expect(pill, "one root element").not.toBeNull();
    const text = pill?.textContent?.replace(/\s+/g, " ").trim() ?? "";
    expect(text).toBe(missingLabel(field, reason));
    expect(text).toBe(MISSING_REASON_LABELS[reason]);
    expect(BLANKS).not.toContain(text);
    expect(text).not.toBe(reason);
    // The label is text, not only a title attribute or a tooltip.
    expect(screen.getByText(missingLabel(field, reason))).toBeTruthy();
  });

  it("carries the field and reason as data attributes for the row-detail readers (TC-022)", () => {
    const { container } = render(<MissingReason field="status_raw" reason="no_lexicon_carrier" />);
    const pill = container.firstElementChild;
    expect(pill?.getAttribute("data-field")).toBe("status_raw");
    expect(pill?.getAttribute("data-reason")).toBe("no_lexicon_carrier");
  });

  it("is the Not-available pill: the do_not_disturb_on glyph, hidden from assistive tech", () => {
    const { container } = render(<MissingReason field="expiry_date" reason="no_lexicon_carrier" />);
    const icon = container.querySelector(".material-symbols-rounded");
    // The glyph is CSS generated content from data-icon, so the pill's text is the label alone.
    expect(icon?.getAttribute("data-icon")).toBe("do_not_disturb_on");
    expect(icon?.textContent).toBe("");
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
    expect(container.firstElementChild?.getAttribute("data-status")).toBe("unavailable");
  });

  it("applies the contractor override for source_missing, and only there (D-2)", () => {
    render(<MissingReason field="contractor_company_cid" reason="source_missing" />);
    expect(screen.getByText(CONTRACTOR_NOT_PRINTED_LABEL)).toBeTruthy();
    expect(screen.queryByText(MISSING_REASON_LABELS.source_missing)).toBeNull();
    document.body.innerHTML = "";
    render(<MissingReason field="permit_number" reason="source_missing" />);
    expect(screen.getByText(MISSING_REASON_LABELS.source_missing)).toBeTruthy();
    expect(screen.queryByText(CONTRACTOR_NOT_PRINTED_LABEL)).toBeNull();
  });

  it("never renders without a label: an unknown reason throws naming it instead of a blank pill", () => {
    const unknown = "not_a_reason" as Reason;
    expect(() => render(<MissingReason field="x" reason={unknown} />)).toThrow(/not_a_reason/);
  });
});
