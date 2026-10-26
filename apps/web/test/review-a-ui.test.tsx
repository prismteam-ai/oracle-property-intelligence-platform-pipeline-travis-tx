// A-13 review round, fixer A: component-level findings (VerifyLane announcements, unsafe source
// URLs). Red before the fixes.
import { RUN_MANIFEST_SCHEMA, type RunManifestV1 } from "@countylens/contract";
import { rawCid } from "@countylens/query-core";
import { VERIFY_TEXTS } from "@countylens/shared";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Provenance, SourceLink } from "../src/components/Provenance";
import { VerifyLane } from "../src/components/VerifyLane";
import { denominatorRows } from "../src/data/coverage-rows";

afterEach(() => cleanup());

const bytes = new TextEncoder().encode("lane bytes (test)");
async function digest(b: Uint8Array<ArrayBuffer>): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", b);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
const target = async (sha?: string) => ({
  cid: await rawCid(bytes),
  size: bytes.length,
  sha256: sha ?? (await digest(bytes)),
  kind: "table" as const,
  codec: "raw",
});
const laneState = (): string | null | undefined =>
  document.querySelector("[data-lane]")?.getAttribute("data-state");

describe("VerifyLane announces its final state (finding 1)", () => {
  it("keeps one polite status region whose text changes to the verified pill", async () => {
    render(
      <VerifyLane
        gateway="pinata"
        url="https://pinata.test/ipfs/x"
        target={await target()}
        fetch={vi.fn<typeof fetch>(async () => new Response(bytes))}
        sleep={() => new Promise<void>(() => undefined)}
      />,
    );
    const region = document.querySelector<HTMLElement>('[data-lane] [role="status"]');
    expect(region?.getAttribute("aria-live")).toBe("polite");
    await waitFor(() => expect(laneState()).toBe("verified"));
    expect(document.querySelector('[data-lane] [role="status"]')).toBe(region);
    expect(region?.textContent).toContain(VERIFY_TEXTS.verified);
    expect(document.querySelectorAll('[data-lane] [role="status"]')).toHaveLength(1);
  });

  it("announces a mismatch as an alert inside the same region", async () => {
    render(
      <VerifyLane
        gateway="filebase"
        url="https://filebase.test/ipfs/x"
        target={await target("a".repeat(64))}
        fetch={vi.fn<typeof fetch>(async () => new Response(bytes))}
        sleep={() => new Promise<void>(() => undefined)}
      />,
    );
    await waitFor(() => expect(laneState()).toBe("mismatch"));
    const region = document.querySelector<HTMLElement>('[data-lane] [role="status"]');
    expect(region?.querySelector('[role="alert"]')?.textContent).toMatch(/^Mismatch/);
    expect(document.querySelector("[data-got-sha256]")).not.toBeNull();
    expect(document.querySelector("[data-expected-sha256]")).not.toBeNull();
  });

  it("announces a directory lane (via CAR) in the status region", async () => {
    render(
      <VerifyLane
        gateway="pinata"
        url="https://pinata.test/ipfs/x"
        target={{ ...(await target()), kind: "directory", codec: "dag-json" }}
        fetch={vi.fn<typeof fetch>(async () => new Response(bytes))}
        sleep={() => new Promise<void>(() => undefined)}
      />,
    );
    await waitFor(() => expect(laneState()).toBe("via_car"));
    const region = document.querySelector<HTMLElement>('[data-lane] [role="status"]');
    expect(region?.textContent).toContain(VERIFY_TEXTS.viaCar);
  });
});

describe("Source URLs render as links only when http(s) (finding 2)", () => {
  for (const url of ["javascript:alert(1)", "data:text/html,<b>x</b>", "JaVaScRiPt:1"]) {
    it(`SourceLink shows ${url} as text, no link`, () => {
      render(<SourceLink url={url} />);
      expect(screen.queryByRole("link")).toBeNull();
      expect(document.body.textContent).toContain(url);
    });
    it(`Provenance shows ${url} as text, no link`, () => {
      render(
        <Provenance
          sourceUrl={url}
          capturedAt="2026-10-20T14:02:05.000Z"
          tableCid={"bafkrei" + "a".repeat(52)}
          runId="r"
        />,
      );
      expect(screen.queryByRole("link")).toBeNull();
      expect(document.body.textContent).toContain(url);
    });
  }
  it("keeps an https link", () => {
    render(<SourceLink url="https://example.test/a" />);
    expect(screen.getByRole("link").getAttribute("href")).toBe("https://example.test/a");
  });
  it("denominatorRows drops an unsafe source URL", () => {
    const manifest = {
      schema: RUN_MANIFEST_SCHEMA,
      coverage: {},
      sources: [
        { name: "a", url: "javascript:alert(1)", captured_at: "2026-10-01T00:00:00.000Z" },
        { name: "b", url: "https://example.test/b", captured_at: "2026-10-01T00:00:00.000Z" },
      ],
    } as unknown as RunManifestV1;
    const rows = denominatorRows(manifest);
    expect(rows[0]?.sourceUrl).toBeUndefined();
    expect(rows[1]?.sourceUrl).toBe("https://example.test/b");
  });
});
