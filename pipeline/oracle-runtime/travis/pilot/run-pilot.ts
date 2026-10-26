// T050: the local A-02 pilot run (PO decisions D-2, D-3; oracle § A.1). In order:
//   1 lexicon manifest (data-group schema CIDs, live)
//   2 Austin captures (the D-3 slice, one GET per permit, ≤ 1 request/s)
//   3 TCAD subset (streamed geoID match in the certified JSON export)
//   4 seed (county-seed-data contract)
//   5 classification ledger (profiles/travis-austin@1.0.0)
//   6 roof-age ledger (vendored kit estimator + Travis roof-age profile)
//   7 County and Property Improvement transforms
//   8 runSequence(): validate → hash → validate CAR → export-tables, county then PI
//   9 buildManifest() → manifest JCS bytes and CID
// Everything is written under pipeline/data/pilot/<runId>/ (gitignored) except the
// manifest bytes, which are also copied to contract/v1/pilot-manifest.json. Nothing is
// uploaded; there is no --atlas-page; ELEPHANT_IPFS_GATEWAYS is removed from the CLI env.
//
// `--reuse-captures` reuses completed Austin and TCAD captures of the same run (so a
// transform fix never re-requests the sources). The run's finishedAt is the end of the
// capture phase: it is the data's as-of instant, the roof-age `as_of` and the manifest
// `finishedAt`.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as travisAustin from "../../../../profiles/travis-austin@1.0.0/index.js";
import {
  buildManifest,
  runSequence,
  resolveCli,
  type SequenceReport,
} from "../../../publish/src/index.js";
import { PILOT_LIMITATION } from "../../../../packages/contract/src/manifest.js";

const GAZETTEER_PATH = "packages/query-core/gazetteer/travis-places@1.0.0";
import { createLogger } from "../lib/log.js";
import {
  estimateTravisRoofAge,
  type RoofAgeLedgerRow,
  TRAVIS_ROOF_AGE_PROFILE_VERSION,
} from "../roof-age/travis-roof-age-profile.js";
import { fetchDataGroupCids, type DataGroupCids } from "../transforms/lexicon-manifest.js";
import {
  TCAD_EXPORT_REQUEST,
  parseTcadRecord,
  propertyFields,
  type SeedRow,
} from "../transforms/shared-seed.js";
import { transformTcadCounty, type CountyTransformCounts } from "../transforms/tcad-county.js";
import {
  AUSTIN_DATASET_URL,
  classifyCapture,
  transformAustinPropertyImprovement,
  type AustinPermitCapture,
  type AustinRow,
  type ClassificationLedgerRow,
} from "../transforms/austin-property-improvement.js";
import { buildSeedRow, writeSeed } from "./build-seed.js";
import { captureAustin, type PermitReceipt } from "./capture-austin.js";
import {
  readSubset,
  scanTcadSubset,
  writeSubset,
  type TcadSubsetReceipt,
} from "./capture-tcad-subset.js";
import { profileApi, type TravisAustinProfileModule } from "./profile-api.js";

export const PILOT_RUN_ID = "travis-pilot-20261020";
export const COUNTY = { slug: "travis", state: "TX", fips: "48453" } as const;

/** The code paths that produce a run (git status is checked on these, not on docs). */
export const BUILD_PATHS = [
  "pipeline/oracle-runtime/travis",
  "pipeline/oracle-runtime/kit",
  "pipeline/publish",
  "packages",
  "profiles",
] as const;

export const DIRTY_TREE_LIMITATION =
  "built from a dirty working tree: the code under profiles[].gitCommit had uncommitted changes";

/** A limitations[] line when `git status --porcelain -- <BUILD_PATHS>` lists any change. */
export const dirtyTreeLimitations = (porcelain: string): string[] =>
  porcelain.trim() === "" ? [] : [DIRTY_TREE_LIMITATION];

type Coverage = Record<
  string,
  {
    count: number;
    derivation: "aggregate_match" | "capture_receipt" | "published_rows";
    note?: string;
  }
>;

/** AD-24: the five contractor identity states over the published permits. A-02 resolves no
 *  contractor (no official license or registry match is attempted), so all are unresolved. */
