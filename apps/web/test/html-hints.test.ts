// @vitest-environment node
// ERR-44 (TC-081): data pages waterfall HTML -> JS -> /runs/index.json -> manifest from the CID
// copy host. index.html starts the index request with the HTML and warms the cross-origin
// connection to the CID copy host. Source-level checks (jsdom has no preload scanner), plus the
// built dist/index.html when a build exists.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { RUNS_INDEX_PATH, loadRunsIndex } from "../src/data/runs-index";

const WEB = join(__dirname, "..");
const html = readFileSync(join(WEB, "index.html"), "utf8");
const tags = (source: string): string[] => source.match(/<link\b[^>]*>/g) ?? [];
const attr = (tag: string, name: string): string | undefined =>
  new RegExp(`\\s${name}(?:="([^"]*)")?(?=[\\s>/])`).exec(tag)?.[1] ??
  (new RegExp(`\\s${name}(?=[\\s>/])`).test(tag) ? "" : undefined);

describe("index.html resource hints", () => {
  // The preload is added by a tiny inline script, only on routes that read published data: the
  // static pages (Legal, Help, Coming soon) make no data request (TC-056, FR-011, FR-013).
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";
  const run = (pathname: string): Array<Record<string, string>> => {
    const added: Array<Record<string, string>> = [];
    const fake = {
      createElement: () => ({}) as Record<string, string>,
      head: { appendChild: (el: Record<string, string>) => added.push(el) },
    };
    new Function("location", "document", script)({ pathname }, fake);
    return added;
  };

  it("has no static data preload link (font preloads are ERR-46; a data one would fetch the index on static pages)", () => {
    expect(tags(html).some((t) => attr(t, "rel") === "preload" && attr(t, "as") !== "font")).toBe(
      false,
    );
    expect(script, "inline preload script").toContain("/runs/index.json");
  });

  it.each([
    "/",
    "/runs",
    "/runs/compare",
    "/runs/log",
    "/tx/travis/coverage",
    "/tx/travis/explore",
    "/data/manifest",
    "/data/catalog",
    "/data/verify/bafkrei",
    "/permits",
  ])("preloads /runs/index.json as a same-origin fetch on %s", (path) => {
    const [link, ...rest] = run(path);
    expect(rest).toEqual([]);
    expect(link).toMatchObject({
      rel: "preload",
      as: "fetch",
      href: "/runs/index.json",
      crossOrigin: "anonymous",
    });
  });

  it.each(["/legal/data", "/legal/privacy", "/legal/terms", "/help/mcp", "/soon/builder-mode"])(
    "adds no preload on the static page %s",
    (path) => {
      expect(run(path)).toEqual([]);
    },
  );

  it("preconnects to the CID copy host placeholder, crossorigin, and not to gateways", () => {
    const hosts = tags(html).filter((t) => attr(t, "rel") === "preconnect");
    const cid = hosts.find((t) => attr(t, "href") === "https://%VITE_CID_COPY_HOST%");
    expect(cid, "no CID copy preconnect").toBeDefined();
    expect(attr(cid ?? "", "crossorigin")).toBeDefined();
    expect(html).not.toMatch(/pinata|filebase/i);
  });

  it("vite.config removes the preconnect when the host is unset (no literal placeholder)", () => {
    const config = readFileSync(join(WEB, "vite.config.ts"), "utf8");
    expect(config).toContain("VITE_CID_COPY_HOST");
    expect(config).toContain("transformIndexHtml");
  });
});

describe("loadRunsIndex requests exactly the preloaded URL", () => {
  it("fetches RUNS_INDEX_PATH with no cache, credentials, mode or headers override", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response("{}", { status: 404 })));
    await loadRunsIndex({ fetch: fetchMock as unknown as typeof fetch }).catch(() => undefined);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(RUNS_INDEX_PATH);
    expect(RUNS_INDEX_PATH).toBe("/runs/index.json");
    expect(Object.keys(init ?? {})).toEqual([]);
  });
});

const distHtml = join(WEB, "dist", "index.html");
describe.skipIf(!existsSync(distHtml))("built dist/index.html", () => {
  const built = existsSync(distHtml) ? readFileSync(distHtml, "utf8") : "";
  it("keeps the conditional index preload script and never ships an unresolved placeholder", () => {
    expect(built).toContain("/runs/index.json");
    expect(built).toMatch(/<script>[\s\S]*preload[\s\S]*<\/script>/);
    expect(tags(built).some((t) => attr(t, "rel") === "preload" && attr(t, "as") !== "font")).toBe(
      false,
    );
    expect(built).not.toContain("%VITE_");
  });
  const host = process.env["VITE_CID_COPY_HOST"];
  it.skipIf(host === undefined || host === "")(
    "preconnects to the configured CID copy host",
    () => {
      expect(
        tags(built).some(
          (t) => attr(t, "rel") === "preconnect" && attr(t, "href") === `https://${host}`,
        ),
      ).toBe(true);
    },
  );
});
