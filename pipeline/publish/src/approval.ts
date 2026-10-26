// The D-8 approval artifact (CR-A-03 OR-1). `build` leaves two files under reports/:
//   sequence-build.json  every phase-1 step: argv, exit code, printed roots, and every output
//                        file's path, size and SHA-256 (sequence.ts);
//   public-files.json    exactly the files that would go public (each group's archive CAR, its
//                        tables.car and every part), each with path, size, SHA-256 and the CID a
//                        gateway serves it under, the group roots, and the SHA-256 of
//                        sequence-build.json. Deterministic bytes: no timestamp.
// The PO approves the SHA-256 of public-files.json. `upload --approved <sha256>` then calls
// verifyApprovedBuild before the first upload step: the listing must hash to the approval, the
// build report must hash to what the listing recorded, every build output and every public file
// on disk must still have its recorded size and SHA-256 (and CID), no unlisted public file may
// exist, and each CAR header must carry its approved root. Any difference throws ApprovalError
// or BuildDriftError naming the file; phase 1 is never re-run and the build report never
// rewritten.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { z } from "zod";
import { cidOfFile, sameDigest } from "./cid.js";
import { carRoots } from "./manifest.js";
import { listTableParts } from "./readback.js";
import {
  digestOutput,
  sequenceReportName,
  sha256File,
  type DataGroup,
  type GroupResult,
  type OutputDigest,
  type SequenceReport,
} from "./sequence.js";

export const BUILD_REPORT = `reports/${sequenceReportName("build")}`;
export const UPLOAD_REPORT = `reports/${sequenceReportName("upload")}`;
export const PUBLIC_FILES = "reports/public-files.json";

/** The approval does not match the build on disk, or there is no build to approve. */
export class ApprovalError extends Error {
  override name = "ApprovalError";
}

/** A build output or public file changed (or appeared) after the approval. Names the file. */
export class BuildDriftError extends Error {
  override name = "BuildDriftError";
}

/** The files of a group that go public: its archive CAR, its tables.car and every part. */
export function publicFiles(group: GroupResult): string[] {
  return [
    group.carPath,
    join(group.tablesDir, "tables.car"),
    ...listTableParts(group.tablesDir).map((p) => p.path),
  ];
}

const Sha256 = z.string().regex(/^[a-f0-9]{64}$/);

export const PublicFile = z.object({
  /** Relative to the run directory. */
  path: z.string().min(1),
  size: z.number().int().nonnegative(),
  sha256: Sha256,
  /** The raw-leaves CIDv1 a gateway serves these bytes under (the carCid of a .car). */
  cid: z.string().min(1),
});
export type PublicFile = z.infer<typeof PublicFile>;

export const PublicFilesListing = z.object({
  version: z.literal(1),
  runId: z.string().min(1),
  county: z.string().min(1),
  cliCommit: z.string().nullable(),
  buildReport: z.object({ path: z.literal(BUILD_REPORT), sha256: Sha256 }),
  groups: z.array(
    z.object({
      group: z.enum(["county", "property_improvement"]),
      carRoot: z.string().min(1),
      blocks: z.number().int().nonnegative(),
      tablesRoot: z.string().min(1),
      files: z.array(PublicFile),
    }),
  ),
  totalFiles: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
});
export type PublicFilesListing = z.infer<typeof PublicFilesListing>;

const sha256Of = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

async function describe(runDir: string, path: string): Promise<PublicFile> {
  return {
    path: relative(runDir, path),
    size: statSync(path).size,
    sha256: await sha256File(path),
    cid: await cidOfFile(path),
  };
}

export interface WrittenPublicFiles {
  path: string;
  /** SHA-256 of the exact bytes written: what `upload --approved` takes. */
  sha256: string;
  listing: PublicFilesListing;
}