export function contractorCoverage(publishedPermits: number): Coverage {
  return {
    contractor_resolved: { count: 0, derivation: "aggregate_match" },
    contractor_candidate: { count: 0, derivation: "aggregate_match" },
    contractor_ambiguous: { count: 0, derivation: "aggregate_match" },
    contractor_conflicting: { count: 0, derivation: "aggregate_match" },
    contractor_unresolved: {
      count: publishedPermits,
      derivation: "aggregate_match",
      note: "no official license or registry evidence is matched in A-02; no contractor edge is written",
    },
  };
}

/** Owner gaps per published property, from the transform's outcome on each TCAD record. */
export function ownerCoverage(outcomes: Record<string, number>): Coverage {
  const n = (k: string): number => outcomes[k] ?? 0;
  return {
    owner_no_dated_sale: {
      count: n("no_dated_sale"),
      derivation: "capture_receipt",
      note: "owners[] present but no dated sale to link them to (linking without a sale: A-04)",
    },
    owner_unparsed: {
      count: n("unparsed"),
      derivation: "capture_receipt",
      note: "a dated sale, but no owner name splits into a person or reads as a company",
    },
    owner_confidential: {
      count: n("suppressed"),
      derivation: "capture_receipt",
      note: "owner name and mailing withheld: owners[]/sales[] confidentialCode, sales[] confidentialSale, or an unmodeled confid* key (P0-15), or individuals left out by OWNER_PERSONS=omit",
    },
    owner_no_record: {
      count: n("none"),
      derivation: "capture_receipt",
      note: "the TCAD record has no owners[]",
    },
  };
}

export interface RunPilotOptions {
  repoRoot: string;
  runId?: string;
  reuseCaptures?: boolean;
  tcadZip?: string;
  log?: (event: string, fields: Record<string, unknown>) => void;
}

export interface RunPilotResult {
  ok: boolean;
  stage: string;
  reason?: string;
  sequence?: SequenceReport;
  manifestCid?: string;
  manifestBytes?: number;
}

const json = (v: unknown): string => `${JSON.stringify(v, null, 2)}\n`;
const jsonl = (rows: unknown[]): string =>
  rows.length === 0 ? "" : `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`;
const sha256 = (b: Buffer | string): string => createHash("sha256").update(b).digest("hex");

function catalogZipSha256(repoRoot: string): string {
  const text = readFileSync(join(repoRoot, "pipeline/docs/travis-sources.yaml"), "utf8");
  const m = /export_sha256:\s*"([0-9a-f]{64})"/.exec(text);
  if (!m) throw new Error("travis-sources.yaml has no TCAD export_sha256");
  return m[1] as string;
}

interface RunState {
  runId: string;
  startedAt: string;
  finishedAt: string | null;
}

