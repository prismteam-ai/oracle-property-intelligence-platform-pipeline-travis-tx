// A-04 T042 / T043: the US-runner workflow file (offline parse) and the runner artifact the
// laptop imports. Offline; artifacts are SYNTHETIC TEST INPUT written to a temp folder, except
// the `A-04-TC-020 pilot|full` cases, which read a real downloaded artifact only when
// GIS_ARTIFACT points at one (lead, Phase 7) and are skipped otherwise.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { PRIVATE_FIELD, RunnerConfig } from "../../../travis/gis/runner-fetch.js";

const REPO = new URL("../../../../../", import.meta.url);
const WORKFLOW_PATH = ".github/workflows/a04-gis-capture.yml";
const CONFIG_PATH = "pipeline/oracle-runtime/travis/gis/runner-config.json";
const workflowText = (): string => readFileSync(new URL(WORKFLOW_PATH, REPO), "utf8");

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  with?: Record<string, unknown>;
}
interface Workflow {
  on: Record<string, unknown> & { push?: { branches?: string[]; paths?: string[] } };
  permissions: unknown;
  concurrency: unknown;
  jobs: Record<
    string,
    { "runs-on": string; "timeout-minutes": number; steps: Step[]; if?: unknown }
  >;
}

describe("A-04-TC-020 workflow: .github/workflows/a04-gis-capture.yml (D-2, contracts/gis-runner.md)", () => {
  const wf = (): Workflow => parse(workflowText()) as Workflow;
  const steps = (): Step[] => Object.values(wf().jobs).flatMap((j) => j.steps);

  it("A-04-TC-020 workflow is push-triggered on the story branch, paths = the workflow + runner-config.json, no workflow_dispatch", () => {
    const on = wf().on;
    expect(Object.keys(on)).toEqual(["push"]);
    expect(on.push?.branches).toEqual(["004-property-backbone"]);
    expect([...(on.push?.paths ?? [])].sort()).toEqual([WORKFLOW_PATH, CONFIG_PATH].sort());
    expect(workflowText()).not.toMatch(/workflow_dispatch/);
  });

  it("A-04-TC-020 workflow reads contents only, uses no secret, one job on ubuntu-latest with the planned limits", () => {
    expect(wf().permissions).toEqual({ contents: "read" });
    expect(workflowText()).not.toMatch(/secrets\./);
    expect(wf().concurrency).toEqual({ group: "gis-pages", "cancel-in-progress": false });
    const jobs = Object.values(wf().jobs);
    expect(jobs).toHaveLength(2); // gate + capture
    const capture = wf().jobs.capture;
    expect(capture?.["runs-on"]).toBe("ubuntu-latest");
    expect(capture?.["timeout-minutes"]).toBe(90);
  });

  it("A-04-TC-020 workflow is fetch-only: no Query DB, no DATABASE_URL, no publish or IPFS upload step", () => {
    const text = workflowText();
    expect(text).not.toMatch(
      /postgres|psql|DATABASE_URL|QDB|elephant-cli|ipfs|pinata|filebase|aws /i,
    );
    const uses = steps().flatMap((s) => (s.uses === undefined ? [] : [s.uses.replace(/@.*$/, "")]));
    for (const u of uses) {
      expect([
        "actions/checkout",
        "actions/setup-node",
        "actions/cache/restore",
        "actions/cache/save",
        "actions/upload-artifact",
      ]).toContain(u);
    }
    for (const s of steps()) expect(s.run ?? "").not.toMatch(/upload|curl -X POST|git push/i);
    const fetch = steps().filter((s) => /travis\/gis\/runner-fetch\.ts/.test(s.run ?? ""));
    expect(fetch).toHaveLength(1);
    expect(fetch[0]?.run).toMatch(/--config travis\/gis\/runner-config\.json --out out/);
  });

  it("A-04-TC-020 workflow logs only the egress country (loc=), saves the cache and uploads the artifact always, kept 7 days", () => {
    const egress = steps().filter((s) => /cdn-cgi\/trace/.test(s.run ?? ""));
    expect(egress).toHaveLength(1);
    expect(egress[0]?.run).toMatch(/grep '\^loc='/);
    expect(egress[0]?.run).not.toMatch(/colo|ip=/);
    const save = steps().filter((s) => s.uses?.startsWith("actions/cache/save"));
    expect(save).toHaveLength(1);
    expect(save[0]?.if).toBe("always()");
    const upload = steps().filter((s) => s.uses?.startsWith("actions/upload-artifact"));
    expect(upload).toHaveLength(1);
    expect(upload[0]?.if).toBe("always()");
    expect(upload[0]?.with?.["retention-days"]).toBe(7);
  });

  it("A-04 runner-config.json safety rule: attempt >= 1, mode pilot|full, full mode requests only OBJECTID/PROP_ID/geo_id", () => {
    const cfg = JSON.parse(readFileSync(new URL(CONFIG_PATH, REPO), "utf8")) as Record<
      string,
      unknown
    >;
    expect(Number.isInteger(cfg.attempt) && (cfg.attempt as number) >= 1).toBe(true);
    expect(["pilot", "full"]).toContain(cfg.mode);
    expect(RunnerConfig.safeParse({ ...cfg, attempt: 0 }).success).toBe(false);
    const outFields = cfg.outFields as string[];
    if (cfg.mode === "full") {
      for (const f of outFields) expect(["OBJECTID", "PROP_ID", "geo_id"]).toContain(f);
      for (const k of ["pidField", "geoidField"]) {
        if (cfg[k] !== null) expect(outFields).toContain(cfg[k]);
      }
    }
    for (const f of outFields) expect(f).not.toMatch(PRIVATE_FIELD);
    // OR-m12: `enabled` defaults to true; both values are allowed
    expect(cfg.enabled === undefined || typeof cfg.enabled === "boolean").toBe(true);
    expect(RunnerConfig.parse({ ...cfg, enabled: undefined }).enabled).toBe(true);
    expect(RunnerConfig.parse({ ...cfg, enabled: false }).enabled).toBe(false);
  });

  it("OR-m12 a first `gate` job reads runner-config.json `enabled`; the capture job needs it and runs only when enabled", () => {
    const w = wf();
    const gate = w.jobs.gate as unknown as { steps: Step[]; outputs?: Record<string, string> };
    expect(gate).toBeDefined();
    expect(gate.outputs?.enabled).toMatch(/steps\.\w+\.outputs\.enabled/);
    expect(gate.steps.map((s) => s.run ?? "").join("\n")).toMatch(/runner-config\.json/);
    const cap = w.jobs.capture as unknown as { needs?: string; if?: string };
    expect(cap.needs).toBe("gate");
    expect(String(cap.if)).toMatch(/needs\.gate\.outputs\.enabled\s*==\s*'true'/);
    // the gate has no secrets, no fetch of the source host
    expect(JSON.stringify(gate)).not.toMatch(/gis\.traviscountytx|secrets\./);
  });

  it("A-04-TC-020 workflow runner-config.json parses, names a mode, and its outFields hold no owner or address field", () => {
    const cfg = RunnerConfig.parse(JSON.parse(readFileSync(new URL(CONFIG_PATH, REPO), "utf8")));
    expect(["pilot", "full"]).toContain(cfg.mode);
    for (const f of cfg.outFields) expect(f).not.toMatch(PRIVATE_FIELD);
    expect(cfg.bulkPageSize).toBeLessThanOrEqual(2000);
    const base = JSON.parse(readFileSync(new URL(CONFIG_PATH, REPO), "utf8")) as Record<
      string,
      unknown
    >;
    for (const bad of ["OWNER_NAME", "SITUS_ADDRESS", "MAIL_ZIP", "PY_OWNER_ID"]) {
      expect(RunnerConfig.safeParse({ ...base, outFields: ["OBJECTID", bad] }).success, bad).toBe(
        false,
      );
    }
    expect(RunnerConfig.safeParse({ ...base, bulkPageSize: 2001 }).success).toBe(false);
    expect(
      RunnerConfig.safeParse({ ...base, layerUrl: "https://example.com/MapServer/6" }).success,
    ).toBe(false);
  });
});

