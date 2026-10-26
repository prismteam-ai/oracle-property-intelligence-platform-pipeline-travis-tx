// A-04: regenerate only some pIDs' County-group files (`ingest --write-group --pids/--out`).
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { command as ingest } from "../../../travis/backbone/commands/ingest.js";
import { parsePidList } from "../../../travis/tcad/write-group.js";

const JOB = "travis-a04-20261022030400";

describe("parsePidList", () => {
  it("reads a comma / whitespace list, drops duplicates", () => {
    expect(parsePidList("100, 200,200\n300", () => null)).toEqual(["100", "200", "300"]);
  });
  it("reads a file of pIDs when the value is a path", () => {
    const f = join(mkdtempSync(join(tmpdir(), "pids-")), "pids.txt");
    writeFileSync(f, "11\n22\n");
    expect(parsePidList(f)).toEqual(["11", "22"]);
  });
  it("rejects anything that is not a pID, and an empty list", () => {
    expect(() => parsePidList("12,abc", () => null)).toThrow(/not a pID/);
    expect(() => parsePidList("  ", () => null)).toThrow(/no pIDs/);
  });
});

describe("ingest --write-group flags", () => {
  const parse = (a: Record<string, unknown>) => ingest.args.safeParse(a);

  it("accepts --pids and --out with --write-group only", () => {
    expect(parse({ writeGroup: true, job: JOB, pids: "1,2", out: "/tmp/x" }).success).toBe(true);
    expect(parse({ track: "appraisal", pids: "1" }).success).toBe(false);
    expect(parse({ writeGroup: true, job: JOB }).success).toBe(true);
  });

  it("sends the parsed pIDs and an absolute out dir to TcadBackbone.writeGroup", async () => {
    const calls: unknown[] = [];
    const lines: string[] = [];
    const ctx = {
      ingress: {
        callLong: async (_s: string, handler: string, payload: unknown) => {
          calls.push([handler, payload]);
          return {
            zips: 2,
            out_of_scope: 0,
            dir: "x",
            geometry: { gis_centroid: 2 },
            mailing_address_fallback: 1,
            missing_pids: ["3"],
          };
        },
      },
      print: (l: string) => lines.push(l),
    };
    const args = ingest.args.parse({ writeGroup: true, job: JOB, pids: "1,2,3", out: "fix" });
    expect((await ingest.run(ctx as never, args)).exitCode).toBe(0);
    expect(calls).toEqual([
      ["writeGroup", { jobId: JOB, pids: ["1", "2", "3"], out: resolve("fix") }],
    ]);
    expect(lines[0]).toContain("mailing_address_fallback=1");
    expect(lines).toContain("county_group: missing_pids=1");
  });

  it("sends neither key when the flags are absent", async () => {
    const calls: unknown[] = [];
    const ctx = {
      ingress: {
        callLong: async (_s: string, _h: string, payload: unknown) => {
          calls.push(payload);
          return { zips: 0, out_of_scope: 0, dir: "x", geometry: {} };
        },
      },
      print: () => undefined,
    };
    await ingest.run(ctx as never, ingest.args.parse({ writeGroup: true, job: JOB }));
    expect(calls).toEqual([{ jobId: JOB }]);
  });
});