/** Writes reports/public-files.json for a finished, successful build of `runId`. */
export async function writePublicFiles(input: {
  runDir: string;
  runId: string;
  report: SequenceReport;
}): Promise<WrittenPublicFiles> {
  const { runDir, report } = input;
  if (!report.ok || report.phase !== "build")
    throw new Error("public-files.json is written only for a successful build");
  const first = report.groups[0];
  if (first === undefined) throw new Error("the build produced no group");
  const buildBytes = readFileSync(join(runDir, BUILD_REPORT));
  const groups: PublicFilesListing["groups"] = [];
  for (const g of report.groups) {
    // The CAR headers must carry the roots the CLI printed: those are what the PO approves.
    await assertCarRoot(runDir, g.carPath, g.carRoot);
    await assertCarRoot(runDir, join(g.tablesDir, "tables.car"), g.tablesRoot);
    const files: PublicFile[] = [];
    for (const path of publicFiles(g)) files.push(await describe(runDir, path));
    groups.push({
      group: g.group,
      carRoot: g.carRoot,
      blocks: g.blocks,
      tablesRoot: g.tablesRoot,
      files,
    });
  }
  const all = groups.flatMap((g) => g.files);
  const listing: PublicFilesListing = {
    version: 1,
    runId: input.runId,
    county: countyOf(first),
    cliCommit: report.pinnedCli?.commit ?? null,
    buildReport: { path: BUILD_REPORT, sha256: sha256Of(buildBytes) },
    groups,
    totalFiles: all.length,
    totalBytes: all.reduce((n, f) => n + f.size, 0),
  };
  const bytes = Buffer.from(`${JSON.stringify(PublicFilesListing.parse(listing), null, 2)}\n`);
  const path = join(runDir, PUBLIC_FILES);
  writeFileSync(path, bytes);
  return { path, sha256: sha256Of(bytes), listing };
}

/** `<county>` of a group's `car/<county>-<group>.car`. */
function countyOf(g: GroupResult): string {
  const name = g.carPath.split(/[\\/]/).at(-1) ?? "";
  return name.slice(0, name.length - `-${g.group}.car`.length);
}

const BuildReportFile = z
  .object({
    ok: z.literal(true),
    phase: z.literal("build"),
    steps: z.array(
      z
        .object({
          group: z.string(),
          step: z.string(),
          exitCode: z.literal(0),
          outputs: z.array(
            z
              .object({
                path: z.string(),
                size: z.number().int(),
                sha256: Sha256,
                files: z
                  .array(z.object({ path: z.string(), size: z.number().int(), sha256: Sha256 }))
                  .optional(),
              })
              .loose(),
          ),
        })
        .loose(),
    ),
    groups: z.array(
      z
        .object({
          group: z.enum(["county", "property_improvement"]),
          groupDir: z.string(),
          carPath: z.string(),
          carRoot: z.string(),
          blocks: z.number().int(),
          hashCsv: z.string(),
          dataGroupCids: z.array(z.string()),
          tablesDir: z.string(),
          tablesRoot: z.string(),
          tablesExportJson: z.string(),
        })
        .loose(),
    ),
  })
  .loose();

export interface ApprovedBuild {
  publicFilesSha256: string;
  listing: PublicFilesListing;
  /** The build's groups (paths, roots), for the upload-only plan. */
  groups: GroupResult[];
  files: number;
  bytes: number;
}

function drift(runDir: string, path: string, what: string): BuildDriftError {
  return new BuildDriftError(`${relative(runDir, path)} ${what} since the approved build`);
}

function compareOutput(runDir: string, recorded: OutputDigest, now: OutputDigest): void {
  if (recorded.files === undefined) {
    if (now.files !== undefined) throw drift(runDir, recorded.path, "became a directory");
    if (now.size !== recorded.size)
      throw drift(runDir, recorded.path, `changed size ${recorded.size} → ${now.size}`);
    if (now.sha256 !== recorded.sha256)
      throw drift(runDir, recorded.path, `changed sha256 ${recorded.sha256} → ${now.sha256}`);
    return;
  }
  const before = new Map(recorded.files.map((f) => [f.path, f]));
  const after = new Map((now.files ?? []).map((f) => [f.path, f]));
  for (const [path, f] of before) {
    const g = after.get(path);
    if (g === undefined) throw drift(runDir, path, "is missing");
    if (g.size !== f.size) throw drift(runDir, path, `changed size ${f.size} → ${g.size}`);
    if (g.sha256 !== f.sha256)
      throw drift(runDir, path, `changed sha256 ${f.sha256} → ${g.sha256}`);
  }
  for (const path of after.keys()) if (!before.has(path)) throw drift(runDir, path, "appeared");
}

/**
 * The approved build of `runDir`, or a named error before anything is uploaded. Reads only local
 * files; makes no network call and runs no CLI step.
 */