// ---- T043: the artifact the laptop imports (SYNTHETIC TEST INPUT made by the real runner code
// against the in-process fake layer; never a real capture) ----
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import { createSourceClient } from "../../../travis/lib/source-client.js";
import { runGisCapture } from "../../../travis/gis/runner-fetch.js";
import { gisBlockedLimitation, inspectArtifact, readFeatures } from "../../../travis/gis/import.js";
import {
  FAKE_LAYER,
  fakeArcgis,
  seeded,
  type FakeOptions,
} from "../../fixtures/a04/gis/fake-arcgis.js";

const made: string[] = [];
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function artifact(
  fake: FakeOptions,
  over: Record<string, unknown> = {},
  egress = "loc=US\n",
): Promise<string> {
  const parent = mkdtempSync(join(tmpdir(), "a04-gis-art-"));
  made.push(parent);
  const dir = join(parent, "us-runner-4242");
  mkdirSync(dir);
  writeFileSync(join(dir, "egress.txt"), egress);
  let t = Date.parse("2026-10-22T03:00:00Z");
  await runGisCapture({
    config: RunnerConfig.parse({
      mode: "full",
      layerUrl: FAKE_LAYER,
      outFields: ["OBJECTID", "PROP_ID", "GEO_ID"],
      pidField: "PROP_ID",
      geoidField: "GEO_ID",
      bulkPageSize: 2,
      bulkConcurrency: 1,
      userAgent: RunnerConfig.shape.userAgent.value,
      ...over,
    }),
    outDir: dir,
    source: createSourceClient({
      fetch: fakeArcgis(fake).fetch,
      sleep: async () => {},
      timeoutMs: 15,
      log: () => {},
    }),
    sleep: async () => {},
    random: seeded(7),
    now: () => new Date((t += 1000)),
  });
  return dir;
}

