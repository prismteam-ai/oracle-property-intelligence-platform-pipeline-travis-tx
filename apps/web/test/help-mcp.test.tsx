// A-13 T030 (FR-023; TC-042): Help · MCP (`/help/mcp`). It lists the six fixed tools of AD-21
// (no SQL tool). A-14 T034: "Try a tool" runs the chosen tool through the server-side proxy
// (`mcpProxy.callTool`, injected here as a fake `callTool`; the real client is tested against a
// fake fetch). It shows the server's result, truncation, provenance and errors, never a sample.
import {
  EXPLORE_BOUNDS,
  EXPLORE_SORTS,
  PROPERTY_STATUS_CLASSES,
  SearchPropertiesInput,
} from "@countylens/query-core";
import { MCP_TRY_TEXTS } from "@countylens/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MCP_TRY_PATH,
  McpTryError,
  tryMcpTool,
  type McpTryResponse,
  type McpTryTool,
} from "../src/data/mcp-try";

type CallTool = (tool: McpTryTool, args: Record<string, unknown>) => Promise<McpTryResponse>;

async function renderHelp(callTool?: CallTool): Promise<void> {
  const { Component } = await import("../src/routes/HelpMcp");
  render(
    <MemoryRouter initialEntries={["/help/mcp"]}>
      <Component {...(callTool === undefined ? {} : { callTool })} />
    </MemoryRouter>,
  );
}

afterEach(() => cleanup());

const TOOLS = [
  "search_properties",
  "list_permits",
  "get_property",
  "get_coverage",
  "list_runs",
  "get_schema",
];

