// A-13 T034 (G3): the Hub (`/`), spec US7, AC-9, FR-009, FR-020; TC-001, TC-050, TC-051, TC-052.
// Fetches are vi.fn; the run chip and the links come only from /runs/index.json and
// /site-links.json. Fixed texts are imported from @countylens/shared, never retyped.
import { RUNS_INDEX_SCHEMA } from "@countylens/contract";
import { rawCid } from "@countylens/query-core";
import { PAGE_TEXTS, ROUTES, RUNS_TEXTS } from "@countylens/shared";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import hubSource from "../src/routes/Hub.tsx?raw";

const encode = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text);
let cids: string[] = [];
beforeAll(async () => {
  cids = [await rawCid(encode("run-a")), await rawCid(encode("run-b"))];
});

function indexJson(): string {
  return JSON.stringify({
    schema: RUNS_INDEX_SCHEMA,
    runs: [
      { runId: "test-run-a", manifestCid: cids[0], finishedAt: "2026-10-20T08:12:34.000Z" },
      { runId: "test-run-b", manifestCid: cids[1], finishedAt: "2026-10-21T10:40:59.000Z" },
    ],
  });
}

interface Files {
  index?: () => Response | Promise<Response>;
  links?: string;
}

function install(files: Files): void {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === "/runs/index.json") {
        return files.index === undefined ? new Response(indexJson()) : files.index();
      }
      if (url === "/site-links.json") {
        return files.links === undefined
          ? new Response("not found", { status: 404 })
          : new Response(files.links);
      }
      throw new TypeError(`unexpected request ${url}`);
    }),
  );
}

async function renderHub(): Promise<HTMLElement> {
  const { Component } = await import("../src/routes/Hub");
  render(
    <MemoryRouter initialEntries={["/"]}>
      <Component />
    </MemoryRouter>,
  );
  return screen.getByRole("region", { name: "Hub" });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Hub: the two cards and the run chip (TC-001)", () => {
  it("shows the CountyLens card with Open and What can I ask?, and the chip from the latest run", async () => {
    install({});
    const page = await renderHub();
    expect(page.getAttribute("data-route")).toBe("hub");
    const chip = await screen.findByText(PAGE_TEXTS.hubChip("Run 2", "2026-10-21T10:40:59.000Z"));
    expect(chip.textContent).toBe("Run 2 · 2026-10-21 10:40 UTC");
    expect(page.getAttribute("data-state")).toBe("ready");
    expect(screen.getByRole("link", { name: "Open" }).getAttribute("href")).toBe(ROUTES.explore);
    expect(screen.getByRole("link", { name: "What can I ask?" }).getAttribute("href")).toBe(
      ROUTES.helpMcp,
    );
  });

  it("the CRM card reads Coming soon · Not deployed yet with a disabled button and no href", async () => {
    install({ links: JSON.stringify({ crmUrl: "", demoVideoUrl: "", prUrl: "" }) });
    await renderHub();
    await screen.findByText(/^Run 2/);
    expect(screen.getByText(PAGE_TEXTS.comingSoonNotDeployed)).toBeTruthy();
    const crm = screen.getByRole("article", { name: /Roofing CRM/ });
    const button = within(crm).getByRole("button");
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute("href")).toBeNull();
    expect(within(crm).queryByRole("link")).toBeNull();
  });

  it("shows no number on the Hub other than the chip's", async () => {
    install({});
    const page = await renderHub();
    await screen.findByText(/^Run 2/);
    expect((page.textContent ?? "").replace(/Run 2 · 2026-10-21 10:40 UTC/, "")).not.toMatch(/\d/);
  });
});

