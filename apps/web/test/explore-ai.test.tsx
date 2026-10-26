// A-14 T033 (FR-012; contracts/agent-ask.md): the Explore · AI tab. `agent.ask` is replaced by an
// injected `ask` function that resolves with rows built in the test (never shown as real data).
// Covers Working… + timer + Cancel + the 25 s client stop, the answer with `[n]` citations linked
// to numbered rows with provenance, editable "How I read this" chips re-sent as `overrides`, the
// missing-data list, the session counter, and every non-answer state.
import { rawCid } from "@countylens/query-core";
import { AI_TEXTS } from "@countylens/shared";
import { act, cleanup, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentAskRequest, AgentAskResponse, AgentMatch } from "../src/data/agent-ask";
import { ExploreAi } from "../src/routes/ExploreAi";
import {
  SESSION_KEY,
  answerBlocks,
  answerInline,
  howChips,
  splitAnswer,
} from "../src/routes/ExploreAi.state";

let cid: string;
let manifest: string;
function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("expected a value");
  return value;
}
function at<T>(list: readonly T[], i: number): T {
  return must(list[i]);
}

beforeAll(async () => {
  cid = await rawCid(new TextEncoder().encode("ai property"));
  manifest = await rawCid(new TextEncoder().encode("ai manifest"));
});

const match = (n: number, over: Partial<AgentMatch> = {}): AgentMatch => ({
  n,
  property_cid: cid,
  source_url: "https://traviscad.org/publicinformation",
  captured_at: "2026-10-21T08:02:00.000Z",
  table: "county/property",
  table_cid: manifest,
  run_id: "travis-test-ai",
  manifest_cid: manifest,
  as_of: "2026-10-21",
  roof_age_years: 18,
  roof_age_basis: "built_year",
  roof_age_confidence: "low",
  missing: [],
  ...over,
});

const response = (over: Partial<AgentAskResponse> = {}): AgentAskResponse => ({
  answer: "Two properties match [1][2]. Nothing else [9].",
  how: "Pflugerville city centre; 5 mi",
  steps: [],
  matches: [match(1), match(2, { missing: [{ field: "contractor", reason: "source_missing" }] })],
  query: {
    radius_mi: 5,
    roof_age_years_min: 15,
    permit: "open_or_stalled",
    manifest_cid: manifest,
  },
  missing: [{ field: "tenure_years", reason: "unknown" }],
  outcome: "answered",
  ...over,
});

type Ask = (request: AgentAskRequest, signal: AbortSignal) => Promise<AgentAskResponse>;

function setup(ask: Ask): ReturnType<typeof vi.fn<Ask>> {
  const fn = vi.fn<Ask>(ask);
  render(<ExploreAi onState={() => undefined} ask={fn} />);
  return fn;
}

async function submit(text: string): Promise<void> {
  fireEvent.change(screen.getByLabelText(/Ask about roofing leads/), { target: { value: text } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
  });
}

const aiState = (): string | null =>
  must(document.querySelector("[data-panel=ai]")).getAttribute("data-ai-state");

beforeEach(() => window.sessionStorage.clear());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Explore · AI auto-run (PO 2026-10-26, the drawer's Ask about this property)", () => {
  it("sends the question once on arrival with autoRun, never without it", async () => {
    window.history.replaceState(
      null,
      "",
      "/tx/travis/explore?mode=ai&q=Tell%20me%20about%20property%20x",
    );
    const fn = vi.fn<Ask>(async () => response());
    const { rerender } = render(<ExploreAi onState={() => undefined} ask={fn} autoRun />);
    await waitFor(() => expect(aiState()).toBe("answered"));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0]?.[0].prompt).toBe("Tell me about property x");
    rerender(<ExploreAi onState={() => undefined} ask={fn} autoRun />);
    expect(fn).toHaveBeenCalledTimes(1);
    cleanup();
    const manual = vi.fn<Ask>(async () => response());
    render(<ExploreAi onState={() => undefined} ask={manual} />);
    expect(manual).not.toHaveBeenCalled();
    window.history.replaceState(null, "", "/");
  });
});

