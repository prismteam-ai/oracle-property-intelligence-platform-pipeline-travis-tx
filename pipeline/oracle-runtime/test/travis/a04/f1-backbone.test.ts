// A-04 F1 fixes (CR-1, CR-3, CR-4, CR-9, OR-M4, OR-M5, OR-m1, OR-m2, OR-m6, OR-m9). Synthetic
// test input only.
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { a04Record } from "../../fixtures/a04/tcad/export.js";
import { sha256Text, type ExportRecordText } from "../../../travis/tcad/export-stream.js";
import {
  loaderInput,
  runTcadBackbone,
  type BackboneDeps,
  type BackboneInput,
  type ChunkOutcome,
  type TrackOp,
} from "../../../travis/tcad/workflow.js";
import { RunDataError } from "../../../travis/backbone/errors.js";
import { jobIdFor } from "../../../travis/backbone/run-context.js";
import {
  cleanupChunk,
  prepareChunk,
  writeChunkInput,
  type ChunkSpec,
} from "../../../travis/tcad/chunk.js";
import { processRecord } from "../../../travis/tcad/process.js";
import { createKeyInventory } from "../../../travis/tcad/key-inventory.js";
import { mapParcel } from "../../../travis/tcad/fields.js";
import { redactRecord } from "../../../travis/tcad/redact.js";
import {
  FALLBACK_WITHOUT_IMPROVEMENT,
  PROPERTY_TYPE_RULES_VERSION,
  STATE_CODES,
} from "../../../travis/transforms/shared-seed.js";

const GIB = 1024 ** 3;
const text = (r: Record<string, unknown>, ordinal: number): ExportRecordText => {
  const t = JSON.stringify(r, null, 1);
  return { ordinal, text: t, sha256: sha256Text(t), bytes: Buffer.byteLength(t) };
};

function fakeOutcome(spec: ChunkSpec, extra: Partial<ChunkOutcome> = {}): ChunkOutcome {
  return {
    n: spec.n,
    summary: {
      records: spec.records,
      loaded: spec.records,
      dead: 0,
      invalid: 0,
      transform_failure: 0,
      redacted: 0,
      by_prop_type: { R: spec.records },
    },
    dead: [],
    inventory: { pID: spec.records },
    mappedSha256: "a".repeat(64),
    zips: 0,
    coverage: null,
    typeStats: { fallback: 0, fallbackByState: {}, a4: 0, f4: 0 },
    ...extra,
  };
}

function harness(
  n: number,
  over: Partial<BackboneDeps> = {},
  inputOver: Partial<BackboneInput> = {},
) {
  const dir = mkdtempSync(join(tmpdir(), "a04-f1-"));
  const recs = Array.from({ length: n }, (_, i) =>
    text(a04Record({ pID: 8000 + i, geoID: `08000000${i}` }), i),
  );
  const ops: Array<{ op: TrackOp; seq: number }> = [];
  const ran: number[] = [];
  const input: BackboneInput = {
    jobId: "travis-a04-20261022040000",
    mode: "full",
    asOf: "2026-10-22",
    exportPath: join(dir, "x.zip"),
    receipt: {
      url: "https://traviscad.org/x.zip",
      sha256: "c".repeat(64),
      captured_at: "2026-10-19T21:33:41.241Z",
    },
    runDir: join(dir, "run"),
    chunkSize: 1,
    window: 2,
    ...inputOver,
  };
  const deps: BackboneDeps = {
    step: async (_n, fn) => fn(),
    merge: async (op, seq) => {
      ops.push({ op, seq });
      return { rowsWritten: 0 };
    },
    verify: async () => ({ sha256: "c".repeat(64) }),
    waitForHuman: async () => {
      throw new Error("no wait");
    },
    download: async () => {
      throw new Error("no download");
    },
    runChunk: async (spec) => {
      ran.push(spec.n);
      return fakeOutcome(spec);
    },
    listInputs: () => [],
    records: () =>
      (async function* () {
        for (const r of recs) yield r;
      })(),
    now: () => new Date("2026-10-22T04:00:00Z"),
    freeBytes: () => 100 * GIB,
    ...over,
  };
  return { input, deps, ops, ran, dir };
}

