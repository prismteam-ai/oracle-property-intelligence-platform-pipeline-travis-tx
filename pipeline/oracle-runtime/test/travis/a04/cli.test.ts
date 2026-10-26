// A-04 T010 (A-04-TC-018, FR-025): the `backbone` CLI dispatcher. Offline: the Restate ingress
// and the disk are fakes; commands are synthetic fixtures under test/fixtures/a04/commands.
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COMMANDS_DIR, EXIT, runCli, type CliDeps } from "../../../travis/backbone/cli.js";
import {
  DiskGuardError,
  MIN_FREE_BYTES,
  checkDiskSpace,
} from "../../../travis/backbone/disk-guard.js";
import {
  createRestateIngressClient,
  type RestateIngressClient,
} from "../../../travis/backbone/restate-client.js";
import { jobIdFor } from "../../../travis/backbone/run-context.js";

const COMMANDS = fileURLToPath(new URL("../../fixtures/a04/commands/", import.meta.url));
const RUNNING = "travis-a04-202610220100";
const FIXED = new Date("2026-10-22T03:04:00Z");

function harness(
  opts: {
    running?: string | null;
    freeBytes?: number;
    env?: Record<string, string>;
    commandsDir?: string;
  } = {},
) {
  const calls: string[] = [];
  const sent: unknown[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const ingress: RestateIngressClient = {
    async call<T>(service: string, handler: string): Promise<T> {
      calls.push(`${service}/${handler}`);
      if (service === "BackboneReport" && handler === "running") {
        return (
          opts.running === undefined || opts.running === null
            ? null
            : {
                job_id: opts.running,
                track: "appraisal",
                mode: "full",
                started_at: "2026-10-22T01:00:00Z",
              }
        ) as T;
      }
      if (service === "TcadBackbone" && handler === "status") {
        return { status: "complete", clean: true } as T;
      }
      return null as T;
    },
    async send(service, key, handler, payload) {
      sent.push(payload);
      calls.push(`${service}/${key}/${handler}/send`);
      return { invocationId: "inv_synthetic" };
    },
    async callLong<T>(): Promise<T> {
      return null as T;
    },
    async get<T>(service: string, key: string): Promise<T> {
      calls.push(`${service}/${key}/output`);
      return null as T;
    },
  };
  const deps: CliDeps = {
    commandsDir: opts.commandsDir ?? COMMANDS,
    ingress,
    now: () => FIXED,
    env: opts.env ?? {},
    freeBytes: () => opts.freeBytes ?? 50 * 1024 ** 3,
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
  };
  return { deps, calls, sent, out, err };
}

describe("A-04 backbone CLI", () => {
  it("A-04-TC-018 a start is refused (exit 1) while another job is running; no Restate start is sent", async () => {
    const h = harness({ running: RUNNING });
    const code = await runCli(["ingest", "--track", "appraisal"], h.deps);
    expect(code).toBe(1);
    expect(h.err.join("")).toContain(RUNNING);
    expect(h.calls).toEqual(["BackboneReport/running"]);
  });

  it("loads travis/backbone/commands/<verb>.ts and prints job_id=<id> as the last stdout line", async () => {
    const h = harness();
    const code = await runCli(["ingest", "--track", "appraisal"], h.deps);
    expect(code).toBe(EXIT.ok);
    expect(h.calls).toEqual([
      "BackboneReport/running",
      "TcadBackbone/travis-a04-20261022030400/run/send",
    ]);
    const lines = h.out.join("").trimEnd().split("\n");
    expect(lines.at(-1)).toBe("job_id=travis-a04-20261022030400");
  });

  it("sends the SAFE batch defaults (2000 / 3 / 1000 ms) when the flags are absent", async () => {
    const h = harness({ commandsDir: COMMANDS_DIR });
    expect(await runCli(["ingest", "--track", "appraisal"], h.deps)).toBe(EXIT.ok);
    expect(h.sent[0]).toMatchObject({ chunkSize: 2000, window: 3, batchPauseMs: 1000 });
  });

  it("passes --chunk-size, --window and --batch-pause-ms through", async () => {
    const h = harness({ commandsDir: COMMANDS_DIR });
    const argv = ["ingest", "--track", "appraisal", "--chunk-size", "500", "--window", "1"];
    expect(await runCli([...argv, "--batch-pause-ms", "0"], h.deps)).toBe(EXIT.ok);
    expect(h.sent[0]).toMatchObject({ chunkSize: 500, window: 1, batchPauseMs: 0 });
  });

  it("the poll prints the progress counts on every poll", async () => {
    const lines: string[] = [];
    const replies = [
      {
        status: "running",
        progress: {
          chunks_done: 1,
          chunks_started: 2,
          chunks_total: null,
          records_loaded: 2000,
          records_per_s: 41.5,
        },
      },
      { status: "complete", records: 4000, loaded: 4000, clean: true },
    ];
    const { waitForRun } = await import("../../../travis/backbone/commands/ingest.js");
    const ctx = {
      ingress: { call: async () => replies.shift() },
      print: (l: string) => lines.push(l),
    };
    expect(await waitForRun(ctx as never, "travis-a04-20261022030400", 0)).toBe(0);
    expect(lines[0]).toBe("tcad: progress chunks=1/? started=2 loaded=2000 rps=41.5");
  });

  it.each([
    ["--chunk-size", "99"],
    ["--chunk-size", "20001"],
    ["--chunk-size", "abc"],
    ["--window", "0"],
    ["--window", "9"],
    ["--batch-pause-ms", "600001"],
    ["--batch-pause-ms", "-1"],
  ])("rejects %s %s (out of range) with exit 64 and sends nothing", async (flag, value) => {
    const h = harness({ commandsDir: COMMANDS_DIR });
    expect(await runCli(["ingest", "--track", "appraisal", flag, value], h.deps)).toBe(64);
    expect(h.calls.filter((c) => c.endsWith("/send"))).toEqual([]);
  });

  it("an unknown verb exits 64 with the verb list", async () => {
    const h = harness();
    expect(await runCli(["publish"], h.deps)).toBe(64);
    expect(h.err.join("")).toMatch(/verbs: ingest, report/);
    expect(await runCli([], h.deps)).toBe(64);
  });

  it("a bad flag exits 64 with the verb list", async () => {
    const h = harness();
    expect(await runCli(["ingest", "--track", "permits"], h.deps)).toBe(64);
    expect(await runCli(["ingest", "--track", "appraisal", "--nope"], h.deps)).toBe(64);
    expect(await runCli(["ingest", "stray"], h.deps)).toBe(64);
    expect(h.err.join("")).toMatch(/verbs: ingest, report/);
    expect(h.calls).toEqual([]);
  });

  it("a read-only verb does not ask for the running job", async () => {
    const h = harness({ running: RUNNING });
    expect(await runCli(["report", "--job", RUNNING, "--json"], h.deps)).toBe(0);
    expect(h.calls).toEqual([]);
  });

  it("the disk guard below 5 GiB free exits 4 before anything starts", async () => {
    const h = harness({ freeBytes: MIN_FREE_BYTES - 1 });
    expect(await runCli(["ingest", "--track", "appraisal"], h.deps)).toBe(4);
    expect(h.calls.filter((c) => c.endsWith("/send"))).toEqual([]);
    expect(MIN_FREE_BYTES).toBe(5 * 1024 ** 3);
    expect(() => checkDiskSpace(MIN_FREE_BYTES - 1)).toThrow(DiskGuardError);
    expect(() => checkDiskSpace(MIN_FREE_BYTES)).not.toThrow();
  });

  it("stdout and stderr never contain DATABASE_URL, postgres:// or env values", async () => {
    const env = {
      DATABASE_URL: "postgres://synthetic:synthetic-pw@localhost:5432/elephant",
      SYNTH_API_TOKEN: "tok_synthetic_0123456789",
    };
    const saved = { ...process.env };
    Object.assign(process.env, env);
    try {
      const h = harness({ env });
      const code = await runCli(["ingest", "--track", "appraisal", "--leak"], h.deps);
      expect(code).toBe(1);
      const all = h.out.join("") + h.err.join("");
      expect(all).not.toContain("DATABASE_URL");
      expect(all).not.toContain("postgres://");
      expect(all).not.toContain("synthetic-pw");
      expect(all).not.toContain(env.SYNTH_API_TOKEN);
    } finally {
      process.env = saved;
    }
  });

  it("job ids follow travis-a04-[kind-]<yyyymmddhhmmss>", () => {
    expect(jobIdFor(null, FIXED)).toBe("travis-a04-20261022030400");
    expect(jobIdFor("permits-backfill", FIXED)).toBe("travis-a04-permits-backfill-20261022030400");
  });

  it("the ingress client posts to RESTATE_INGRESS_URL (default http://localhost:8080)", async () => {
    const seen: string[] = [];
    const fetch = async (url: string, init: RequestInit) => {
      seen.push(`${init.method ?? "GET"} ${url}`);
      return new Response(JSON.stringify({ invocationId: "inv_1" }), { status: 200 });
    };
    await createRestateIngressClient({ env: {}, fetch }).send("TcadBackbone", "k1", "run", {});
    await createRestateIngressClient({
      env: { RESTATE_INGRESS_URL: "http://restate.test:18080/" },
      fetch,
    }).call("BackboneReport", "running", null);
    expect(seen).toEqual([
      "POST http://localhost:8080/TcadBackbone/k1/run/send",
      "POST http://restate.test:18080/BackboneReport/running",
    ]);
  });
});

describe("A-04 backbone CLI ingest --join-proof output contract", () => {
  it("prints the join_proof=pass|fail line last (contracts/cli.md), job_id before it", async () => {
    const h = harness();
    const proof = {
      pass: false,
      matched: 998,
      disagreements: 2,
      no_tcad_geoid: 0,
      ambiguous_geoid: 0,
      reverse_checked: 5,
      reverse_disagreements: 0,
    };
    const ingress: RestateIngressClient = {
      ...h.deps.ingress,
      async callLong<T>(): Promise<T> {
        return proof as T;
      },
    };
    const code = await runCli(
      ["ingest", "--join-proof", "--job", "travis-a04-20261022030400", "--seed", "7"],
      { ...h.deps, commandsDir: COMMANDS_DIR, ingress },
    );
    expect(code).toBe(EXIT.error);
    const lines = h.out.join("").trimEnd().split("\n");
    expect(lines.at(-1)).toBe("join_proof=fail matched=998 disagreements=2");
    expect(lines).toContain("job_id=travis-a04-20261022030400");
  });
});