function loadPermits(dir: string): { captures: AustinPermitCapture[]; receipts: PermitReceipt[] } {
  const receipts = readFileSync(join(dir, "receipts.jsonl"), "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as PermitReceipt);
  const captures = receipts.map((r) => {
    if (!r.file) throw new Error(`permit ${r.permit_number} has no body file`);
    const body = readFileSync(join(dir, r.file));
    if (sha256(body) !== r.sha256) throw new Error(`permit ${r.permit_number} body changed`);
    const rows = JSON.parse(body.toString("utf8")) as AustinRow[];
    const row = rows[0];
    if (rows.length !== 1 || !row || row.permit_number !== r.permit_number)
      throw new Error(`permit ${r.permit_number} body is not the one permit`);
    return {
      row,
      receipt: {
        url: r.url,
        method: r.method,
        multiValueQueryString: r.multiValueQueryString,
        status: r.status,
        sha256: r.sha256,
        captured_at: r.captured_at,
      },
    };
  });
  return { captures, receipts };
}

export async function runPilot(options: RunPilotOptions): Promise<RunPilotResult> {
  const repoRoot = options.repoRoot;
  const runId = options.runId ?? PILOT_RUN_ID;
  const P = join(repoRoot, "pipeline/data/pilot", runId);
  const log = options.log ?? ((event, fields) => createLogger().info(event, fields as never));
  mkdirSync(P, { recursive: true });
  const statePath = join(P, "run-state.json");
  const reuse = options.reuseCaptures === true && existsSync(statePath);
  const state: RunState = reuse
    ? (JSON.parse(readFileSync(statePath, "utf8")) as RunState)
    : { runId, startedAt: new Date().toISOString(), finishedAt: null };
  writeFileSync(statePath, json(state));
  const cli = resolveCli(repoRoot);
  log("pilot.start", { runId, reuse, cli_commit: cli.commit });

  // 1 lexicon manifest
  const lexicon = await fetchDataGroupCids();
  const cids: DataGroupCids = lexicon.cids;
  mkdirSync(join(P, "capture/lexicon"), { recursive: true });
  writeFileSync(join(P, "capture/lexicon/receipt.json"), json({ ...lexicon.receipt, cids }));
  log("pilot.lexicon", { ...cids });

  // 2 Austin captures
  const austinDir = join(P, "capture/austin");
  const sliceJson = join(austinDir, "slice.json");
  const sliceDone =
    reuse &&
    existsSync(sliceJson) &&
    (JSON.parse(readFileSync(sliceJson, "utf8")) as { status: string }).status === "ok";
  if (!sliceDone) {
    const capture = await captureAustin({
      include: travisAustin.toSoqlInclude(),
      outDir: austinDir,
      log: (e, f) => log(e, f),
    });
    log("pilot.austin", {
      status: capture.status,
      reason: capture.reason ?? null,
      permits: capture.permits.length,
    });
    if (capture.status !== "ok")
      return { ok: false, stage: "austin", reason: capture.reason ?? capture.status };
  }
  const slice = JSON.parse(readFileSync(sliceJson, "utf8")) as {
    permits: Record<string, string[]>;
    slices: Array<{ slice: string; max_updated_at: string | null; captured_at: string }>;
  };
  const { captures } = loadPermits(austinDir);
  const sliceOf = new Map<string, string>();
  for (const [name, list] of Object.entries(slice.permits))
    for (const n of list) sliceOf.set(n, name);

  // 3 TCAD subset
  const tcadDir = join(P, "capture/tcad");
  const wanted = captures.map((c) => c.row.tcad_id ?? null);
  const wantedKey = [...new Set(wanted.map((w) => w ?? "(null)"))].sort().join(",");
  const keyPath = join(tcadDir, "wanted.txt");
  const tcadDone =
    reuse &&
    existsSync(join(tcadDir, "receipt.json")) &&
    existsSync(keyPath) &&
    readFileSync(keyPath, "utf8") === wantedKey;
  if (!tcadDone) {
    const zipPath =
      options.tcadZip ??
      join(repoRoot, "pipeline/data/raw/tcad/2026_20Certified_20JSON_20SUPP_200_2007182026.zip");
    log("pilot.tcad.scan", { wanted: new Set(wanted).size });
    const subset = await scanTcadSubset({ zipPath, wanted, zipSha256: catalogZipSha256(repoRoot) });
    await writeSubset(tcadDir, subset);
    writeFileSync(keyPath, wantedKey);
  }
  if (state.finishedAt === null) {
    state.finishedAt = new Date().toISOString();
    writeFileSync(statePath, json(state));
  }
  const finishedAt = state.finishedAt;
  const tcadReceipt = JSON.parse(
    readFileSync(join(tcadDir, "receipt.json"), "utf8"),
  ) as TcadSubsetReceipt;
  log("pilot.tcad", { ...tcadReceipt.counts });
  const subset = readSubset(tcadDir);

  // 4 seed
  const byGeo = new Map(tcadReceipt.resolution.map((r) => [r.tcad_id ?? "(null)", r]));
  const allParcels = subset.map((s) => {
    const record = parseTcadRecord(s.record);
    return { record, geoID: s.geoID, seed: buildSeedRow(record, s.geoID) as SeedRow };
  });
  allParcels.sort((a, b) =>
    a.seed.parcel_id.localeCompare(b.seed.parcel_id, "en", { numeric: true }),
  );
  // property.property_type is required and non-null in the live class: a parcel whose TCAD
  // state code has no mapping cannot be written without guessing. It is left out of both
  // groups and counted (never guessed); its permits stay in the ledger as unpublished.
  const unmappedType = allParcels
    .map((p) => ({ pID: p.seed.parcel_id, fields: propertyFields(p.record) }))
    .filter((p) => p.fields.property_type === null)
    .map((p) => ({ pID: p.pID, warnings: p.fields.warnings }));
  const unmappedPids = new Set(unmappedType.map((p) => p.pID));
  const parcels = allParcels.filter((p) => !unmappedPids.has(p.seed.parcel_id));
  writeSeed(
    join(P, "seed/travis.csv"),
    parcels.map((p) => p.seed),
  );

  // 5 classification ledger
  const profile = profileApi(travisAustin as unknown as TravisAustinProfileModule);
  const matchedPid = (c: AustinPermitCapture): string | null => {
    const r = byGeo.get(c.row.tcad_id ?? "(null)");
    return r && r.status === "matched" ? (r.pIDs[0] as string) : null;
  };
  const pidOfPermit = (c: AustinPermitCapture): string | null => {
    const pID = matchedPid(c);
    return pID !== null && !unmappedPids.has(pID) ? pID : null;
  };
  const classification: Array<
    ClassificationLedgerRow & { slice: string; tcad_id: string | null; tcad_match: string }
  > = captures.map((c) => ({
    ...classifyCapture(c, profile, pidOfPermit(c)),
    slice: sliceOf.get(c.row.permit_number) ?? "unknown",
    tcad_id: c.row.tcad_id ?? null,
    tcad_match:
      matchedPid(c) !== null && pidOfPermit(c) === null
        ? "matched_unmapped_property_type"
        : (byGeo.get(c.row.tcad_id ?? "(null)")?.status ?? "no_tcad_geoid"),
  }));
  mkdirSync(join(P, "ledger"), { recursive: true });
  writeFileSync(join(P, "ledger/classification.jsonl"), jsonl(classification));

  // 6 roof-age ledger
  const roofAge: RoofAgeLedgerRow[] = parcels.map((p) => {
    const pID = p.seed.parcel_id;
    return estimateTravisRoofAge({
      pID,
      finishedAt,
      builtYear: propertyFields(p.record).property_structure_built_year,
      permits: classification
        .filter((l) => l.pID === pID)
        .map((l) => ({
          permit_number: l.permit_number,
          status_class: l.status_class,
          roofing: l.roofing,
          issue_date: l.issue_date,
          completed_date: l.completed_date,
        })),
    });
  });
  writeFileSync(join(P, "ledger/roof-age.jsonl"), jsonl(roofAge));

  // 7 transforms
  const groupsDir = join(P, "groups");
  rmSync(groupsDir, { recursive: true, force: true });
  const countyCounts: Array<{ pID: string } & CountyTransformCounts> = [];
  const piCounts: Array<{ pID: string; emitted: number; excluded: number; needs_review: number }> =
    [];
  for (const p of parcels) {
    const pID = p.seed.parcel_id;
    const roof = roofAge.find((r) => r.pID === pID) ?? null;
    const county = transformTcadCounty({
      record: p.record,
      seed: p.seed,
      cids,
      roofAge: roof && {
        pID,
        roof_date: roof.roof_date,
        anchor: roof.estimate.anchor?.type ?? null,
      },
    });
    for (const [name, text] of Object.entries(county.files)) {
      const path = join(groupsDir, "county", county.dir, name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
    }
    countyCounts.push({ pID, ...county.counts });
    const permits = captures
      .filter((c) => pidOfPermit(c) === pID)
      .sort((a, b) => a.row.permit_number.localeCompare(b.row.permit_number));
    const pi = transformAustinPropertyImprovement({
      record: p.record,
      seed: p.seed,
      cids,
      permits,
      profile,
    });
    for (const [name, text] of Object.entries(pi.files)) {
      const path = join(groupsDir, "property_improvement", pi.dir, name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
    }
    piCounts.push({
      pID,
      emitted: pi.counts.emitted,
      excluded: pi.counts.excluded,
      needs_review: pi.counts.needs_review,
    });
  }
  const permitsByMatch = (s: string): number =>
    classification.filter((l) => l.tcad_match === s).length;
  const transformReport = {
    permits_captured: captures.length,
    by_slice: Object.fromEntries(Object.entries(slice.permits).map(([k, v]) => [k, v.length])),
    permits_matched: permitsByMatch("matched"),
    permits_no_tcad_geoid: permitsByMatch("no_tcad_geoid"),
    permits_ambiguous_geoid: permitsByMatch("ambiguous_geoid"),
    permits_matched_unmapped_property_type: permitsByMatch("matched_unmapped_property_type"),
    tcad: tcadReceipt.counts,
    parcels: parcels.length,
    parcels_unmapped_property_type: unmappedType,
    pi_properties: piCounts.filter((c) => c.emitted > 0).length,
    emitted: piCounts.reduce((a, c) => a + c.emitted, 0),
    excluded: piCounts.reduce((a, c) => a + c.excluded, 0),
    needs_review: piCounts.reduce((a, c) => a + c.needs_review, 0),
    emitted_by_class: classification
      .filter((l) => l.pID !== null && l.emitted)
      .reduce<Record<string, number>>(
        (a, l) => ({ ...a, [l.status_class]: (a[l.status_class] ?? 0) + 1 }),
        {},
      ),
    emitted_by_type: classification
      .filter((l) => l.pID !== null && l.emitted)
      .reduce<Record<string, number>>(
        (a, l) => ({
          ...a,
          [l.improvement_type ?? "null"]: (a[l.improvement_type ?? "null"] ?? 0) + 1,
        }),
        {},
      ),
    confidential_suppressed: countyCounts.filter((c) => c.confidential).length,
    confidential_basis: countyCounts
      .flatMap((c) => c.confidential_basis)
      .reduce<Record<string, number>>((a, b) => ({ ...a, [b]: (a[b] ?? 0) + 1 }), {}),
    owner_outcomes: countyCounts.reduce<Record<string, number>>(
      (a, c) => ({ ...a, [c.owner]: (a[c.owner] ?? 0) + 1 }),
      {},
    ),
    sales_dated: countyCounts.reduce((a, c) => a + c.sales_dated, 0),
    roof_age: roofAge.reduce<Record<string, number>>((a, r) => {
      const k = r.estimate.anchor?.type ?? "none";
      return { ...a, [k]: (a[k] ?? 0) + 1 };
    }, {}),
    county: countyCounts,
    property_improvement: piCounts,
  };
  mkdirSync(join(P, "reports"), { recursive: true });
  writeFileSync(join(P, "reports/transform-counts.json"), json(transformReport));
  log("pilot.transforms", { parcels: parcels.length, emitted: transformReport.emitted });

  // 8 CLI sequence
  for (const sub of ["hashed", "car", "tables"])
    rmSync(join(P, sub), { recursive: true, force: true });
  const sequence = await runSequence({
    county: COUNTY.slug,
    pilotDir: P,
    groups: ["county", "property_improvement"],
    repoRoot,
  });
  writeFileSync(join(P, "reports/sequence.json"), json({ cli: cli.commit, ...sequence }));
  if (!sequence.ok) {
    log("pilot.sequence.failed", { ...sequence.failed, stderr: undefined });
    return {
      ok: false,
      stage: "sequence",
      reason: `${sequence.failed?.group} ${sequence.failed?.step}: ${sequence.failed?.reason}`,
      sequence,
    };
  }

  // 9 manifest
  const gitCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
  const dirty = dirtyTreeLimitations(
    execFileSync("git", ["status", "--porcelain", "--", ...BUILD_PATHS], {
      cwd: repoRoot,
      encoding: "utf8",
    }),
  );
  const gazetteerSha = readFileSync(join(repoRoot, GAZETTEER_PATH, "DIGEST"), "utf8").trim();
  const roofCaveats = [
    ...new Set(roofAge.flatMap((r) => r.estimate.historicalCoverage.caveats)),
  ].sort();
  const watermark =
    slice.slices
      .map((s) => s.max_updated_at)
      .filter((v): v is string => v !== null)
      .sort()
      .at(-1) ?? null;
  const roofProfileSha = roofAge[0]?.profile.sha256;
  const built = await buildManifest({
    runId,
    ownersRedacted: countyCounts.filter((c) => c.confidential).length,
    county: COUNTY.slug,
    state: COUNTY.state,
    fips: COUNTY.fips,
    startedAt: state.startedAt,
    finishedAt,
    previousManifestCid: null,
    pilotDir: P,
    groups: sequence.groups.map((g) => ({
      group: g.group,
      carPath: g.carPath,
      carRoot: g.carRoot,
      tablesDir: g.tablesDir,
      tablesRoot: g.tablesRoot,
      tablesExportJson: g.tablesExportJson,
    })),
    sources: [
      {
        name: "austin-3syk-w9eu",
        url: AUSTIN_DATASET_URL,
        watermark,
        receipts: join(austinDir, "receipts.jsonl"),
        limitations: [
          "D-3 pilot slice only: 42 issued 2026-09, 5 Expired BP, 3 older Final BP; one GET per permit",
        ],
      },
      {
        name: "tcad-2026-certified-json",
        url: TCAD_EXPORT_REQUEST.url,
        watermark: `${tcadReceipt.entry_name}@sha256:${tcadReceipt.zip_sha256}`,
        receipts: join(tcadDir, "receipt.json"),
        limitations: ["subset: only the parcels the pilot permits point to (geoID = tcad_id)"],
      },
    ],
    profiles: [
      {
        name: travisAustin.PROFILE.name,
        version: travisAustin.PROFILE.version,
        sha256: travisAustin.PROFILE.sha256,
        path: "profiles/travis-austin@1.0.0",
        gitCommit,
      },
      ...(roofProfileSha
        ? [
            {
              name: "travis-austin-roof-profile",
              version: TRAVIS_ROOF_AGE_PROFILE_VERSION,
              sha256: roofProfileSha,
              path: "pipeline/oracle-runtime/travis/roof-age/travis-roof-age-profile.ts",
              gitCommit,
            },
          ]
        : []),
      {
        name: "travis-places",
        version: "1.0.0",
        sha256: gazetteerSha,
        path: GAZETTEER_PATH,
        gitCommit,
      },
    ],
    coverage: {
      permits_captured: { count: captures.length, derivation: "capture_receipt" },
      permits_matched_parcel: {
        count: transformReport.permits_matched,
        derivation: "aggregate_match",
      },
      permits_no_tcad_geoid: {
        count: transformReport.permits_no_tcad_geoid,
        derivation: "aggregate_match",
      },
      permits_ambiguous_geoid: {
        count: transformReport.permits_ambiguous_geoid,
        derivation: "aggregate_match",
      },
      parcels_matched: { count: allParcels.length, derivation: "aggregate_match" },
      parcels_published: { count: parcels.length, derivation: "published_rows" },
      parcels_unmapped_property_type: {
        count: unmappedType.length,
        derivation: "aggregate_match",
        note: "TCAD state code with no lexicon property_type mapping; not published",
      },
      permits_emitted: { count: transformReport.emitted, derivation: "published_rows" },
      permits_emitted_stalled: {
        count: transformReport.emitted_by_class.stalled ?? 0,
        derivation: "aggregate_match",
        note: "Expired: improvement_status null (D-4a)",
      },
      permits_excluded: {
        count: transformReport.excluded,
        derivation: "aggregate_match",
        note: "not emitted",
      },
      permits_needs_review: {
        count: transformReport.needs_review,
        derivation: "aggregate_match",
        note: "not emitted",
      },
      ...ownerCoverage(transformReport.owner_outcomes),
      ...contractorCoverage(transformReport.emitted),
      roof_age_permit_anchor: {
        count: transformReport.roof_age.permit_terminal_date ?? 0,
        derivation: "published_rows",
        note: `estimator confidence high; caveats: ${roofCaveats.join(", ") || "none"}`,
      },
      roof_age_built_year: {
        count: transformReport.roof_age.property_built_year ?? 0,
        derivation: "published_rows",
        note: `estimator confidence low; caveats: ${roofCaveats.join(", ") || "none"}`,
      },
    },
    limitations: [
      PILOT_LIMITATION,
      "finishedAt is the end of the capture phase (the data's as-of instant)",
      `roof age: the estimator saw a slice of each parcel's Austin permits, not its full history (${roofCaveats.join(", ") || "no caveat"})`,
      ...dirty,
    ],
  });
  mkdirSync(join(P, "manifest"), { recursive: true });
  writeFileSync(join(P, "manifest/manifest.json"), built.bytes);
  writeFileSync(join(P, "manifest/manifest.cid"), `${built.cid}\n`);
  const committed = join(repoRoot, "contract/v1/pilot-manifest.json");
  mkdirSync(dirname(committed), { recursive: true });
  writeFileSync(committed, built.bytes);
  log("pilot.manifest", { cid: built.cid, bytes: built.bytes.length });
  return {
    ok: true,
    stage: "done",
    sequence,
    manifestCid: built.cid,
    manifestBytes: built.bytes.length,
  };
}

const isMain =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
  runPilot({ repoRoot, reuseCaptures: process.argv.includes("--reuse-captures") }).then(
    (r) => {
      process.stdout.write(
        `${JSON.stringify({ ok: r.ok, stage: r.stage, reason: r.reason ?? null, manifestCid: r.manifestCid ?? null, manifestBytes: r.manifestBytes ?? null })}\n`,
      );
      process.exitCode = r.ok ? 0 : 1;
    },
    (error: unknown) => {
      process.stderr.write(`${(error as Error).stack ?? String(error)}\n`);
      process.exitCode = 1;
    },
  );
}