describe("CR-1 status ops carry a monotonically increasing sequence", () => {
  it("every non-chunk merge gets a distinct, increasing seq", async () => {
    const h = harness(2);
    await runTcadBackbone(h.input, h.deps);
    const seqs = h.ops.map((o) => o.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(h.ops.map((o) => o.op.kind)).toEqual(["run", "limitations", "finalize", "run"]);
  });

  it("the Loader input of the same status op differs by seq and by run nonce, and is stable for the same", () => {
    const op: TrackOp = { kind: "run", track: "appraisal", mode: "full", status: "running" };
    const a = loaderInput("travis-a04-x", op, { seq: 0, nonce: "n1" });
    expect(loaderInput("travis-a04-x", op, { seq: 0, nonce: "n1" }).artifactSha256).toBe(
      a.artifactSha256,
    );
    expect(loaderInput("travis-a04-x", op, { seq: 1, nonce: "n1" }).artifactSha256).not.toBe(
      a.artifactSha256,
    );
    expect(loaderInput("travis-a04-x", op, { seq: 0, nonce: "n2" }).artifactSha256).not.toBe(
      a.artifactSha256,
    );
  });

  it("after a human resolution and a good download the status goes back to running", async () => {
    let verifies = 0;
    const h = harness(1, {
      verify: async () => {
        verifies += 1;
        if (verifies === 1) {
          const { ExportVerifyError } = await import("../../../travis/tcad/export-verify.js");
          throw new ExportVerifyError("export_missing", "missing");
        }
        return { sha256: "c".repeat(64) };
      },
      waitForHuman: async () => ({ action: "download" }),
      download: async () =>
        ({
          receipt: {
            url: "u",
            status: 200,
            bytes: 1,
            sha256: "d".repeat(64),
            captured_at: "2026-10-22T00:00:00Z",
            outcome: "ok",
            attempts: 1,
            user_agent: "ua",
          },
        }) as never,
    });
    await runTcadBackbone(h.input, h.deps);
    const statuses = h.ops
      .filter((o) => o.op.kind === "run")
      .map((o) => (o.op as { status: string }).status);
    expect(statuses).toEqual(["running", "waiting_human", "running", "complete"]);
  });
});

describe("CR-3 data errors are RunDataError (terminal in the binding)", () => {
  it("seed pIDs absent from the export", async () => {
    const h = harness(1, {}, { mode: "pilot", seedPids: ["8000", "99999"] });
    await expect(runTcadBackbone(h.input, h.deps)).rejects.toBeInstanceOf(RunDataError);
  });
});

describe("CR-4 a failing in-flight chunk never raises unhandledRejection", () => {
  it("rejects once, cleanly, while the stream loop is still awaiting", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown): void => void unhandled.push(e);
    process.on("unhandledRejection", onUnhandled);
    try {
      const h = harness(
        6,
        {
          runChunk: async (spec) => {
            if (spec.n === 0) {
              await new Promise((r) => setTimeout(r, 1));
              throw new Error("chunk 0 failed");
            }
            await new Promise((r) => setTimeout(r, 30));
            return fakeOutcome(spec);
          },
          records: () =>
            (async function* () {
              for (let i = 0; i < 6; i += 1) {
                await new Promise((r) => setTimeout(r, 10));
                yield text(a04Record({ pID: 8100 + i, geoID: `08100000${i}` }), i);
              }
            })(),
        },
        { window: 4 },
      );
      await expect(runTcadBackbone(h.input, h.deps)).rejects.toThrow("chunk 0 failed");
      await new Promise((r) => setTimeout(r, 120));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});

describe("OR-M5 disk guard before each chunk and each merge", () => {
  it("below 5 GiB stops before the chunk is prepared and says so", async () => {
    const h = harness(3, { freeBytes: () => 4 * GIB });
    const err = await runTcadBackbone(h.input, h.deps).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RunDataError);
    expect((err as Error).message).toBe("disk below 5 GiB");
    expect(h.ran).toEqual([]);
  });

  it("space that runs out mid-run stops the next chunk", async () => {
    let free = 100 * GIB;
    const h = harness(4, {
      freeBytes: () => free,
      runChunk: async (spec) => {
        free = 1 * GIB;
        return fakeOutcome(spec);
      },
    });
    await expect(runTcadBackbone(h.input, h.deps)).rejects.toThrow("disk below 5 GiB");
    expect(h.ran.length).toBeLessThan(4);
  });
});

describe("OR-m6 / OR-M4 limitations at the end of the run", () => {
  it("writes the fallback, unverified state code and tenure limitations from the chunk stats", async () => {
    const h = harness(2, {
      runChunk: async (spec) =>
        fakeOutcome(spec, {
          typeStats: { fallback: 5, fallbackByState: { E1: 3, F4: 2 }, a4: 4, f4: 2 },
        }),
    });
    await runTcadBackbone(h.input, h.deps);
    const lim = h.ops.find((o) => o.op.kind === "limitations")?.op as Extract<
      TrackOp,
      { kind: "limitations" }
    >;
    const byCode = Object.fromEntries(lim.items.map((i) => [i.code, i]));
    expect(byCode.property_type_improvement_fallback).toMatchObject({ count: 10 });
    expect(byCode.property_type_improvement_fallback?.text).toMatch(/E1 \(6\)/);
    expect(byCode.property_type_improvement_fallback?.text).toMatch(/F4 \(4\)/);
    expect(byCode.property_type_unverified_state_codes).toMatchObject({ count: 12 });
    expect(byCode.property_type_unverified_state_codes?.text).toMatch(
      /A4.*Townhouse.*deprecated.*DEC-A-01/s,
    );
    expect(byCode.property_type_unverified_state_codes?.text).toMatch(/F4/);
    expect(byCode.tenure_latest_sale_assumption?.text).toMatch(/latest dated sale/);
    expect(byCode.roll_difference_unexplained).toBeUndefined();
  });

  it("transform failures make the run not clean: status stays complete, a limitation and clean=false say so", async () => {
    const h = harness(2, {
      runChunk: async (spec) =>
        fakeOutcome(spec, {
          summary: {
            records: 1,
            loaded: 0,
            dead: 0,
            invalid: 0,
            transform_failure: 1,
            redacted: 0,
            by_prop_type: {},
          },
        }),
    });
    const out = await runTcadBackbone(h.input, h.deps);
    expect(out.status).toBe("complete");
    expect(out.clean).toBe(false);
    const lim = h.ops.find((o) => o.op.kind === "limitations")?.op as Extract<
      TrackOp,
      { kind: "limitations" }
    >;
    expect(lim.items.find((i) => i.code === "roll_difference_unexplained")?.count).toBe(2);
  });

  it("a clean run reports clean=true", async () => {
    const out = await runTcadBackbone(harness(2).input, harness(2).deps);
    expect(out.clean).toBe(true);
  });
});

describe("OR-M4 property_type fallback and rule-set version", () => {
  const ctx = {
    jobId: "travis-a04-20261022040000",
    asOf: "2026-10-22",
    exportSha256: "e".repeat(64),
    capturedAt: "2026-10-19T00:00:00Z",
  };
  it("no improvement → LandParcel (not the deprecated VacantLand); with improvement → Building", () => {
    expect(FALLBACK_WITHOUT_IMPROVEMENT).toBe("LandParcel");
    const m = mapParcel(redactRecord(a04Record({ pID: 1, geoID: "01", stateCd: "E1" })), {
      ...ctx,
      ordinal: 0,
      recordSha256: "a".repeat(64),
    });
    expect(m.parcel).toMatchObject({
      property_type: "LandParcel",
      property_type_rule: "improvement_fallback",
    });
    expect(m.parcel.property_type_rules_version).toBe(PROPERTY_TYPE_RULES_VERSION);
    expect(PROPERTY_TYPE_RULES_VERSION).toMatch(/^property_type_rules@\d{4}-\d{2}-\d{2}$/);
    const t = mapParcel(redactRecord(a04Record({ pID: 2, geoID: "02", stateCd: "A1" })), {
      ...ctx,
      ordinal: 1,
      recordSha256: "a".repeat(64),
    });
    expect(t.parcel.property_type_rules_version).toBe(PROPERTY_TYPE_RULES_VERSION);
    expect(STATE_CODES.C1?.property_type).toBe("VacantLand"); // the table entry is unchanged
  });
});

describe("OR-m1 dead / transform_failure detail holds no raw snippet", () => {
  it("a non-JSON record records class, position and length only", () => {
    const secret = '{"owner": "SECRETNAME", ,}';
    const out = processRecord(
      { ordinal: 3, text: secret, sha256: sha256Text(secret), bytes: secret.length },
      { jobId: "travis-a04-x", asOf: "2026-10-22", exportSha256: "e".repeat(64), capturedAt: "x" },
      createKeyInventory(),
    );
    expect(out.recon.class).toBe("dead");
    expect(out.recon.detail).toMatch(/SyntaxError/);
    expect(out.recon.detail).toContain(`length ${secret.length}`);
    expect(out.recon.detail).not.toContain("SECRETNAME");
    expect(JSON.stringify(out.dead)).not.toContain("SECRETNAME");
  });
});

describe("OR-m2 / CR-9 chunk files", () => {
  const mk = () => {
    const dir = mkdtempSync(join(tmpdir(), "a04-chunk-"));
    const records = [
      text(a04Record({ pID: 8200, geoID: "082000000" }), 0),
      text(a04Record({ pID: 8201, geoID: "082000001" }), 1),
    ];
    const inputPath = join(dir, "chunks", "c0.input.ndjson.gz");
    const spec: ChunkSpec = {
      jobId: "travis-a04-20261022040000",
      n: 0,
      inputPath,
      inputSha256: writeChunkInput(inputPath, records),
      records: 2,
      mappedPath: join(dir, "chunks", "c0.ndjson.gz"),
      ctx: {
        jobId: "travis-a04-20261022040000",
        asOf: "2026-10-22",
        exportSha256: "e".repeat(64),
        capturedAt: "x",
      },
    };
    return { dir, spec };
  };

  it("prepare after cleanup returns the recorded outcome instead of re-reading the deleted input", async () => {
    const { dir, spec } = mk();
    const first = await prepareChunk(spec);
    cleanupChunk(spec);
    expect(existsSync(spec.inputPath)).toBe(false);
    const again = await prepareChunk(spec);
    expect(again).toEqual(first);
    rmSync(dir, { recursive: true, force: true });
  });

  it("a missing input with no recorded outcome is a RunDataError, not a retryable ENOENT", async () => {
    const { dir, spec } = mk();
    rmSync(spec.inputPath);
    await expect(prepareChunk(spec)).rejects.toBeInstanceOf(RunDataError);
    rmSync(dir, { recursive: true, force: true });
  });

  it("a failing prepare removes the unredacted input in the same call", async () => {
    const { dir, spec } = mk();
    const bad = { ...spec, ctx: { ...spec.ctx, asOf: "not-a-date" } };
    // force a failure after the input was read: an unknown key in a record fails the run
    const poisoned = a04Record({ pID: 8300, geoID: "083000000" });
    (poisoned as Record<string, unknown>).someNewUnknownKey = 1;
    const t = text(poisoned, 0);
    const p = join(dir, "chunks", "c9.input.ndjson.gz");
    const failing: ChunkSpec = {
      ...bad,
      n: 9,
      inputPath: p,
      inputSha256: writeChunkInput(p, [t]),
      mappedPath: join(dir, "chunks", "c9.ndjson.gz"),
    };
    await expect(prepareChunk(failing)).rejects.toBeDefined();
    expect(existsSync(p)).toBe(false);
    expect(readdirSync(join(dir, "chunks")).filter((f) => f.startsWith("c9"))).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("OR-m9 / CR-10 job ids have seconds resolution", () => {
  it("two ids a few seconds apart differ and keep the allowed shape", () => {
    const a = jobIdFor("pilot", new Date("2026-10-22T04:00:01Z"));
    const b = jobIdFor("pilot", new Date("2026-10-22T04:00:07Z"));
    expect(a).not.toBe(b);
    expect(a).toMatch(/^travis-a04-[a-z0-9-]+$/);
    expect(a).toBe("travis-a04-pilot-20261022040001");
  });
});

describe("permits --fresh (F2 OR-m5 request)", () => {
  const run = async (args: Record<string, unknown>) => {
    const { command } = await import("../../../travis/backbone/commands/permits.js");
    const sent: unknown[] = [];
    const ctx = {
      jobIdFor: (k: string) => `travis-a04-${k}-20261022030400`,
      ingress: {
        send: async (_s: string, _k: string, _h: string, body: unknown) => void sent.push(body),
        get: async () => ({ status: "complete", exitCode: 0 }),
      },
      print: () => undefined,
    };
    const parsed = command.args.safeParse(args);
    if (!parsed.success) return { parsed, sent };
    await command.run(ctx as never, parsed.data as never);
    return { parsed, sent };
  };
  it("passes fresh: true on a backfill and nothing otherwise", async () => {
    expect((await run({ mode: "backfill", fresh: true })).sent[0]).toMatchObject({
      mode: "backfill",
      fresh: true,
    });
    expect((await run({ mode: "backfill" })).sent[0]).not.toHaveProperty("fresh");
  });
  it("rejects --fresh with another mode or --link", async () => {
    expect((await run({ mode: "incremental", fresh: true })).parsed.success).toBe(false);
    expect((await run({ link: true, fresh: true })).parsed.success).toBe(false);
  });
});

describe("CR-2 / OR-m6 the CLI polls to a terminal exit code", () => {
  const exitFor = async (status: Record<string, unknown>) => {
    const { waitForRun } = await import("../../../travis/backbone/commands/ingest.js");
    const printed: string[] = [];
    const ctx = {
      ingress: { call: async () => status },
      print: (l: string) => void printed.push(l),
    };
    return { code: await waitForRun(ctx as never, "travis-a04-x", 0), printed };
  };
  it("failed → 1, complete → 0", async () => {
    expect((await exitFor({ status: "failed", reason: "disk below 5 GiB" })).code).toBe(1);
    expect((await exitFor({ status: "complete", clean: true })).code).toBe(0);
  });
  it("complete with an unclean roll → 1 and says why", async () => {
    const r = await exitFor({ status: "complete", clean: false });
    expect(r.code).toBe(1);
    expect(r.printed.join("\n")).toMatch(/roll_difference_unexplained/);
  });
});

describe("DP-6 every owner_missing_reason is on contract/v1's frozen reason list", () => {
  it("owner_unparsed, no_owner_record, no_dated_sale, owner_confidential are all frozen", async () => {
    const { readFileSync } = await import("node:fs");
    const readme = readFileSync(
      new URL("../../../../../contract/v1/README.md", import.meta.url),
      "utf8",
    );
    const list =
      readme.split("\n").find((l) => l.startsWith("cannot carry. Reasons are a closed list:")) ??
      "";
    for (const reason of [
      "owner_unparsed",
      "no_owner_record",
      "no_dated_sale",
      "owner_confidential",
    ]) {
      expect(list).toContain(`\`${reason}\``);
    }
  });
});