describe("A-04 T043 GIS artifact import (import.ts)", () => {
  it("a complete artifact validates: meta/count/ids/pages/receipts/complete, each page sha256 = its receipt", async () => {
    const dir = await artifact({ total: 6 });
    const s = inspectArtifact(dir);
    expect(s.status).toBe("complete");
    expect(s.limitation).toBeNull();
    expect(s.artifactRunId).toBe("4242");
    expect(s.egressLoc).toBe("US");
    expect(s.pages).toHaveLength(3);
    expect(s.sourceCount).toBe(6);
    expect(s.artifactSha256).toMatch(/^[a-f0-9]{64}$/);
    const rows = [...readFeatures(s)];
    expect(rows).toHaveLength(6);
    expect(rows[0]).toMatchObject({
      object_id: 1,
      pid_value: "91",
      geoid_value: "01",
      null_geometry: false,
    });
    expect(rows.every((r) => r.point_lat !== null && r.point_method === "centroid")).toBe(true);
    const page = s.pages[0];
    expect(rows[0]?.page_key).toBe(page?.pageKey);
    expect(page?.url).toMatch(/^https:\/\/gis\.traviscountytx\.gov\/.*\/query\?/);
  });

  it("a page whose bytes differ from its receipt sha256 is refused, naming the page", async () => {
    const dir = await artifact({ total: 4 });
    const f = readdirSync(join(dir, "pages"))[0] ?? "";
    writeFileSync(join(dir, "pages", f), '{"features":[]}');
    expect(() => inspectArtifact(dir)).toThrow(
      new RegExp(`page ${f.replace(".json", "")}.*sha256`),
    );
  });

  it("egress.txt must be loc=US (the runner's country), else the artifact is refused", async () => {
    const dir = await artifact({ total: 2 }, {}, "loc=EG\n");
    expect(() => inspectArtifact(dir)).toThrow(/egress/);
  });

  it("A-04-TC-026 import: no complete.json → status blocked, limitation exactly `gis: blocked at {ts}; coverage not complete`", async () => {
    const dir = await artifact({ total: 10, page: (n) => (n === 3 ? "timeout" : undefined) });
    expect(existsSync(join(dir, "complete.json"))).toBe(false);
    const s = inspectArtifact(dir);
    const blockedAt = JSON.parse(readFileSync(join(dir, "blocked.json"), "utf8"))
      .blocked_at as string;
    expect(s.status).toBe("blocked");
    expect(s.complete).toBeNull();
    expect(s.blockedAt).toBe(blockedAt);
    expect(s.limitation).toBe(`gis: blocked at ${blockedAt}; coverage not complete`);
    expect(gisBlockedLimitation(blockedAt)).toBe(s.limitation);
    // partial pages are still facts (2 pages kept), but never reported as complete coverage
    expect(s.pages).toHaveLength(2);
  });

  it("a pilot artifact is not complete either (status blocked, detail pilot)", async () => {
    const dir = await artifact({ total: 10 }, { mode: "pilot" });
    const s = inspectArtifact(dir);
    expect(s.status).toBe("blocked");
    expect(s.detail).toBe("pilot");
    expect(s.limitation).toMatch(/^gis: blocked at .+; coverage not complete$/);
  });

  it("a null geometry is kept as null_geometry with no point", async () => {
    const dir = await artifact({ total: 2 });
    const f = readdirSync(join(dir, "pages"))[0] ?? "";
    const body = JSON.parse(readFileSync(join(dir, "pages", f), "utf8"));
    body.features[0].geometry = null;
    const text = JSON.stringify(body);
    writeFileSync(join(dir, "pages", f), text);
    // re-stamp the receipt so only the geometry differs (synthetic)
    const { createHash } = await import("node:crypto");
    const sha = createHash("sha256").update(text).digest("hex");
    const lines = readFileSync(join(dir, "receipts.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    for (const r of lines) if (r.page_key === f.replace(".json", "")) r.sha256 = sha;
    writeFileSync(
      join(dir, "receipts.jsonl"),
      `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`,
    );
    const rows = [...readFeatures(inspectArtifact(dir))];
    expect(rows[0]).toMatchObject({
      null_geometry: true,
      point_lat: null,
      point_lon: null,
      point_method: null,
    });
  });
});

// The real downloaded artifact (lead, Phase 7): GIS_ARTIFACT=pipeline/data/raw/gis/us-runner-<id>.
const REAL = process.env.GIS_ARTIFACT;
const realDir = (): string => (REAL === undefined ? "" : new URL(REAL, REPO).pathname);

describe.skipIf(REAL === undefined)("A-04-TC-020 runner artifact (GIS_ARTIFACT)", () => {
  it("A-04-TC-020 pilot: loc=US; meta, count and ids present; one page with receipt URL, UTC time and SHA-256", () => {
    const s = inspectArtifact(realDir());
    expect(s.egressLoc).toBe("US");
    for (const f of ["meta.json", "count.json", "ids.json"])
      expect(existsSync(join(s.root, f)), f).toBe(true);
    expect(s.pages.length).toBeGreaterThanOrEqual(1);
    const p = s.pages[0];
    expect(p?.url).toMatch(/^https:\/\/gis\.traviscountytx\.gov\//);
    expect(p?.capturedAt).toMatch(/Z$/);
    expect(p?.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("A-04-TC-020 full: complete.json mode full; pages = ceil(count / page size); ids none missing or twice; ≤ 2 in flight", () => {
    const s = inspectArtifact(realDir());
    expect(s.status).toBe("complete");
    expect(s.complete?.mode).toBe("full");
    const pageSize = s.complete?.page_size ?? 0;
    expect(pageSize).toBeLessThanOrEqual(2000);
    expect(s.complete?.features).toBe(s.sourceCount);
    expect(s.pages).toHaveLength(Math.ceil((s.sourceCount ?? 0) / pageSize));
    expect(s.complete?.concurrency).toBeLessThanOrEqual(2);
    const ids = [...readFeatures(s)].map((r) => r.object_id);
    expect(new Set(ids).size).toBe(ids.length);
    const snapshot = JSON.parse(readFileSync(join(s.root, "ids.json"), "utf8"))
      .objectIds as number[];
    expect([...ids].sort((a, b) => a - b)).toEqual([...snapshot].sort((a, b) => a - b));
  });
});

// ---- T043: the GisImport workflow handler and the `backbone coords` verb (fake Restate) ----
import { COMMANDS_DIR, runCli, type CliDeps } from "../../../travis/backbone/cli.js";
import type { RestateIngressClient } from "../../../travis/backbone/restate-client.js";
import { createGisImport, type GisMergeInput } from "../../../travis/gis/workflow.js";

class FakeTerminal extends Error {}
const fakeRestate = {
  workflow: (def: unknown) => def,
  TerminalError: FakeTerminal,
} as unknown as Parameters<typeof createGisImport>[0];

type RunHandler = (
  ctx: unknown,
  req: unknown,
) => Promise<{
  jobId: string;
  gis: null | {
    status: string;
    limitation: string | null;
    pages: number;
    artifactRunId: string;
    rowsWritten: number;
  };
  assembled: null | { rowsWritten: number };
}>;
const handlerOf = (merges: GisMergeInput[]): RunHandler => {
  const def = createGisImport(fakeRestate, {
    merge: async (_ctx, input) => {
      merges.push(input);
      return { rowsWritten: 3, skipped: false };
    },
  }) as unknown as { name: string; handlers: { run: RunHandler } };
  expect(def.name).toBe("GisImport");
  return def.handlers.run;
};
const fakeCtx = (key: string) => ({ key, run: async (_n: string, fn: () => unknown) => fn() });

describe("A-04 T043 GisImport workflow (workflow.ts)", () => {
  it("imports through the Loader gis track, then assembles under the same coords job", async () => {
    const dir = await artifact({ total: 4 });
    const merges: GisMergeInput[] = [];
    const run = handlerOf(merges);
    const out = await run(fakeCtx("travis-a04-coords-20261022050000"), {
      artifactDir: dir,
      assemble: true,
      tcadJobId: null,
    });
    expect(merges.map((m) => m.kind)).toEqual(["import", "assemble"]);
    expect(merges[0]).toMatchObject({
      kind: "import",
      jobId: "travis-a04-coords-20261022050000",
      artifactRunId: "4242",
    });
    expect(merges[0]?.artifactSha256).toBe(inspectArtifact(dir).artifactSha256);
    expect(merges[1]).toMatchObject({
      kind: "assemble",
      tcadJobId: null,
      artifactPath: "assemble:travis-a04-coords-20261022050000",
    });
    expect(merges[1]?.artifactSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(out.gis).toMatchObject({ status: "complete", limitation: null, pages: 2 });
  });

  it("A-04-TC-026 import: a blocked artifact is imported as blocked; coverage is never called complete", async () => {
    const dir = await artifact({ total: 10, page: (n) => (n === 2 ? 403 : undefined) });
    const run = handlerOf([]);
    const out = await run(fakeCtx("travis-a04-coords-202610220501"), {
      artifactDir: dir,
      assemble: false,
      tcadJobId: null,
    });
    expect(out.gis?.status).toBe("blocked");
    expect(out.gis?.limitation).toMatch(/^gis: blocked at \S+; coverage not complete$/);
  });

  it("refuses a key that is not a travis-a04 job id and a request without a step", async () => {
    const run = handlerOf([]);
    await expect(
      run(fakeCtx("x"), { artifactDir: null, assemble: true, tcadJobId: null }),
    ).rejects.toBeInstanceOf(FakeTerminal);
    await expect(
      run(fakeCtx("travis-a04-coords-1"), { artifactDir: null, assemble: false, tcadJobId: null }),
    ).rejects.toBeInstanceOf(FakeTerminal);
  });
});

function cli(gisResult: unknown) {
  const calls: Array<{ service: string; handler: string; body: unknown; key?: string }> = [];
  const out: string[] = [];
  const err: string[] = [];
  const ingress: RestateIngressClient = {
    call: async <T>(service: string, handler: string, body: unknown, key?: string) => {
      calls.push({ service, handler, body, ...(key === undefined ? {} : { key }) });
      if (service === "BackboneReport" && handler === "running") return null as T;
      return gisResult as T;
    },
    send: async () => ({ invocationId: "inv" }),
    callLong: async <T>() => null as T,
    get: async <T>() => null as T,
  };
  const deps: CliDeps = {
    commandsDir: COMMANDS_DIR,
    ingress,
    now: () => new Date("2026-10-22T05:00:00Z"),
    env: {},
    freeBytes: () => 50 * 2 ** 30,
    stdout: (s) => void out.push(s),
    stderr: (s) => void err.push(s),
  };
  return { deps, calls, out, err };
}

describe("A-04 T043 `backbone coords` (contracts/cli.md)", () => {
  const done = {
    jobId: "x",
    gis: {
      status: "complete",
      limitation: null,
      pages: 187,
      features: 373683,
      artifactRunId: "1",
      rowsWritten: 9,
      detail: "complete",
    },
    addressPoints: null,
    assembled: { rowsWritten: 5 },
  };

  it("--gis-artifact starts GisImport (import + assemble) and prints job_id=travis-a04-coords-… last", async () => {
    const h = cli(done);
    const code = await runCli(
      ["coords", "--gis-artifact", "pipeline/data/raw/gis/us-runner-1"],
      h.deps,
    );
    expect(code).toBe(0);
    const call = h.calls.find((c) => c.service === "GisImport");
    expect(call).toMatchObject({ handler: "run", key: "travis-a04-coords-20261022050000" });
    expect(call?.body).toMatchObject({ assemble: true, tcadJobId: null });
    expect(String((call?.body as { artifactDir: string }).artifactDir)).toMatch(
      /pipeline\/data\/raw\/gis\/us-runner-1$/,
    );
    expect(h.out.at(-1)).toBe("job_id=travis-a04-coords-20261022050000\n");
  });

  it("a blocked artifact exits 2 and prints the limitation", async () => {
    const h = cli({
      ...done,
      gis: {
        ...done.gis,
        status: "blocked",
        limitation: "gis: blocked at 2026-10-22T03:00:00Z; coverage not complete",
      },
    });
    const code = await runCli(["coords", "--gis-artifact", "/tmp/a"], h.deps);
    expect(code).toBe(2);
    expect(h.out.join("")).toContain("gis: blocked at 2026-10-22T03:00:00Z; coverage not complete");
  });

  it("--assemble-only skips the import; --job names the TCAD job", async () => {
    const h = cli({ ...done, gis: null });
    const code = await runCli(
      ["coords", "--assemble-only", "--job", "travis-a04-202610220100"],
      h.deps,
    );
    expect(code).toBe(0);
    expect(h.calls.find((c) => c.service === "GisImport")?.body).toEqual({
      artifactDir: null,
      assemble: true,
      addressPointsDir: null,
      tcadJobId: "travis-a04-202610220100",
    });
  });

  it("no mode, or two modes at once, is a usage error (exit 64)", async () => {
    expect(await runCli(["coords"], cli(done).deps)).toBe(64);
    expect(
      await runCli(["coords", "--gis-artifact", "/a", "--assemble-only"], cli(done).deps),
    ).toBe(64);
    expect(await runCli(["coords", "--coverage"], cli(done).deps)).toBe(64);
  });
});
