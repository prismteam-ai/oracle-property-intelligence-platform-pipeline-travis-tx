// T023: AC-5 at full scale without ingesting (research R-09, oracle § E.1).
//
// In one run: count the dataset and the include set (SoQL from toSoqlInclude()), key-page
// the include set only, re-count, classify locally with classifyPermit(), cross-check the
// SoQL-expressible Auxiliary Power exclude, and write expectations.json (outside the digest).
// A fetched/count mismatch re-measures once, then stops with a reason. A 403 or challenge
// stops with a `blocked` receipt.
//
// Run: pnpm --filter @countylens/profile-travis-austin measure
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  PROFILE,
  RULES,
  classifyPermit,
  classifyStatus,
  toSoqlExcludeEquals,
  toSoqlInclude,
  toSoqlSamplePopulation,
  type PermitRow,
  type StatusClass,
} from "../index.js";
import { MAX_PAGE_SIZE, SocrataClient, StopError, type Receipt } from "./socrata.js";

export const FIELDS = "permit_number,permittype,work_class,status_current,description";
export const whereAuxPower = (base: string): string =>
  `${base} AND ${toSoqlExcludeEquals("aux_power")}`;

export interface Expectations {
  profile: { name: string; version: string };
  rules_sha256: string;
  dataset: string;
  measured_at: string;
  finished_at: string;
  attempts: number;
  dataset_rows: number;
  include_matches: number;
  include_matches_recount: number;
  fetched_rows: number;
  excluded: Record<string, number>;
  trade_permits: number;
  needs_review: number;
  candidates: number;
  formula: string;
  aux_power_check: {
    soql_permit_numbers: string[];
    classifier_permit_numbers: string[];
    equal: boolean;
    candidates_with_aux_power: number;
    roof_mentions_aux_power: number;
  };
  candidates_by_status_class: Record<StatusClass, number>;
  query_urls: string[];
  receipts: Receipt[];
}

export type MeasureResult =
  | { outcome: "ok"; expectations: Expectations }
  | { outcome: "blocked"; reason: string; receipt: Receipt }
  | { outcome: "stopped"; reason: string; attempts: number };

export async function measure(
  client: SocrataClient,
  opts: { pageSize?: number } = {},
): Promise<MeasureResult> {
  const pageSize = Math.min(opts.pageSize ?? MAX_PAGE_SIZE, MAX_PAGE_SIZE);
  const include = toSoqlInclude();
  let reason = "";
  try {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const measured_at = client.now().toISOString();
      const dataset_rows = await client.count();
      const include_matches = await client.count(include);
      const rows = (await client.fetchAllKeyed(FIELDS, include, pageSize)) as PermitRow[];
      const include_matches_recount = await client.count(include);
      if (rows.length !== include_matches || include_matches_recount !== include_matches) {
        reason = `fetched ${rows.length} rows but include count ${include_matches} (re-count ${include_matches_recount})`;
        continue;
      }

      const excluded = Object.fromEntries(RULES.roofing.exclude.map((r) => [r.id, 0])) as Record<
        string,
        number
      >;
      let trade_permits = 0;
      let needs_review = 0;
      let candidates = 0;
      const other: string[] = [];
      const auxClassifier: string[] = [];
      const byStatus: Record<StatusClass, number> = {
        open: 0,
        stalled: 0,
        closed: 0,
        exclude: 0,
        needs_review: 0,
      };
      const candidateNumbers = new Set<string>();
      for (const row of rows) {
        const c = classifyPermit(row);
        if (c.reason in excluded) excluded[c.reason] = (excluded[c.reason] ?? 0) + 1;
        if (c.reason === "aux_power") auxClassifier.push(c.permit_number);
        if (c.reason === "trade_permit") trade_permits += 1;
        else if (c.roofing === "needs_review") needs_review += 1;
        else if (c.roofing === "roofing") {
          candidates += 1;
          candidateNumbers.add(c.permit_number);
          byStatus[classifyStatus(row.status_current).class] += 1;
        } else if (!(c.reason in excluded)) other.push(c.permit_number);
      }
      if (other.length > 0) {
        return {
          outcome: "stopped",
          attempts: attempt,
          reason: `${other.length} SoQL include rows have no include term locally (e.g. ${other.slice(0, 3).join(", ")})`,
        };
      }

      const auxSoql = (
        await client.fetchAllKeyed("permit_number", whereAuxPower(include), pageSize)
      )
        .map((r) => String(r["permit_number"]))
        .sort();
      const roof_mentions_aux_power = await client.count(whereAuxPower(toSoqlSamplePopulation()));
      const auxSorted = [...auxClassifier].sort();
      const excludedTotal = Object.values(excluded).reduce((a, b) => a + b, 0);
      const candidates_with_aux_power = auxSoql.filter((p) => candidateNumbers.has(p)).length;
      if (candidates !== include_matches - excludedTotal - trade_permits - needs_review) {
        return {
          outcome: "stopped",
          attempts: attempt,
          reason: "candidate equation does not hold",
        };
      }
      const equal = JSON.stringify(auxSoql) === JSON.stringify(auxSorted);
      if (!equal || candidates_with_aux_power !== 0) {
        return {
          outcome: "stopped",
          attempts: attempt,
          reason: `Auxiliary Power cross-check failed: SoQL ${auxSoql.length}, classifier ${auxSorted.length}, candidates ${candidates_with_aux_power}`,
        };
      }
      return {
        outcome: "ok",
        expectations: {
          profile: { name: PROFILE.name, version: PROFILE.version },
          rules_sha256: PROFILE.sha256,
          dataset: client.datasetUrl,
          measured_at,
          finished_at: client.now().toISOString(),
          attempts: attempt,
          dataset_rows,
          include_matches,
          include_matches_recount,
          fetched_rows: rows.length,
          excluded,
          trade_permits,
          needs_review,
          candidates,
          formula: "candidates = include_matches - sum(excluded) - trade_permits - needs_review",
          aux_power_check: {
            soql_permit_numbers: auxSoql,
            classifier_permit_numbers: auxSorted,
            equal,
            candidates_with_aux_power,
            roof_mentions_aux_power,
          },
          candidates_by_status_class: byStatus,
          query_urls: client.queryUrls(),
          receipts: client.receipts,
        },
      };
    }
    return { outcome: "stopped", attempts: 2, reason };
  } catch (e) {
    if (e instanceof StopError && e.receipt.outcome === "blocked") {
      return { outcome: "blocked", reason: e.message, receipt: e.receipt };
    }
    throw e;
  }
}

async function main(): Promise<void> {
  const res = await measure(new SocrataClient());
  if (res.outcome !== "ok") {
    process.stdout.write(JSON.stringify(res, null, 2) + "\n");
    process.exitCode = 2;
    return;
  }
  const out = new URL("../expectations.json", import.meta.url);
  writeFileSync(out, JSON.stringify(res.expectations, null, 2) + "\n");
  const { receipts: _r, ...summary } = res.expectations;
  process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
