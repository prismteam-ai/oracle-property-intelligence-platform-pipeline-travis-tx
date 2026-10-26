// S6a.2: rebuilds specs/011-publish-and-runs/draft-run1-manifest.json with the REAL
// buildManifest() (manifest.ts), now that it accepts N CARs per data group, from the actual
// Run 1 dry-run batch outputs (10 county CARs + 2 property_improvement CARs, re-exported with
// --part-size 48m). This replaces the earlier one-off script (deleted at S6a.2's first pass,
// specs/011-publish-and-runs/run-log.md 18:05/18:40) that hand-rolled buildManifest()'s own
// checks because it could not yet take more than one CAR per group. This file is a committed
// production script, not a throwaway: it is the natural caller for any future multi-batch run
// (Run 2, Run 3) that only needs new batch directories, a new runId, and the run's own real
// facts — never fabricated ones.
//
// Every fact below is carried over, unchanged, from the run that actually produced it
// (specs/011-publish-and-runs/run-log.md 2026-10-23 05:58/11:20/11:43/13:41/14:46/18:05/18:40):
// Austin/TCAD watermarks and record counts (the `watermarks` table and A-04's roll export),
// the 9 coverage counts (the Query DB's `property_improvements.unmatched_reason` tally and the
// permit-link counters), `ownersRedacted` (A-04 AC-5), and the profile's DIGEST file. Nothing
// here is invented to fill a gap; a missing fact is a reason to stop, not to guess.
//
// Run: `npx tsx pipeline/publish/scripts/build-run1-manifest.ts` from the repo root.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { RunManifestV1 } from "@countylens/contract";
import {
  buildManifest,
  manifestGroupInputsFromBatches,
  type BuildManifestInput,
} from "../src/manifest.js";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const COUNTY_DIR = join(
  REPO_ROOT,
  "pipeline/data/runs/travis-a04-20261022052658/publish-dry-run/county-batched",
);
const PERMITS_DIR = join(
  REPO_ROOT,
  "pipeline/data/runs/travis-a11-permits-full-20261023114303/publish-dry-run/permits-batched",
);

async function main(): Promise<void> {
  const groups = [
    ...manifestGroupInputsFromBatches({
      group: "county",
      dir: COUNTY_DIR,
      carPrefix: "travis-county",
      batches: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    }),
    ...manifestGroupInputsFromBatches({
      group: "property_improvement",
      dir: PERMITS_DIR,
      carPrefix: "travis-permits",
      batches: [1, 2],
    }),
  ];

  const input: BuildManifestInput = {
    runId: "travis-full-run1-20261023",
    county: "travis",
    state: "TX",
    fips: "48453",
    startedAt: "2026-10-23T10:27:00.000Z",
    finishedAt: "2026-10-23T15:41:00.000Z",
    previousManifestCid: null,
    runDir: REPO_ROOT,
    groups,
    sources: [
      {
        name: "austin-3syk-w9eu",
        url: "https://data.austintexas.gov/resource/3syk-w9eu.json",
        watermark: "2026-10-21T14:42:23.154Z",
        receipts: join(REPO_ROOT, "specs/011-publish-and-runs/receipts/austin-run1.json"),
        limitations: [],
      },
      {
        name: "tcad-2026-certified-json",
        url: "https://traviscad.org/publicinformation",
        watermark: "entry@sha256:6f7a758568fd03fa200e996d2756559eb53e13241238a004cbadac09ff4c2346",
        receipts: join(REPO_ROOT, "specs/011-publish-and-runs/receipts/tcad-run1.json"),
        limitations: [],
      },
    ],
    profiles: [
      {
        name: "travis-austin",
        version: "1.0.0",
        sha256: readFileSync(join(REPO_ROOT, "profiles/travis-austin@1.0.0/DIGEST"), "utf8").trim(),
        path: "profiles/travis-austin@1.0.0/rules.json",
        gitCommit: "0421ac2",
      },
    ],
    coverage: {
      permits_emitted: {
        count: 17387,
        derivation: "published_rows",
        note: "b01 7834 + b02 9553, roofing-classified decided-status permits only (PO 2026-10-23)",
      },
      permits_no_tcad_geoid: {
        count: 275764,
        derivation: "aggregate_match",
        note: "Query DB property_improvements.unmatched_reason='no_tcad_geoid', request_identifier IS NULL, all captured Austin permits",
      },
      permits_no_tcad_id: {
        count: 31824,
        derivation: "aggregate_match",
        note: "unmatched_reason='no_tcad_id'",
      },
      permits_ambiguous_geoid: {
        count: 36560,
        derivation: "aggregate_match",
        note: "unmatched_reason='ambiguous_geoid'",
      },
      permits_address_unmatched: {
        count: 29475,
        derivation: "aggregate_match",
        note: "unmatched_reason='address_unmatched'",
      },
      permits_ambiguous_address: {
        count: 89,
        derivation: "aggregate_match",
        note: "unmatched_reason='ambiguous_address'",
      },
      contractor_resolved: {
        count: 0,
        derivation: "aggregate_match",
        note: "Comptroller registry not wired for this run (NO_REGISTRY default); every emitted permit resolves unresolved",
      },
      contractor_candidate: {
        count: 0,
        derivation: "aggregate_match",
        note: "same NO_REGISTRY default as contractor_resolved",
      },
      contractor_unresolved: {
        count: 17387,
        derivation: "aggregate_match",
        note: "all 17387 emitted permits: registry_unavailable (NO_REGISTRY default, A-07 Comptroller baseline not loaded)",
      },
    },
    ownersRedacted: 15410,
    limitations: [
      "DRAFT for Stage 6 S6a.2 pre-publish review -- not uploaded, not the final publish manifest",
      "county published_rows is R-only (441961 of the 493246-parcel roll); P/MH/MN out of scope, unchanged since A-04",
      "property_improvement published scope is roofing-classified, decided-status permits only (17387 rows), not all 2007514 linked permits",
      "export-tables re-run with --part-size 48m (ADR-0001 D-4) after the original dry run used elephant-cli's 1 GiB default; table splitting itself was unaffected (every table's parquet was already under 48m), only the recorded part_size_bytes changed from 1073741824 to 50331648",
    ],
    repoRoot: REPO_ROOT,
  };

  const built = await buildManifest(input);
  RunManifestV1.parse(built.manifest);
  const outPath = join(REPO_ROOT, "specs/011-publish-and-runs/draft-run1-manifest.json");
  // buildManifest() already returns the exact RFC 8785 JCS bytes its own manifest CID
  // (built.cid) is computed from (pipeline/publish/test/manifest.test.ts "returns exact JCS
  // bytes..."). Writing JSON.stringify(..., null, 2) here instead (pretty-printed, as this
  // script originally did) would silently diverge the on-disk file from the bytes the CID
  // actually names -- write built.bytes verbatim, never re-serialize.
  writeFileSync(outPath, built.bytes);

  const byKind = new Map<string, number>();
  let totalBytes = 0;
  for (const a of built.manifest.artifacts) {
    byKind.set(a.kind, (byKind.get(a.kind) ?? 0) + 1);
    totalBytes += a.size;
  }
  console.log(`wrote ${outPath}`);
  console.log(`manifest CID: ${built.cid}`);
  console.log(
    `artifacts: ${built.manifest.artifacts.length} (${[...byKind.entries()]
      .map(([k, n]) => `${n} ${k}`)
      .join(", ")}), ${totalBytes} bytes`,
  );
  console.log(
    `coverage.permits_emitted: ${JSON.stringify(built.manifest.coverage.permits_emitted)}`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