describe("Hub: links from site-links.json only (TC-050, TC-051)", () => {
  it("an https crmUrl makes the CRM card a live link and drops the Coming soon text", async () => {
    install({ links: JSON.stringify({ crmUrl: "https://crm.example.invalid/" }) });
    await renderHub();
    const crm = screen.getByRole("article", { name: /Roofing CRM/ });
    const link = await within(crm).findByRole("link");
    expect(link.getAttribute("href")).toBe("https://crm.example.invalid/");
    expect(screen.queryByText(PAGE_TEXTS.comingSoonNotDeployed)).toBeNull();
  });

  it("an http crmUrl is invalid: the card stays Coming soon", async () => {
    install({ links: JSON.stringify({ crmUrl: "http://crm.example.invalid/" }) });
    await renderHub();
    await screen.findByText(/^Run 2/);
    expect(screen.getByText(PAGE_TEXTS.comingSoonNotDeployed)).toBeTruthy();
  });

  it("hides Watch demo and PR until set, shows them with their https URLs when set", async () => {
    install({ links: JSON.stringify({ crmUrl: "", demoVideoUrl: "", prUrl: "" }) });
    await renderHub();
    await screen.findByText(/^Run 2/);
    expect(screen.queryByRole("link", { name: "Watch demo" })).toBeNull();
    expect(screen.queryByRole("link", { name: "PR" })).toBeNull();
    cleanup();
    install({
      links: JSON.stringify({
        demoVideoUrl: "https://video.example.invalid/d",
        prUrl: "https://github.example.invalid/pr/1",
      }),
    });
    await renderHub();
    expect((await screen.findByRole("link", { name: "Watch demo" })).getAttribute("href")).toBe(
      "https://video.example.invalid/d",
    );
    expect(screen.getByRole("link", { name: "PR" }).getAttribute("href")).toBe(
      "https://github.example.invalid/pr/1",
    );
  });

  it("never renders a dead link (# or empty href)", async () => {
    install({});
    const page = await renderHub();
    await screen.findByText(/^Run 2/);
    for (const a of page.querySelectorAll("a")) {
      expect(["", "#", null]).not.toContain(a.getAttribute("href"));
    }
  });
});

describe("Hub: loading and error states", () => {
  it("shows a fixed-size chip skeleton while the index loads (CLS)", async () => {
    install({ index: () => new Promise<Response>(() => undefined) });
    const page = await renderHub();
    expect(page.getAttribute("data-state")).toBe("loading");
    expect(page.querySelector("[data-chip-skeleton]")).not.toBeNull();
    expect(screen.queryByText(/^Run \d/)).toBeNull();
  });

  it("an unreadable index shows the run index text with a link, and the cards still render", async () => {
    install({ index: () => new Response("nope", { status: 404 }) });
    const page = await renderHub();
    await screen.findByText(/Run index unavailable/);
    expect(page.getAttribute("data-state")).toBe("error");
    expect(RUNS_TEXTS.indexUnavailable("x")).toMatch(/^Run index unavailable · /);
    expect(screen.getByRole("link", { name: "Open" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "/runs/index.json" }).getAttribute("href")).toBe(
      "/runs/index.json",
    );
  });
});

describe("Hub: the chip row is a live region", () => {
  it("is role=status, announces Loading latest run, then the ready chip text", async () => {
    install({ index: () => new Promise<Response>(() => undefined) });
    const page = await renderHub();
    const status = within(page).getByRole("status");
    expect(status.textContent).toContain("Loading latest run");
    expect(status.querySelector("[data-chip-skeleton]")).not.toBeNull();
    cleanup();
    vi.unstubAllGlobals();
    install({});
    const ready = await renderHub();
    const live = within(ready).getByRole("status");
    await within(live).findByText("Run 2 · 2026-10-21 10:40 UTC");
    expect(live.textContent).not.toContain("Loading latest run");
  });

  it("the error state is a named pill with the reason and the link, role=alert", async () => {
    install({ index: () => new Response("nope", { status: 404 }) });
    const page = await renderHub();
    const alert = await within(page).findByRole("alert");
    expect(alert.textContent).toMatch(/^Run index unavailable · /);
    expect(alert.querySelector("[data-status=error]")).not.toBeNull();
    expect(within(page).getByRole("status").contains(alert)).toBe(true);
  });
});

describe("Hub: never loads the query engine (TC-052)", () => {
  it("Hub.tsx imports no query-core, DuckDB or Parquet module", () => {
    expect(hubSource).not.toMatch(/query-core|duckdb|hyparquet|engine\//i);
  });
});
