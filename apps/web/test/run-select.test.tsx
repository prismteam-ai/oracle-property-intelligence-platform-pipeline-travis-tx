// RunSelect (PO 2026-10-26: a run list with only run + date is a dropdown, the same on every
// page): runs newest first as "Run N · Mon D, YYYY", the latest marked, the chosen run selected,
// an optional "all runs" choice reported as null, and a labelled native select.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RunSelect } from "../src/components/RunSelect";
import { latestChip } from "../src/data/hub-index";
import {
  PILOT_RUN_IDS,
  compareQuery,
  numberedRuns,
  runDate,
  runName,
  runNumbers,
  runOptionLabel,
} from "../src/data/runs-index";
import type { RunsIndexV1 } from "@countylens/contract";

// Out of order on purpose: numbering follows finishedAt, not array order.
const RUNS = [
  { runId: "run-c", manifestCid: "bafkc", finishedAt: "2026-10-25T12:44:21Z" },
  { runId: "run-a", manifestCid: "bafka", finishedAt: "2026-10-21T10:40:04.543Z" },
  { runId: "run-b", manifestCid: "bafkb", finishedAt: "2026-10-24T18:20:49Z" },
];

afterEach(cleanup);

const select = (name = "Run"): HTMLSelectElement => screen.getByRole("combobox", { name });

describe("runOptionLabel", () => {
  it("reads Run N · Mon D, YYYY in UTC, or Pilot slice · Mon D, YYYY", () => {
    expect(runOptionLabel(4, "2026-10-25T23:59:59Z")).toBe("Run 4 · Oct 25, 2026");
    expect(runOptionLabel(null, "2026-10-21T10:40:04Z")).toBe("Pilot slice · Oct 21, 2026");
    expect(runDate("not a date")).toBe("not a date");
  });
});

// PO 2026-10-26 06:55: the run numbers match the run IDs and the docs; A-03's slice is unnumbered.
const PILOT = "travis-202609-permits-20261021t103516z";
const REAL = [
  { runId: "travis-full-run3-20261025", manifestCid: "bafk3", finishedAt: "2026-10-25T12:44:21Z" },
  { runId: PILOT, manifestCid: "bafkp", finishedAt: "2026-10-21T10:40:04.543Z" },
  { runId: "travis-full-run1-20261023", manifestCid: "bafk1", finishedAt: "2026-10-23T09:00:00Z" },
  { runId: "travis-full-run2-20261024", manifestCid: "bafk2", finishedAt: "2026-10-24T18:20:49Z" },
];
const REAL_INDEX = { schema: "countylens.runs-index/v1", runs: REAL } as unknown as RunsIndexV1;

describe("the one numbering rule (RUNS_TEXTS.numbering)", () => {
  it("numbers the full-county runs 1..3 and leaves the A-03 pilot slice unnumbered", () => {
    expect(PILOT_RUN_IDS.has(PILOT)).toBe(true);
    const n = runNumbers(REAL_INDEX);
    expect(n.get(PILOT)).toBeNull();
    expect(n.get("travis-full-run1-20261023")).toBe(1);
    expect(n.get("travis-full-run2-20261024")).toBe(2);
    expect(n.get("travis-full-run3-20261025")).toBe(3);
    expect(numberedRuns(REAL_INDEX).map((r) => r.runId)).toEqual([
      "travis-full-run1-20261023",
      "travis-full-run2-20261024",
      "travis-full-run3-20261025",
    ]);
    expect(runName(null)).toBe("Pilot slice");
    expect(runName(3)).toBe("Run 3");
  });

  it("a later run continues at Run 4", () => {
    const next = {
      runId: "travis-bridge-20261101",
      manifestCid: "bafk4",
      finishedAt: "2026-11-01T00:00:00Z",
    };
    const index = { ...REAL_INDEX, runs: [...REAL, next] } as RunsIndexV1;
    expect(runNumbers(index).get(next.runId)).toBe(4);
  });

  it("a correction run takes the number in its run ID (Run 3.1), and the next run is Run 4", () => {
    const fix = {
      runId: "travis-full-run3-1-20261025",
      manifestCid: "bafk31",
      finishedAt: "2026-10-25T22:55:00.000Z",
    };
    const next = {
      runId: "travis-bridge-20261101",
      manifestCid: "bafk4",
      finishedAt: "2026-11-01T00:00:00Z",
    };
    const index = { ...REAL_INDEX, runs: [...REAL, fix, next] } as RunsIndexV1;
    expect(runNumbers(index).get(fix.runId)).toBe("3.1");
    expect(runName(runNumbers(index).get(fix.runId) ?? null)).toBe("Run 3.1");
    expect(runNumbers(index).get(next.runId)).toBe(4);
    expect(latestChip([...REAL, fix]).name).toBe("Run 3.1");
  });

  it("the header and Hub chip name the latest run Run 3", () => {
    expect(latestChip(REAL).name).toBe("Run 3");
  });

  it("the dropdown lists the pilot as Pilot slice, never numbered", () => {
    render(<RunSelect runs={REAL} value={null} onChange={() => undefined} label="Run" />);
    expect([...select().options].map((o) => o.textContent)).toEqual([
      "Run 3 · Oct 25, 2026 · latest",
      "Run 2 · Oct 24, 2026",
      "Run 1 · Oct 23, 2026",
      "Pilot slice · Oct 21, 2026",
    ]);
  });
});

