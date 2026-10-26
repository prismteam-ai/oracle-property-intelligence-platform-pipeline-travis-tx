// A-04 T027: `backbone pilot` (contracts/cli.md).
//   --select [--anchors <file>]  writes pipeline/data/seeds/travis-a04-pilot.csv with
//                                pilot-select.ts (one local pass over the export on disk; the
//                                anchor file lists Austin roofing-permit tcad_ids in permit order, T062)
//   [--seed <csv>]               runs TcadBackbone for the seed's pIDs through the Restate
//                                ingress, which also writes their County group (R only), then
//                                prints the elephant-cli validate command to run
// Exit: complete 0 · failed 1 · blocked 2 · waiting_human 3. Prints counts and paths only.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import type { BackboneCommand } from "../cli.js";
import { DEFAULT_REPO_ROOT } from "../../discovery/blocked-evidence.js";
import { readSeed } from "../../pilot/build-seed.js";
import { streamExportRecords } from "../../tcad/export-stream.js";
import { ANCHOR_CANDIDATES_PATH, PILOT_SEED_PATH, exportSource } from "../../tcad/export-source.js";
import { selectPilot, writePilotSeed } from "../../tcad/pilot-select.js";
import { waitForRun } from "./ingest.js";

const Args = z
  .object({
    select: z.literal(true).optional(),
    seed: z.string().min(1).optional(),
    anchors: z.string().min(1).optional(),
    pollMs: z.number().int().nonnegative().optional(),
  })
  .strict()
  .refine((a) => !(a.select === true && a.seed !== undefined), {
    message: "--select writes the seed; do not give --seed",
  })
  .refine((a) => a.select === true || a.anchors === undefined, {
    message: "--anchors goes with --select",
  });
export type PilotArgs = z.infer<typeof Args>;

export const ELEPHANT_CLI = "~/.local/share/elephant-cli-main/node_modules/.bin/elephant-cli";

export const command: BackboneCommand<PilotArgs> = {
  verb: "pilot",
  args: Args,
  startsRun: (a) => a.select !== true,
  async run(ctx, args) {
    if (args.select === true) {
      const jobId = ctx.jobIdFor("pilot-select");
      const anchors = readFileSync(
        resolve(DEFAULT_REPO_ROOT, args.anchors ?? ANCHOR_CANDIDATES_PATH),
        "utf8",
      )
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => /^\d+$/.test(l));
      const src = exportSource();
      const out = await selectPilot(streamExportRecords(src.exportPath), {
        anchorCandidates: anchors,
        asOf: ctx.asOf(),
      });
      writePilotSeed(resolve(DEFAULT_REPO_ROOT, PILOT_SEED_PATH), out.rows);
      const reasons = out.rows.reduce<Record<string, number>>(
        (m, r) => ({ ...m, [r.reason]: (m[r.reason] ?? 0) + 1 }),
        {},
      );
      ctx.print(
        `pilot_select: rows=${out.rows.length} seed=${PILOT_SEED_PATH} reasons=${JSON.stringify(reasons)}`,
      );
      if (out.anchor2) ctx.print(`ANCHOR2 geoID=${out.anchor2.geo_id} pID=${out.anchor2.pID}`);
      return { jobId, exitCode: 0 };
    }
    const seedPath = args.seed ?? PILOT_SEED_PATH;
    const seedPids = readSeed(resolve(DEFAULT_REPO_ROOT, seedPath)).map((r) => r.parcel_id);
    const jobId = ctx.jobIdFor("pilot");
    await ctx.ingress.send("TcadBackbone", jobId, "run", {
      jobId,
      mode: "pilot",
      asOf: ctx.asOf(),
      seedPids,
    });
    const exitCode = await waitForRun(ctx, jobId, args.pollMs);
    ctx.print(
      `pilot: seed_rows=${seedPids.length} group=pipeline/data/runs/${jobId}/groups/county`,
    );
    ctx.print(`validate: ${ELEPHANT_CLI} validate pipeline/data/runs/${jobId}/groups/county`);
    return { jobId, exitCode };
  },
};
