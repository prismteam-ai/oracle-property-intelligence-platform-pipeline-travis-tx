// A-11 Run 3 (ADR 0004): read-only evidence for the address_point rank.
//   npm run address-point-evidence -- <accounts.jsonl> [<cache dir>] [<out.json>]
// accounts.jsonl: one JSON object per R account, exported read-only from the Query DB:
//   { request_identifier, state_cd, situs_address, latitude, longitude,
//     coordinate_source, coordinate_rule }
// Applies the matcher (address-points.ts) to every account that has no public point (source none
// or permit_point), reports the exact new coverage, the unmatched remainder by reason, the
// distance distribution against GIS centroids for accounts that have both, and 30 random real
// matches. Writes nothing to any database. Prints no private data beyond situs addresses that
// are already public TCAD records.
import { createHash } from "node:crypto";
import { createReadStream, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { readAddressLayerCache } from "./address-point-loader.js";
import { buildAddressPointSet, distanceDistribution, type AddressMatch } from "./address-points.js";
import type { SitusIn } from "./address-normalise.js";

interface Account {
  request_identifier: string;
  state_cd: string | null;
  situs_address: (SitusIn & { text?: string }) | null;
  latitude: number | null;
  longitude: number | null;
  coordinate_source: string;
  coordinate_rule: string | null;
}

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const [accountsPath, cacheArg, outArg] = process.argv.slice(2);
if (accountsPath === undefined) {
  process.stderr.write("usage: address-point-evidence <accounts.jsonl> [cache dir] [out.json]\n");
  process.exit(1);
}
const cacheDir = cacheArg ?? `${repoRoot}pipeline/data/raw/austin-address-points`;

const { receipt, records } = readAddressLayerCache(cacheDir);
const set = buildAddressPointSet(records, {
  layerUrl: receipt.layer_url,
  retrievedAt: receipt.retrieved_at,
  sha256: receipt.sha256,
});

const accounts: Account[] = [];
for await (const line of createInterface({ input: createReadStream(accountsPath) })) {
  if (line.trim() !== "") accounts.push(JSON.parse(line) as Account);
}

const withPoint = (a: Account): boolean => a.coordinate_source === "gis_centroid";
const candidates = accounts.filter((a) => !withPoint(a));
const results = candidates.map((a) => ({ a, m: set.match(a.situs_address) as AddressMatch }));

const tally: Record<string, number> = {};
for (const { m } of results) tally[m.status] = (tally[m.status] ?? 0) + 1;

const matched = results.filter((r) => r.m.status === "unique");
const byBucket = (pred: (a: Account) => boolean): { accounts: number; matched: number } => ({
  accounts: results.filter((r) => pred(r.a)).length,
  matched: matched.filter((r) => pred(r.a)).length,
});
const stateCodes = ["A4", "F4", "O1"];

// Distance against GIS centroids, over the accounts that have BOTH a centroid and a unique match.
const both: Array<{
  id: string;
  a: { lat: number; lon: number };
  b: { lat: number; lon: number };
}> = [];
for (const a of accounts.filter(withPoint)) {
  if (a.latitude === null || a.longitude === null) continue;
  const m = set.match(a.situs_address);
  if (m.status === "unique") {
    both.push({
      id: a.request_identifier,
      a: { lat: m.point.lat, lon: m.point.lon },
      b: { lat: a.latitude, lon: a.longitude },
    });
  }
}
const centroidOnly = accounts.filter(withPoint);
const bothStatus: Record<string, number> = {};
for (const a of centroidOnly) {
  const s = set.match(a.situs_address).status;
  bothStatus[s] = (bothStatus[s] ?? 0) + 1;
}

// 30 random real matches: a deterministic shuffle (sha256 of the pID and a fixed salt).
const salted = (id: string): string =>
  createHash("sha256").update(`a11-run3-address-point:${id}`).digest("hex");
const sample = [...matched]
  .sort((x, y) => salted(x.a.request_identifier).localeCompare(salted(y.a.request_identifier)))
  .slice(0, 30)
  .map(({ a, m }) => {
    if (m.status !== "unique") throw new Error("unreachable");
    // These accounts have no GIS point by definition (rank 4 only runs without one), so there is
    // no centroid to measure against; `sample_with_centroid_10` below does that on accounts that
    // have both.
    return {
      pID: a.request_identifier,
      situs: a.situs_address?.text ?? null,
      state_cd: a.state_cd,
      was: a.coordinate_source,
      point: { lat: m.point.lat, lon: m.point.lon, object_id: m.point.object_id },
      unit_ignored: m.unit_ignored,
      distance_to_centroid_m: null,
    };
  });
const sampleBoth = [...both]
  .sort((x, y) => salted(x.id).localeCompare(salted(y.id)))
  .slice(0, 10)
  .map((p) => ({
    pID: p.id,
    address_point: p.a,
    gis_centroid: p.b,
    distance_m: Math.round(distanceDistribution([p]).max ?? 0),
  }));

const total = accounts.length;
const published =
  accounts.filter(withPoint).length +
  accounts.filter((a) => a.coordinate_source === "address_point").length;
const newCoverage = published + matched.length;
const report = {
  layer: {
    url: receipt.layer_url,
    retrieved_at: receipt.retrieved_at,
    record_count: receipt.record_count,
    sha256: receipt.sha256,
    layer_last_edit_date: receipt.layer_last_edit_date,
  },
  accounts: total,
  with_public_point_before: published,
  coverage_before: Number((published / total).toFixed(4)),
  candidates: candidates.length,
  match_status: tally,
  newly_matched: matched.length,
  coverage_after: Number((newCoverage / total).toFixed(4)),
  with_point_after: newCoverage,
  unmatched_remainder: candidates.length - matched.length,
  unmatched_by_reason: {
    address_point_ambiguous: tally.ambiguous ?? 0,
    address_point_outside_county: tally.outside_county ?? 0,
    no_match: tally.no_match ?? 0,
    no_address: tally.no_address ?? 0,
  },
  matched_with_unit_ignored: matched.filter(
    (r) => r.m.status === "unique" && r.m.unit_ignored !== null,
  ).length,
  by_state_code: Object.fromEntries(stateCodes.map((c) => [c, byBucket((a) => a.state_cd === c)])),
  by_state_code_other: byBucket((a) => !stateCodes.includes(a.state_cd ?? "")),
  by_prior_source: {
    none: byBucket((a) => a.coordinate_source === "none"),
    permit_point: byBucket((a) => a.coordinate_source === "permit_point"),
  },
  centroid_accounts_match_status: bothStatus,
  distance_to_gis_centroid_m: distanceDistribution(both),
  distance_over_250m: both.filter((p) => distanceMetersOf(p) > 250).length,
  sample_30: sample,
  sample_with_centroid_10: sampleBoth,
};

function distanceMetersOf(p: {
  a: { lat: number; lon: number };
  b: { lat: number; lon: number };
}): number {
  return distanceDistribution([p]).max ?? 0;
}

const out = outArg ?? `${repoRoot}pipeline/data/raw/austin-address-points/evidence.json`;
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(
  JSON.stringify(
    { ...report, sample_30: `${sample.length} rows in ${out}`, sample_with_centroid_10: undefined },
    null,
    2,
  ) + "\n",
);