describe("Explore · AI answered (FR-012)", () => {
  it("shows the answer, citations linked to numbered rows, provenance and missing data", async () => {
    setup(async () => response());
    await submit("roofs older than 15 near Pflugerville");
    expect(aiState()).toBe("answered");
    const rows = document.querySelectorAll("[data-match]");
    expect([...rows].map((r) => r.getAttribute("data-match"))).toEqual(["1", "2"]);
    // [1] and [2] are links to rows; [9] has no row and is not shown.
    const cites = [...document.querySelectorAll("[data-cite]")].map((c) =>
      c.getAttribute("data-cite"),
    );
    expect(cites).toEqual(["1", "2"]);
    expect(must(document.querySelector("[data-answer]")).textContent).not.toContain("[9]");
    fireEvent.click(must(document.querySelector("[data-cite='2']")));
    expect(document.activeElement).toBe(document.getElementById("ai-match-2"));
    // Every row carries its source, collected time, table CID and run.
    const row = rows[0] as HTMLElement;
    expect(within(row).getByRole("link", { name: /traviscad\.org/ })).toBeTruthy();
    expect(row.textContent).toContain("run travis-test-ai");
    expect(row.textContent).toContain("2026-10-21 08:02:00");
    expect(row.querySelector("[data-cid]")?.getAttribute("data-cid")).toBe(cid);
    // A row's own gap says why.
    expect(at([...rows], 1).querySelector("[data-reason='source_missing']")).not.toBeNull();
    // The missing list gives a reason in words.
    const missing = must(document.querySelector("[data-missing]"));
    expect(missing.textContent).toContain("tenure years");
    expect(missing.textContent).toContain("unknown");
  });

  it("counts only answered questions in the session counter and stores it", async () => {
    setup(async () => response());
    expect(screen.getByText(AI_TEXTS.counter(0, 10))).toBeTruthy();
    await submit("q1");
    expect(screen.getByText(AI_TEXTS.counter(1, 10))).toBeTruthy();
    expect(window.sessionStorage.getItem(SESSION_KEY)).toBe("1");
  });

  it("sends the last turns and pins the run on the next question", async () => {
    const ask = setup(async () => response());
    await submit("first");
    await submit("and that area?");
    expect(at(ask.mock.calls, 0)[0]).toEqual({ prompt: "first" });
    expect(at(ask.mock.calls, 1)[0]).toEqual({
      prompt: "and that area?",
      turns: [{ prompt: "first", outcome: "answered" }],
      manifest_cid: manifest,
    });
  });
});

describe("How I read this chips", () => {
  it("shows the applied filters; an edited number is re-sent as an override", async () => {
    const ask = setup(async () => response());
    await submit("roofs older than 15");
    const again = screen.getByRole("button", { name: "Ask again" }) as HTMLButtonElement;
    expect(again.disabled).toBe(true);
    const roof = screen.getByLabelText(/Roof age at least/) as HTMLInputElement;
    expect(roof.value).toBe("15");
    expect(must(document.querySelector("[data-chip='permit']")).textContent).toContain(
      "open or stalled",
    );
    fireEvent.change(roof, { target: { value: "20" } });
    expect(again.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(again);
    });
    const second = at(ask.mock.calls, 1)[0];
    expect(second.prompt).toBe("roofs older than 15");
    expect(second.overrides).toEqual({ roof_age_years_min: 20 });
  });

  it("labels the tenure chip 'more than' (the filter is strict), and keeps roof age 'at least' (T041)", () => {
    const chips = howChips({ radius_mi: 3, tenure_years_min: 10, roof_age_years_min: 15 });
    const labels = chips.editable.map((e) => e.chip.label);
    expect(labels).toContain("Owner tenure more than");
    expect(labels).toContain("Roof age at least");
    expect(labels).not.toContain("Owner tenure at least");
  });

  it("builds chips from the query echo only (area and plumbing keys hidden)", () => {
    const chips = howChips({
      radius_mi: 3,
      area: { place: "x" },
      manifest_cid: "m",
      limit: 5,
      ooa: true,
    });
    expect(chips.editable.map((c) => c.chip.key)).toEqual(["radius_mi"]);
    expect(chips.fixed.map((c) => c.key)).toEqual(["ooa"]);
  });

  it("splits an answer at citations and drops out-of-range ones", () => {
    expect(splitAnswer("a [1] b [3]", 2)).toEqual([
      { kind: "text", text: "a " },
      { kind: "cite", n: 1 },
      { kind: "text", text: " b " },
    ]);
  });
});