export async function verifyApprovedBuild(
  runDir: string,
  approved: string,
): Promise<ApprovedBuild> {
  if (!/^[a-f0-9]{64}$/.test(approved))
    throw new ApprovalError(
      `--approved must be the 64-hex SHA-256 of ${PUBLIC_FILES}; nothing uploaded`,
    );
  const listingPath = join(runDir, PUBLIC_FILES);
  if (!existsSync(listingPath))
    throw new ApprovalError(`no build for this run: ${PUBLIC_FILES} is missing; run build first`);
  const listingBytes = readFileSync(listingPath);
  const actual = sha256Of(listingBytes);
  if (actual !== approved)
    throw new ApprovalError(
      `${PUBLIC_FILES} has sha256 ${actual}, not the approved ${approved}; nothing uploaded`,
    );
  const listing = PublicFilesListing.parse(JSON.parse(listingBytes.toString("utf8")));

  // The build report the listing was made from, byte for byte.
  const buildPath = join(runDir, BUILD_REPORT);
  if (!existsSync(buildPath))
    throw new BuildDriftError(`${BUILD_REPORT} is missing since the approved build`);
  const buildSha = sha256Of(readFileSync(buildPath));
  if (buildSha !== listing.buildReport.sha256)
    throw new BuildDriftError(
      `${BUILD_REPORT} changed since the approved build: sha256 ${buildSha}, approved listing records ${listing.buildReport.sha256}`,
    );
  const build = BuildReportFile.parse(JSON.parse(readFileSync(buildPath, "utf8")));
  const groups = build.groups as GroupResult[];

  // Every phase-1 output, as recorded.
  for (const step of build.steps) {
    for (const out of step.outputs as OutputDigest[]) {
      if (!existsSync(out.path)) throw drift(runDir, out.path, "is missing");
      compareOutput(runDir, out, await digestOutput(out.path));
    }
  }

  // Exactly the listed public files, each unchanged, and the approved roots.
  let files = 0;
  let bytes = 0;
  for (const listed of listing.groups) {
    const g = groups.find((x) => x.group === listed.group);
    if (g === undefined)
      throw new BuildDriftError(`${BUILD_REPORT} has no ${listed.group} group since the approval`);
    if (g.carRoot !== listed.carRoot || g.tablesRoot !== listed.tablesRoot)
      throw new BuildDriftError(
        `${listed.group} roots differ between ${BUILD_REPORT} and ${PUBLIC_FILES}`,
      );
    const onDisk = publicFiles(g).map((p) => relative(runDir, p));
    const approvedPaths = new Set(listed.files.map((f) => f.path));
    for (const p of onDisk)
      if (!approvedPaths.has(p))
        throw new BuildDriftError(`${p} is not in the approved ${PUBLIC_FILES}; nothing uploaded`);
    for (const f of listed.files) {
      const path = join(runDir, f.path);
      if (!existsSync(path)) throw drift(runDir, path, "is missing");
      const now = await describe(runDir, path);
      if (now.size !== f.size) throw drift(runDir, path, `changed size ${f.size} → ${now.size}`);
      if (now.sha256 !== f.sha256)
        throw drift(runDir, path, `changed sha256 ${f.sha256} → ${now.sha256}`);
      if (now.cid !== f.cid) throw drift(runDir, path, `changed CID ${f.cid} → ${now.cid}`);
      files += 1;
      bytes += f.size;
    }
    await assertCarRoot(runDir, g.carPath, listed.carRoot);
    await assertCarRoot(runDir, join(g.tablesDir, "tables.car"), listed.tablesRoot);
  }
  if (files !== listing.totalFiles || bytes !== listing.totalBytes)
    throw new BuildDriftError(`${PUBLIC_FILES} totals do not add up; nothing uploaded`);
  return { publicFilesSha256: approved, listing, groups, files, bytes };
}

async function assertCarRoot(runDir: string, path: string, root: string): Promise<void> {
  let roots: string[];
  try {
    roots = (await carRoots(path)).map((c) => c.toString());
  } catch (error) {
    throw drift(runDir, path, `is not a readable CAR (${(error as Error).message})`);
  }
  if (roots.length !== 1 || !sameDigest(roots[0] as string, root))
    throw drift(
      runDir,
      path,
      `carries root ${roots.join(", ") || "none"}, not the approved ${root}`,
    );
}

/**
 * The groups of the successful build recorded in reports/sequence-build.json (no approval
 * check): what `build` hands to its last step, the draft-manifest bind (CR-A-03 F-1).
 */
export function builtGroups(runDir: string): GroupResult[] {
  const buildPath = join(runDir, BUILD_REPORT);
  if (!existsSync(buildPath)) throw new Error(`${BUILD_REPORT} is missing; run build first`);
  const build = BuildReportFile.parse(JSON.parse(readFileSync(buildPath, "utf8")));
  return build.groups as GroupResult[];
}

/** Helper for callers that need the group list in plan order. */
export function approvedGroups(build: ApprovedBuild, groups: readonly DataGroup[]): GroupResult[] {
  return groups.map((name) => {
    const g = build.groups.find((x) => x.group === name);
    if (g === undefined) throw new BuildDriftError(`the approved build has no ${name} group`);
    return g;
  });
}
