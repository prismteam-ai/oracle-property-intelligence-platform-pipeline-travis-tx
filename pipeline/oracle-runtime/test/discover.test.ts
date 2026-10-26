// The `discover` operator command: starts the TravisDiscovery run through the Restate
// ingress and waits for a settled state. Offline: the ingress is a fake fetch.
import { describe, expect, it } from "vitest";
import { main, type DiscoverCliDeps } from "../travis/discovery/discover.js";
import type { Catalog } from "../travis/discovery/catalog.schema.js";
import { syntheticUs1Catalog } from "./fixtures/synthetic-us1-catalog.js";

interface Call {
  url: string;
  method: string;
  body?: string;
}

const EG = { country: "EG", captured_at: "2026-01-01T00:00:00.000Z", method: "trace" };

function record(over: Record<string, unknown>): Record<string, unknown> {
  return {
    run_id: "travis",
    state: "DISCOVERING",
    steps: [{ key: "austin_permits:measurements:2026-01-01" }],
    blockers: [],
    validator: null,
    waiting_human_hours: 0,
    resolutions: [],
    waiting_since: null,
    completed_at: null,
    auto_advance_to_seed: false,
    ...over,
  };
}

function ingress(
  statuses: unknown[],
  send: () => Response = () => Response.json({ status: "Accepted" }),
) {
  const calls: Call[] = [];
  const queue = [...statuses];
  const fetch = async (url: string, init: RequestInit): Promise<Response> => {
    calls.push({
      url,
      method: init.method ?? "GET",
      ...(typeof init.body === "string" ? { body: init.body } : {}),
    });
    if (url.endsWith("/run/send")) return send();
    if (url.endsWith("/status")) return Response.json(queue.length > 1 ? queue.shift() : queue[0]);
    return new Response("not found", { status: 404 });
  };
  return { calls, fetch };
}

const BLOCKER = {
  source_key: "tcad_certified",
  next_step: "File the records request",
  waiting: true,
  resolution: null,
  receipt: { status: 403, outcome: "blocked" },
};

function run(
  fake: ReturnType<typeof ingress>,
  env: Record<string, string> = {},
  extra: Partial<DiscoverCliDeps> = {},
) {
  const out: string[] = [];
  let sleeps = 0;
  const done = main({
    egress: async () => ({ ok: true, egress: EG }),
    readCatalog: () => null,
    clock: () => new Date("2026-01-02T00:00:00.000Z"),
    ...extra,
    fetch: fake.fetch,
    env: { DISCOVER_POLL_MS: "1", TRAVIS_DISCOVERY_RUN_ID: "travis", ...env },
    out: (l) => out.push(l),
    sleep: async () => {
      sleeps += 1;
    },
    now: () => sleeps * 1000,
  });
  return { done, out, sleeps: () => sleeps };
}

