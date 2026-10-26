// A-04 T028 (A-04-TC-004, P0-5, oracle disagreement #15 "R7 join proof"): read-only.
//   forward  a seeded sample of 1,000 Austin tcad_ids (TCAD geoIDs) is resolved twice: through
//            the Query DB (parcel_geoids, R accounts) and by an independent re-scan of the
//            export (A-03 pilot/capture-tcad-subset.ts scanTcadSubset). Status (matched /
//            no_tcad_geoid / ambiguous_geoid) and the pID strings must agree exactly.
//   reverse  a seeded sample of 1,000 R pIDs drawn from the export must each have a Query DB
//            parcels row whose request_identifier is the identical string.
// The seed is recorded with the result (run-log.md); counts only, never an owner field.
import { resolveTcadIds, scanTcadSubset, type GeoIdStatus } from "../pilot/capture-tcad-subset.js";
import type { ExportRecordText } from "./export-stream.js";
import { pidOfText } from "./workflow.js";

export const JOIN_PROOF_SIZE = 1000;

/** Small seeded PRNG (mulberry32): the same seed draws the same sample. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const R_LINE = /^\s*"propType": "R",?$/m;

/** Reservoir sample of `n` R pIDs (as printed) from one pass over the export. */
export async function sampleExportRPids(
  records: AsyncIterable<ExportRecordText>,
  seed: number,
  n: number,
): Promise<string[]> {
  const rand = mulberry32(seed);
  const out: string[] = [];
  let seen = 0;
  for await (const rec of records) {
    if (!R_LINE.test(rec.text)) continue;
    const pid = pidOfText(rec.text);
    if (pid === null) continue;
    seen += 1;
    if (out.length < n) out.push(pid);
    else {
      const j = Math.floor(rand() * seen);
      if (j < n) out[j] = pid;
    }
  }
  return out;
}

export interface JoinProofDeps {
  seed: number;
  size?: number;
  /** Distinct non-null Austin tcad_ids, sampled by seed (Query DB, read-only). */
  sampleAustinTcadIds(seed: number, n: number): Promise<string[]>;
  /** geoID → R pIDs in parcel_geoids (Query DB, read-only). */
  resolveGeoIds(ids: readonly string[]): Promise<Map<string, string[]>>;
  /** Which of these pIDs have a parcels row with that exact request_identifier. */
  parcelIdsExist(ids: readonly string[]): Promise<Set<string>>;
  zipPath: string;
  zipSha256: string;
  exportRecords(): AsyncIterable<ExportRecordText>;
}

export interface JoinProofResult {
  seed: number;
  sampled: number;
  matched: number;
  no_tcad_geoid: number;
  ambiguous_geoid: number;
  disagreements: number;
  reverse_checked: number;
  reverse_disagreements: number;
  pass: boolean;
}

const statusOf = (pids: readonly string[]): GeoIdStatus =>
  pids.length === 1 ? "matched" : pids.length === 0 ? "no_tcad_geoid" : "ambiguous_geoid";

export async function runJoinProof(deps: JoinProofDeps): Promise<JoinProofResult> {
  const size = deps.size ?? JOIN_PROOF_SIZE;
  const ids = [...new Set(await deps.sampleAustinTcadIds(deps.seed, size))].slice(0, size);
  const qdb = await deps.resolveGeoIds(ids);
  const scan = await scanTcadSubset({
    zipPath: deps.zipPath,
    wanted: ids,
    zipSha256: deps.zipSha256,
  });
  const fromExport = new Map(resolveTcadIds(ids, scan.hits).map((r) => [r.tcad_id, r]));
  const counts = { matched: 0, no_tcad_geoid: 0, ambiguous_geoid: 0, disagreements: 0 };
  for (const id of ids) {
    const q = [...(qdb.get(id) ?? [])].sort();
    const e = fromExport.get(id);
    const qs = statusOf(q);
    if (e === undefined || e.status !== qs || e.pIDs.join(",") !== q.join(",")) {
      counts.disagreements += 1;
      continue;
    }
    counts[qs] += 1;
  }
  const reverse = await sampleExportRPids(deps.exportRecords(), deps.seed, size);
  const exist = await deps.parcelIdsExist(reverse);
  const reverseDisagreements = reverse.filter((p) => !exist.has(p)).length;
  return {
    seed: deps.seed,
    sampled: ids.length,
    ...counts,
    reverse_checked: reverse.length,
    reverse_disagreements: reverseDisagreements,
    pass: counts.disagreements === 0 && reverseDisagreements === 0 && counts.matched >= 1,
  };
}
