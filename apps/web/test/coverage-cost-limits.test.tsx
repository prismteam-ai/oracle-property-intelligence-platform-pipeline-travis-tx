// A-16 T041 (AC-3..AC-5; TC-007, TC-008, TC-009): the Coverage "Source speed and constraints" and
// "Cost" sections show exactly what the generated JSON (and so the docs) say, with "as of" and the
// source, gross apart from credits, a partial day apart, "not available · reason" instead of a
// zero, and "Blocked" with its dates for a source that never became reachable.
import { cleanup, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import raw from "../src/content/cost-limits.generated.json";
import { CostLimits } from "../src/content/cost-limits.schema";
import { CostSection, SourceSpeed, centsInText, usd } from "../src/routes/CoverageCostLimits";

const data = CostLimits.parse(raw);

afterEach(cleanup);

describe("Cost section", () => {
  it("prints amounts in cents, and a non-zero amount under a cent as < $0.01", () => {
    expect(usd(9.2469)).toBe("$9.25");
    expect(usd(-9.2469)).toBe("-$9.25");
    expect(usd(0)).toBe("$0.00");
    expect(usd(0.0017)).toBe("< $0.01");
    expect(centsInText("S3 $0.0277 (requests $0.027, storage $0.0007); $0.00 fixed")).toBe(
      "S3 $0.03 (requests $0.03, storage < $0.01); $0.00 fixed",
    );
  });

  it("shows the fixed headline, 'as of' and the source", () => {
    const { container } = render(<CostSection />);
    const section = container.querySelector<HTMLElement>('[data-section="cost"]');
    expect(section).not.toBeNull();
    const view = within(section as HTMLElement);
    expect(view.getByText(`${data.cost.fixedPerMonth} fixed per month`)).toBeTruthy();
    const asOf = (section as HTMLElement).querySelector("[data-as-of]");
    expect(asOf?.getAttribute("data-as-of")).toBe(data.cost.asOf);
    expect(asOf?.textContent).toContain(`as of ${data.cost.asOf}`);
    expect(asOf?.textContent).toContain(data.cost.source);
  });

  it("has one row per doc component with idle cost, who pays and the bill line", () => {
    const { container } = render(<CostSection />);
    for (const row of data.cost.rows) {
      const tr = [...container.querySelectorAll<HTMLElement>("[data-cost-row]")].find(
        (el) => el.getAttribute("data-cost-row") === row.component,
      );
      expect(tr, row.component).toBeDefined();
      if (row.idle !== null) expect(tr?.textContent).toContain(centsInText(row.idle));
      if (row.whoPays !== null) expect(tr?.textContent).toContain(row.whoPays);
    }
    for (const name of [
      "Amplify",
      "Lambda",
      "API Gateway",
      "DynamoDB",
      "SSM",
      "CloudWatch",
      "Scheduler",
      "Cognito",
      "SQS",
      "SNS",
    ]) {
      expect(
        data.cost.rows.some((r) => r.component.includes(name)),
        name,
      ).toBe(true);
    }
  });

  it("shows gross usage and credits apart, with the amounts from the doc", () => {
    const { container } = render(<CostSection />);
    const gross = container.querySelector('[data-tile="gross"]');
    const credits = container.querySelector('[data-tile="credits"]');
    expect(gross?.textContent).toContain(usd(data.cost.gross.usd ?? NaN));
    expect(credits?.textContent).toContain(usd(data.cost.credits.usd ?? NaN));
    expect(gross?.textContent).not.toBe(credits?.textContent);
  });

  it("says Filebase usage is not available with the reason, and never a zero (TC-009)", () => {
    const { container } = render(<CostSection />);
    const row = container.querySelector<HTMLElement>('[data-cost-row^="Filebase"]');
    const reason = data.cost.rows.find((r) => r.component.startsWith("Filebase"))?.missingReason;
    expect(reason).toBeTruthy();
    const idleCell = row?.querySelector('[data-label="Fixed (idle) per month"]');
    expect(idleCell?.textContent).toBe(`Filebase usage: not available · ${reason ?? ""}`);
    expect(idleCell?.textContent).not.toMatch(/\$0|\b0\b/);
  });

  it("shows a partial day apart from the totals, as 'Partial (as of …)' (TC-008)", () => {
    const { container } = render(<CostSection />);
    const partial = data.cost.partialDay;
    const notice = container.querySelector("[data-partial-day]");
    if (partial === null) {
      expect(notice).toBeNull();
      return;
    }
    expect(notice?.textContent).toContain(`Partial (as of ${data.cost.asOf})`);
    expect(notice?.textContent).toContain(partial.day);
    // No row or tile is dated after the last billed day.
    expect(container.querySelector('[data-tile="gross"]')?.textContent).not.toContain(partial.day);
  });
});

describe("Source speed and constraints", () => {
  it("has one row per source with its throughput cell from the doc", () => {
    const { container } = render(<SourceSpeed />);
    expect(container.querySelector("[data-as-of]")?.getAttribute("data-as-of")).toBe(
      data.limits.asOf,
    );
    for (const row of data.limits.rows) {
      const tr = [...container.querySelectorAll<HTMLElement>("[data-limit-source]")].find(
        (el) => el.getAttribute("data-limit-source") === row.source,
      );
      expect(tr, row.source).toBeDefined();
      expect(tr?.getAttribute("data-status")).toBe(row.status);
      if (row.status === "measured") expect(tr?.textContent).toContain(row.throughput ?? "");
    }
  });

  it("shows a blocked source as 'Blocked' with its dates and no throughput", () => {
    const { container } = render(<SourceSpeed />);
    const blocked = data.limits.rows.filter((r) => r.status === "blocked");
    expect(blocked.length).toBeGreaterThan(0);
    for (const row of blocked) {
      const tr = [...container.querySelectorAll<HTMLElement>("[data-limit-source]")].find(
        (el) => el.getAttribute("data-limit-source") === row.source,
      );
      expect(within(tr as HTMLElement).getByText("Blocked")).toBeTruthy();
      expect(tr?.querySelector("[data-blocked-dates]")?.getAttribute("data-blocked-dates")).toBe(
        row.blockedDates.join(","),
      );
      expect(tr?.querySelector('[data-label="Throughput"]')?.textContent).not.toMatch(
        /Not measured|Not available|\d+ (rows|features|MB)/,
      );
    }
  });

  it("shows a source that was not measured as 'Not available · reason'", () => {
    const { container } = render(<SourceSpeed />);
    for (const row of data.limits.rows.filter((r) => r.status === "not_measured")) {
      const tr = [...container.querySelectorAll<HTMLElement>("[data-limit-source]")].find(
        (el) => el.getAttribute("data-limit-source") === row.source,
      );
      expect(tr?.textContent).toContain(`Not available · ${row.missingReason ?? ""}`);
    }
  });
});