describe("discover", () => {
  it("sends the run to TravisDiscovery/<run id> on the default ingress and waits for WAITING_HUMAN", async () => {
    const fake = ingress([
      null,
      record({}),
      record({
        state: "WAITING_HUMAN",
        blockers: [BLOCKER],
        waiting_since: "2026-01-01T01:00:00.000Z",
        validator: { exit_code: 1, report_path: "docs/evidence/A-01-readiness.json" },
      }),
    ]);
    const r = run(fake);
    expect(await r.done).toBe(0);
    expect(fake.calls[0]?.url).toBe("http://localhost:8080/TravisDiscovery/travis/status");
    expect(fake.calls[1]).toEqual({
      url: "http://localhost:8080/TravisDiscovery/travis/run/send",
      method: "POST",
      body: JSON.stringify({ egress: EG }),
    });
    expect(
      fake.calls
        .slice(2)
        .every((c) => c.url === "http://localhost:8080/TravisDiscovery/travis/status"),
    ).toBe(true);
    const text = r.out.join("\n");
    expect(text).toMatch(/state WAITING_HUMAN/);
    expect(text).toMatch(/blocker tcad_certified \(blocked, HTTP 403, waiting for a human\)/);
    expect(text).toMatch(/validator exit 1/);
  });

  it("does not stop on a transient WAITING_HUMAN before the run starts waiting", async () => {
    const fake = ingress([
      record({ state: "WAITING_HUMAN", blockers: [BLOCKER] }),
      record({ state: "DISCOVERING" }),
      record({ state: "READY", completed_at: "2026-01-01T02:00:00.000Z" }),
    ]);
    const r = run(fake);
    expect(await r.done).toBe(0);
    expect(r.out.join("\n")).toMatch(/READY; seed is never started automatically/);
    expect(fake.calls.filter((c) => c.url.endsWith("/status"))).toHaveLength(3);
  });

  it("honours RESTATE_INGRESS_URL and TRAVIS_DISCOVERY_RUN_ID", async () => {
    const fake = ingress([record({ state: "READY", completed_at: "2026-01-01T02:00:00.000Z" })]);
    const r = run(fake, {
      RESTATE_INGRESS_URL: "http://127.0.0.1:18080/",
      TRAVIS_DISCOVERY_RUN_ID: "travis-2",
    });
    expect(await r.done).toBe(0);
    expect(fake.calls[0]?.url).toBe("http://127.0.0.1:18080/TravisDiscovery/travis-2/status");
    expect(fake.calls[1]?.url).toBe("http://127.0.0.1:18080/TravisDiscovery/travis-2/run/send");
  });

  it("shows an existing run instead of starting a second one", async () => {
    const fake = ingress(
      [record({ state: "READY", completed_at: "2026-01-01T02:00:00.000Z" })],
      () => Response.json({ status: "PreviouslyAccepted" }),
    );
    const r = run(fake);
    expect(await r.done).toBe(0);
    expect(r.out.join("\n")).toMatch(/already exists/);
  });

  it("exits 1 when the ingress is unreachable", async () => {
    const r = run({
      calls: [],
      fetch: async () => {
        throw new Error("connect ECONNREFUSED");
      },
    });
    expect(await r.done).toBe(1);
    expect(r.out.join("\n")).toMatch(/unreachable/);
  });

  it("exits 1 when the ingress refuses the run (deployment not registered)", async () => {
    const r = run(ingress([null], () => new Response("{}", { status: 404 })));
    expect(await r.done).toBe(1);
    expect(r.out.join("\n")).toMatch(/HTTP 404/);
  });

  it("exits 1 when the run is still discovering after DISCOVER_MAX_HOURS", async () => {
    const fake = ingress([record({})]);
    const r = run(fake, { DISCOVER_MAX_HOURS: "0.001" });
    expect(await r.done).toBe(1);
    expect(r.out.join("\n")).toMatch(/still DISCOVERING/);
  });

  it("CR-3: refuses without TRAVIS_DISCOVERY_RUN_ID (no default run id); nothing sent", async () => {
    const fake = ingress([null]);
    const r = run(fake, { TRAVIS_DISCOVERY_RUN_ID: "" });
    expect(await r.done).toBe(2);
    expect(r.out.join("\n")).toMatch(/refused: set TRAVIS_DISCOVERY_RUN_ID/);
    expect(fake.calls).toEqual([]);
  });

  it("CR-3: refuses a new run when the committed catalog carries offline amendments", async () => {
    const amended: Catalog = {
      ...syntheticUs1Catalog(),
      amendments: [
        { command: "explain-blocked", at: "2026-01-01T01:00:00Z", fields: ["x"], ref: "y" },
      ],
    };
    const fake = ingress([null]);
    let egressChecked = false;
    const r = run(
      fake,
      {},
      {
        readCatalog: () => amended,
        egress: async () => {
          egressChecked = true;
          return { ok: true, egress: EG };
        },
      },
    );
    expect(await r.done).toBe(2);
    expect(r.out.join("\n")).toMatch(
      /a new run could not write the catalog: .*1 offline amendment/,
    );
    expect(fake.calls.some((c) => c.url.endsWith("/run/send"))).toBe(false);
    expect(egressChecked).toBe(false);
  });

  it("OR-B1: refuses a new run when the egress check fails; nothing sent", async () => {
    const fake = ingress([null]);
    const r = run(
      fake,
      {},
      {
        egress: async () => ({
          ok: false,
          reason: "egress country is GB, but ORACLE_EXPECT_EGRESS is EG",
        }),
      },
    );
    expect(await r.done).toBe(2);
    expect(r.out.join("\n")).toMatch(/refused: egress country is GB/);
    expect(fake.calls.some((c) => c.url.endsWith("/run/send"))).toBe(false);
  });

  it("OR-B1: an existing run is shown without a new egress check", async () => {
    const fake = ingress(
      [record({ state: "READY", completed_at: "2026-01-01T02:00:00.000Z" })],
      () => Response.json({ status: "PreviouslyAccepted" }),
    );
    const r = run(
      fake,
      {},
      {
        egress: async () => {
          throw new Error("must not be called");
        },
      },
    );
    expect(await r.done).toBe(0);
    expect(fake.calls.find((c) => c.url.endsWith("/run/send"))?.body).toBeUndefined();
  });
});
