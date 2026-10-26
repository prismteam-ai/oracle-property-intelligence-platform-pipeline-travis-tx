/* global console */
// Run 4: writes config.json. The run note is derived from austin-facts.json, the P5 compare log,
// the P5 diff log and the P6 CARs, never hand-typed. Usage: node make-config.mjs (from this dir).
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const R = "/Users/hebagaber/Github/oracle-property-intelligence-platform-pipeline-travis-tx";
const D = `${R}/pipeline/data/runs`;
const facts = JSON.parse(readFileSync("austin-facts.json", "utf8"));
const cov = JSON.parse(readFileSync("contractor-coverage.json", "utf8"));
const c31 = JSON.parse(readFileSync("../run3-1/config.json", "utf8"));
const cmp = readFileSync("logs/p5-compare.log", "utf8");
const m = /permits here=(\d+) Run 1=(\d+) identical=(\d+) DIFFERENT=(\d+)/.exec(cmp);
if (!m || !/\[compare\] PASS/.test(cmp)) throw new Error("p5 compare did not PASS");
const [permits, identical, different] = [Number(m[1]), Number(m[3]), Number(m[4])];
if (different !== 0 || identical !== permits) throw new Error("permits differ from Run 3.1");
if (readFileSync("logs/p5-diff-run3-1.log", "utf8").trim() !== "") throw new Error("group diff not empty");
const countFiles = (dir) => readdirSync(dir, { withFileTypes: true })
  .reduce((n, e) => n + (e.isDirectory() ? countFiles(join(dir, e.name)) : 1), 0);
const files = countFiles(`${D}/travis-a11-permits-run4-20261026/groups/property_improvement`);
const N = `${D}/travis-a11-permits-run4-20261026/publish-run4/permits-batched/cars`;
const O = `${D}/travis-a11-permits-run3-1-20261026/publish-run3-1-oneof/permits-batched/cars`;
const cars = readdirSync(N).filter((f) => /^travis-permits-b\d+\.car$/.test(f));
for (const c of cars)
  if (statSync(join(N, c)).size !== statSync(join(O, c)).size || !readFileSync(join(N, c)).equals(readFileSync(join(O, c))))
    throw new Error(`${c} differs from Run 3.1`);
const { added, changed, removed } = facts.delta;
const note =
  `Incremental refresh of the Austin permits source (watermark ${facts.watermarkUsed} to ${facts.watermarkNew}): ` +
  `added ${added}, changed ${changed}, removed ${removed} permits by content digest (${facts.recordsRead} rows read, ${facts.unchanged} unchanged). ` +
  `These ${added + changed + removed} changed source rows produced no change in the published roofing permits: the Property Improvement group was rebuilt from the Query DB ` +
  `and all ${permits} permit records, all ${files} files and all ${cars.length} CARs are byte-identical to Run 3.1 (travis-full-run3-1-20261025); ` +
  `the County group is Run 3.1's (TCAD certified file unchanged, address points not re-captured). Every artifact keeps Run 3.1's CID; only the Austin source facts are new.`;
const bs = cov.byState, ub = cov.unresolvedBy, P = cov.permits;
const o31 = c31.coverageOverrides;
const cfg = {
  runId: "travis-full-run4-20261026",
  startedAt: "2026-10-26T10:47:00.000Z",
  finishedAt: "2026-10-26T11:47:00.000Z",
  previousManifestCid: "bafkreidbqsav3rsbxqy5fx3li73uskfth254nz5zw34xwac5w3fd4tmbai",
  baseManifest: "runs/travis-full-run3-1-20261025/manifest.json",
  countyDir: "pipeline/data/runs/travis-a11-county-run3-20261025/publish-run3-1/county-batched",
  permitsDir: "pipeline/data/runs/travis-a11-permits-run4-20261026/publish-run4/permits-batched",
  austinFacts: "specs/011-publish-and-runs/run4/austin-facts.json",
  austinReceipt: "specs/011-publish-and-runs/run4/austin-receipt.json",
  addressPointsReceipt: "specs/011-publish-and-runs/run3/address-points-receipt.json",
  carryAddressPoints: true,
  registryNote: c31.registryNote,
  coverageOverrides: {
    contractor_resolved: { count: bs.resolved, derivation: "aggregate_match", note: `${bs.resolved} of ${P} published permits: resolved needs an identifier crosswalk to a registry record and none exists (D-10); a name match is never resolved` },
    contractor_candidate: { count: bs.candidate, derivation: "aggregate_match", note: o31.contractor_candidate.note },
    contractor_ambiguous: { count: bs.ambiguous, derivation: "aggregate_match", note: o31.contractor_ambiguous.note },
    contractor_conflicting: { count: bs.conflicting, derivation: "aggregate_match", note: o31.contractor_conflicting.note },
    contractor_unresolved: { count: bs.unresolved, derivation: "aggregate_match", note: `${ub.contractor_not_printed} permits print no contractor (contractor_not_printed); ${ub.no_match} published names match no registry legal name` },
  },
  contractorCoverage: "specs/011-publish-and-runs/run4/contractor-coverage.json",
  correctionNote: note,
};
writeFileSync("config.json", JSON.stringify(cfg, null, 2) + "\n");
console.log(note);