describe("Help · MCP (FR-023, TC-042)", () => {
  it("lists the six AD-21 tools and no SQL tool", async () => {
    await renderHelp();
    const list = screen.getByRole("list", { name: "MCP tools" });
    const names = [...list.querySelectorAll("[data-tool]")].map((el) =>
      el.getAttribute("data-tool"),
    );
    expect(names).toEqual(TOOLS);
    expect(list.textContent?.toLowerCase()).not.toMatch(/\bsql\b|query_sql|run_sql/);
    const section = document.querySelector('section[data-route="help-mcp"]');
    expect(section?.getAttribute("data-state")).toBe("ready");
  });

  it("shows search_properties' input as the tool's own arguments, with query-core's bounds", async () => {
    await renderHelp();
    const tool = document.querySelector('[data-tool="search_properties"]') as HTMLElement;
    // TC-042: the real schema is marked [data-schema] inside its [data-tool].
    expect(tool.querySelector("[data-schema]"), "search_properties schema").not.toBeNull();
    expect(tool.querySelector("[data-schema-pending]")).toBeNull();
    const params = new Map(
      [...tool.querySelectorAll("[data-param]")].map((el) => [
        el.getAttribute("data-param"),
        el.textContent ?? "",
      ]),
    );
    // Exactly the MCP tool's argument names, in its schema's order (not Explore URL keys).
    expect([...params.keys()]).toEqual(Object.keys(SearchPropertiesInput.shape));
    for (const key of ["roof", "permit", "openYrs", "tenure", "ooa"])
      expect(params.has(key)).toBe(false);
    expect(params.get("radius_mi")).toContain(`${EXPLORE_BOUNDS.radiusMi[0]}`);
    expect(params.get("radius_mi")).toContain(`${EXPLORE_BOUNDS.radiusMi[1]}`);
    expect(params.get("roof_age_years_min")).toContain(`${EXPLORE_BOUNDS.roof[1]}`);
    expect(params.get("open_years_min")).toContain(`${EXPLORE_BOUNDS.openYrs[1]}`);
    expect(params.get("tenure_years_min")).toContain("1 to 100");
    expect(params.get("limit")).toContain("default 50");
    for (const value of PROPERTY_STATUS_CLASSES)
      expect(params.get("status_class")).toContain(value);
    for (const value of EXPLORE_SORTS) expect(params.get("sort")).toContain(value);
    // The bounds shown are the Zod schema's own.
    const shape = SearchPropertiesInput.shape;
    expect([shape.radius_mi.minValue, shape.radius_mi.maxValue]).toEqual([
      ...EXPLORE_BOUNDS.radiusMi,
    ]);
    expect(shape.roof_age_years_min.unwrap().maxValue).toBe(EXPLORE_BOUNDS.roof[1]);
    expect(shape.open_years_min.unwrap().maxValue).toBe(EXPLORE_BOUNDS.openYrs[1]);
    expect([
      shape.tenure_years_min.unwrap().minValue,
      shape.tenure_years_min.unwrap().maxValue,
    ]).toEqual([1, 100]);
    expect(shape.sort.unwrap().options).toEqual([...EXPLORE_SORTS]);
    expect(shape.status_class.unwrap().options).toEqual([...PROPERTY_STATUS_CLASSES]);
    expect(SearchPropertiesInput.parse({ area: { place: "Austin" }, radius_mi: 1 }).limit).toBe(50);
    // The five tools whose Zod schemas are not in query-core say so instead of inventing one.
    for (const name of [
      "list_permits",
      "get_property",
      "get_coverage",
      "list_runs",
      "get_schema",
    ]) {
      const li = document.querySelector(`[data-tool="${name}"]`) as HTMLElement;
      expect(li.querySelector("[data-param]"), name).toBeNull();
      expect(li.querySelector("[data-schema-pending]"), name).not.toBeNull();
    }
  });

  it("gives Claude Desktop, Claude Code and MCP Inspector snippets with the bearer header", async () => {
    await renderHelp();
    for (const client of ["claude-desktop", "claude-code", "mcp-inspector"]) {
      const snippet = document.querySelector(`[data-snippet="${client}"]`);
      expect(snippet, client).not.toBeNull();
      expect(snippet?.textContent).toContain("Authorization: Bearer <token>");
    }
    expect(
      screen.getByText("Bearer token required, shared privately with reviewers"),
    ).toBeDefined();
    expect(document.body.textContent).not.toMatch(/Bearer (?!<token>)[A-Za-z0-9]{12,}/);
  });

  it("has one Try a tool button, no per-tool buttons, and shows nothing before it is pressed", async () => {
    await renderHelp();
    // A-16: the client panel's Copy button is not a tool button.
    const buttons = screen
      .getAllByRole("button")
      .filter((b) => !/^Cop(y|ied)$/.test(b.textContent ?? ""));
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.textContent).toBe("Try a tool");
    expect(screen.queryByRole("button", { name: /Try (search|list|get)_/ })).toBeNull();
    expect(document.querySelector("[data-try-result]")).toBeNull();
    expect(document.querySelector("[data-sample]")).toBeNull();
    expect(screen.getByText(MCP_TRY_TEXTS.noToken)).toBeDefined();
  });

  it("runs the chosen tool with the edited arguments and shows run, truncation and rows", async () => {
    const callTool = vi.fn<CallTool>(async (tool) => ({
      tool,
      maxRows: 1000,
      result: {
        rows: Array.from({ length: 7 }, (_, i) => ({
          property_cid: `p${i}`,
          source_url: "https://example.test/s",
        })),
        returned: 7,
        total: 120,
        truncated: true,
        empty_reason: null,
        run: {
          run_id: "travis-test",
          manifest_cid: `ba${"a".repeat(60)}`,
          as_of: "2026-10-20T22:00:10.663Z",
        },
      },
    }));
    await renderHelp(callTool);
    fireEvent.change(screen.getByLabelText("Tool"), { target: { value: "list_permits" } });
    expect((screen.getByLabelText("Arguments (JSON)") as HTMLTextAreaElement).value).toContain(
      "open_or_stalled",
    );
    fireEvent.change(screen.getByLabelText("Arguments (JSON)"), {
      target: { value: '{"limit": 7}' },
    });
    fireEvent.click(screen.getByRole("button", { name: "Try a tool" }));
    await waitFor(() => expect(document.querySelector("[data-try-result]")).not.toBeNull());
    expect(callTool).toHaveBeenCalledWith("list_permits", { limit: 7 });
    expect(document.querySelector("[data-try-count]")?.textContent).toContain(
      MCP_TRY_TEXTS.truncated(7, 120),
    );
    expect(
      document.querySelector("[data-try-count] [data-truncated]")?.getAttribute("data-truncated"),
    ).toBe("true");
    expect(document.querySelector("[data-try-provenance]")?.textContent).toContain("travis-test");
    expect(document.querySelector("[data-cid]")).not.toBeNull();
    expect(document.body.textContent).toContain(MCP_TRY_TEXTS.shownOf(5, 7));
    const json = document.querySelector("[data-try-json]")?.textContent ?? "";
    expect(json).toContain("p4");
    expect(json).not.toContain("p5");
    expect(json).toContain("source_url");
  });

  it("shows the empty reason the server gave instead of inventing rows", async () => {
    await renderHelp(async (tool) => ({
      tool,
      maxRows: 1000,
      result: {
        rows: [],
        returned: 0,
        total: 0,
        truncated: false,
        empty_reason: "no_match",
        run: { run_id: "r", manifest_cid: "", as_of: "x" },
      },
    }));
    fireEvent.click(screen.getByRole("button", { name: "Try a tool" }));
    await waitFor(() => expect(document.querySelector("[data-try-empty]")).not.toBeNull());
    expect(document.querySelector("[data-try-empty]")?.textContent).toContain(
      MCP_TRY_TEXTS.emptyReason("no_match"),
    );
  });

  it("shows the server's plain sentence for a rejected argument and the rate-limit text", async () => {
    const callTool = vi
      .fn<CallTool>()
      .mockRejectedValueOnce(new McpTryError("bad_request", "radius_mi must be at most 25"))
      .mockRejectedValueOnce(new McpTryError("rate_limited", "ignored"))
      .mockRejectedValueOnce(new Error("boom"));
    await renderHelp(callTool);
    const press = (): boolean =>
      fireEvent.click(screen.getByRole("button", { name: "Try a tool" }));
    press();
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("radius_mi must be at most 25"),
    );
    press();
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(MCP_TRY_TEXTS.rateLimited),
    );
    press();
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(MCP_TRY_TEXTS.unreachable),
    );
    expect(document.querySelector("[data-try-result]")).toBeNull();
  });

  it("rejects arguments that are not a JSON object without calling the server", async () => {
    const callTool = vi.fn<CallTool>();
    await renderHelp(callTool);
    for (const bad of ["{nope", "[1]"]) {
      fireEvent.change(screen.getByLabelText("Arguments (JSON)"), { target: { value: bad } });
      fireEvent.click(screen.getByRole("button", { name: "Try a tool" }));
      await waitFor(() =>
        expect(screen.getByRole("alert").textContent).toContain(MCP_TRY_TEXTS.badJson),
      );
    }
    expect(callTool).not.toHaveBeenCalled();
  });
});