// PO 2026-10-26 (15.png): the model's Markdown never reaches the page as raw markers.
describe("Explore · AI answer Markdown", () => {
  const md = [
    "Found **28,062 total matches** within 5 mi [1].",
    "",
    "> ⚠️ **Confidence note:** roof ages come from the built year.",
    "",
    "---",
    "### Top Results",
    "| # | Citation | Distance |",
    "|---|----------|----------|",
    "| 1 | [1] | 1.19 mi |",
    "- one `item`",
  ].join("\n");

  it("reads headings, caveats, table rows and items into blocks", () => {
    expect(answerBlocks(md)).toEqual([
      { kind: "para", text: "Found **28,062 total matches** within 5 mi [1]." },
      { kind: "caveat", text: "⚠️ **Confidence note:** roof ages come from the built year." },
      { kind: "heading", text: "Top Results" },
      { kind: "item", text: "1 · [1] · 1.19 mi" },
      { kind: "item", text: "one `item`" },
    ]);
    expect(answerInline("a **b** [1] [7] `c`", 2)).toEqual([
      { kind: "text", text: "a " },
      { kind: "strong", text: "b" },
      { kind: "text", text: " " },
      { kind: "cite", n: 1 },
      { kind: "text", text: " " },
      { kind: "text", text: " c" },
    ]);
  });

  it("renders no raw **, ###, > or |---| on the page", async () => {
    setup(async () => response({ answer: md }));
    await submit("roofs in Pflugerville");
    const text = must(document.querySelector("[data-answer]")).textContent ?? "";
    expect(text).not.toMatch(/\*\*|###|\|-|^>/m);
    expect(text).toContain("28,062 total matches");
    expect(document.querySelector("[data-answer] strong")?.textContent).toBe(
      "28,062 total matches",
    );
    expect(document.querySelector("[data-answer] [role='note']")).not.toBeNull();
  });
});

describe("Explore · AI other states", () => {
  it("an empty answer names the one run it searched (run echo line with run id, date, manifest)", async () => {
    const run = {
      run_id: "travis-202609-permits-20261021t103516z",
      manifest_cid: "bafyreirunechomanifestcidforthetestxxxxxxxxxxxxxxxxxxxxxxxxx",
      as_of: "2026-10-21T10:35:16.000Z",
    };
    setup(async () => response({ matches: [], answer: "Nothing found.", run }));
    await submit("roofs in Pflugerville");
    expect(aiState()).toBe("no_results");
    const line = must(document.querySelector("[data-run]"));
    expect(line.textContent).toContain(AI_TEXTS.searchedRun);
    expect(line.textContent).toContain(run.run_id);
    expect(line.textContent).toContain(`${AI_TEXTS.runAsOf} 2026-10-21`);
    expect(line.querySelector("[data-cid]")?.getAttribute("data-cid")).toBe(run.manifest_cid);
  });

  it("no run line when the server sent none (older server still validates)", async () => {
    setup(async () => response({ matches: [], answer: "Nothing found." }));
    await submit("roofs in Mars");
    expect(document.querySelector("[data-run]")).toBeNull();
  });

  it("no results: says so and lists what is missing", async () => {
    setup(async () =>
      response({
        matches: [],
        answer: "Nothing found.",
        missing: [{ field: "result", reason: "not_found" }],
      }),
    );
    await submit("roofs in Mars");
    expect(aiState()).toBe("no_results");
    expect(screen.getByText(AI_TEXTS.noResults)).toBeTruthy();
    expect(must(document.querySelector("[data-missing]")).textContent).toContain("not found");
    // An empty answer is still an answered question.
    expect(screen.getByText(AI_TEXTS.counter(1, 10))).toBeTruthy();
  });

  it.each([
    ["throttled", AI_TEXTS.throttled],
    ["paused", AI_TEXTS.paused],
    ["timed_out", AI_TEXTS.timedOut],
    ["failed", AI_TEXTS.failed],
  ] as const)("%s: fixed text, and the question is not counted", async (outcome, text) => {
    setup(async () => response({ outcome, answer: "", matches: [] }));
    await submit("q");
    expect(aiState()).toBe(outcome);
    expect(screen.getByRole("alert").textContent).toContain(text);
    expect(screen.getByText(AI_TEXTS.counter(0, 10))).toBeTruthy();
  });

  it("network failure: unreachable with retry", async () => {
    const ask = setup(async () => {
      throw new Error("offline");
    });
    await submit("q");
    expect(aiState()).toBe("unreachable");
    expect(screen.getByRole("alert").textContent).toContain(AI_TEXTS.unreachable);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    });
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it("limit reached: blocks the call before it is sent", async () => {
    window.sessionStorage.setItem(SESSION_KEY, "10");
    const ask = setup(async () => response());
    expect(screen.getByRole("alert").textContent).toContain(AI_TEXTS.limitReached(10));
    fireEvent.change(screen.getByLabelText(/Ask about roofing leads/), { target: { value: "q" } });
    expect((screen.getByRole("button", { name: "Ask" }) as HTMLButtonElement).disabled).toBe(true);
    expect(ask).not.toHaveBeenCalled();
  });
});

describe("Working…, Cancel and the client stop", () => {
  const pending = (): Ask => (_request, signal) =>
    new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });

  it("shows an elapsed timer and Cancel, then reports cancelled without counting", async () => {
    vi.useFakeTimers();
    setup(pending());
    await submit("slow");
    expect(aiState()).toBe("working");
    expect(screen.getByRole("progressbar", { name: AI_TEXTS.working })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Working… 0 s");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByRole("status").textContent).toContain("Working… 3 s");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });
    expect(aiState()).toBe("cancelled");
    expect(screen.getByText(AI_TEXTS.cancelled)).toBeTruthy();
    expect(screen.getByText(AI_TEXTS.counter(0, 10))).toBeTruthy();
  });

  it("stops at 25 s and shows the timed-out text", async () => {
    vi.useFakeTimers();
    setup(pending());
    await submit("slower");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AI_TEXTS.clientStopMs + 10);
    });
    expect(aiState()).toBe("timed_out");
    expect(screen.getByRole("alert").textContent).toContain(AI_TEXTS.timedOut);
  });
});