describe("RunSelect", () => {
  it("lists runs newest first, numbered by finish time, the latest marked", () => {
    render(<RunSelect runs={RUNS} value="run-b" onChange={() => undefined} label="Run" />);
    const options = [...select().options];
    expect(options.map((o) => o.textContent)).toEqual([
      "Run 3 · Oct 25, 2026 · latest",
      "Run 2 · Oct 24, 2026",
      "Run 1 · Oct 21, 2026",
    ]);
    expect(options.map((o) => o.getAttribute("data-run-id"))).toEqual(["run-c", "run-b", "run-a"]);
    expect(select().value).toBe("run-b");
  });

  it("reports the chosen run ID", () => {
    const onChange = vi.fn();
    render(<RunSelect runs={RUNS} value="run-c" onChange={onChange} label="Run" />);
    fireEvent.change(select(), { target: { value: "run-a" } });
    expect(onChange).toHaveBeenCalledWith("run-a");
  });

  it("selects the latest when the value is unknown and there is no all-runs choice", () => {
    render(<RunSelect runs={RUNS} value="missing" onChange={() => undefined} label="Run" />);
    expect(select().value).toBe("run-c");
  });

  it("offers an all-runs choice first, reported as null", () => {
    const onChange = vi.fn();
    render(
      <RunSelect
        runs={RUNS}
        value={null}
        onChange={onChange}
        label="Run"
        hideLabel
        allLabel="All runs"
      />,
    );
    expect(select().options[0]?.textContent).toBe("All runs");
    expect(select().value).toBe("");
    fireEvent.change(select(), { target: { value: "run-b" } });
    fireEvent.change(select(), { target: { value: "" } });
    expect(onChange.mock.calls).toEqual([["run-b"], [null]]);
  });

  it("names the field by its label, visible or for assistive tech only", () => {
    render(
      <RunSelect runs={RUNS} value={null} onChange={() => undefined} label="Older run" hideLabel />,
    );
    expect(select("Older run")).toBeDefined();
    expect(
      document.querySelector('[data-icon="arrow_drop_down"]')?.getAttribute("aria-hidden"),
    ).toBe("true");
  });
});

describe("compareQuery (label review 2026-10-26)", () => {
  it("speaks Compare's positions, so a run named 3.1 is not read as position 3", () => {
    const index = {
      ...REAL_INDEX,
      runs: [
        ...REAL_INDEX.runs,
        {
          runId: "travis-full-run3-1-20261025",
          manifestCid: "bafk31",
          finishedAt: "2026-10-25T23:00:00Z",
        },
        {
          runId: "travis-full-run4-20261026",
          manifestCid: "bafk4",
          finishedAt: "2026-10-26T11:47:00Z",
        },
      ],
    } as RunsIndexV1;
    expect(compareQuery(index, "travis-full-run3-1-20261025", "travis-full-run4-20261026")).toBe(
      "?a=4&b=5",
    );
    expect(compareQuery(index, PILOT, "travis-full-run4-20261026")).toBe("");
  });
});