describe("tryMcpTool (browser client of mcpProxy.callTool)", () => {
  const ok = { tool: "get_schema", maxRows: 1000, result: { views: [] } };
  const reply = (body: unknown, status = 200): typeof fetch =>
    (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;

  it("posts only the tool and arguments to the proxy, with no Authorization header", async () => {
    const fetchImpl = vi.fn(reply({ result: { data: ok } }));
    const out = await tryMcpTool("get_schema", { view: "v_property" }, fetchImpl);
    expect(out.result).toEqual({ views: [] });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(MCP_TRY_PATH);
    expect(JSON.parse(String(init.body))).toEqual({
      tool: "get_schema",
      arguments: { view: "v_property" },
    });
    expect(JSON.stringify(init.headers ?? {}).toLowerCase()).not.toMatch(/authorization|bearer/);
  });

  it("maps 400, 429, a bad shape and a network failure to typed errors", async () => {
    const err = (message: string, httpStatus: number) => ({
      error: { message, data: { httpStatus } },
    });
    await expect(
      tryMcpTool("get_schema", {}, reply(err("limit must be at most 1000", 400), 400)),
    ).rejects.toMatchObject({ code: "bad_request", message: "limit must be at most 1000" });
    await expect(
      tryMcpTool("get_schema", {}, reply(err("slow down", 429), 429)),
    ).rejects.toMatchObject({ code: "rate_limited" });
    await expect(
      tryMcpTool("get_schema", {}, reply({ result: { data: { tool: "run_sql" } } })),
    ).rejects.toMatchObject({ code: "failed" });
    await expect(
      tryMcpTool("get_schema", {}, (async () => {
        throw new TypeError("x");
      }) as typeof fetch),
    ).rejects.toMatchObject({ code: "unreachable" });
  });
});
